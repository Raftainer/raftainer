import Docker from "dockerode";
import { createHash } from "node:crypto";
import { logger } from "./logger";
import {
  ExposedPort,
  ConsulPodEntry,
  OrchestratorName,
  Container,
  ContainerType,
} from "@raftainer/models";
import { ContainerInfo } from "dockerode";
import { PodNetworks } from "./networks";
import { config } from "./config";
import { Vault } from "./vault";

/**
 * Converts Raftainer port protocol to Docker protocol format
 * @param port Port configuration with protocol
 * @returns Docker protocol string ('tcp' or 'udp')
 */
export function getDockerProtocol(port: ExposedPort): string {
  switch (port.protocol) {
    case "UDP":
      return "udp";
    default:
      return "tcp";
  }
}

// Container Name -> Container Info
type ExistingContainers = Record<string, ContainerInfo>;

/**
 * Get the list of deployed Raftainer containers
 */
async function getExistingContainers(
  docker: Docker,
): Promise<ExistingContainers> {
  const existingContainers: ExistingContainers = (
    await docker.listContainers({
      all: true,
      filters: {
        label: [`OrchestratorName=${OrchestratorName}`],
      },
    })
  ).reduce((obj, container: ContainerInfo) => {
    logger.trace({ container }, "Found existing container");
    // @ts-expect-error assuming that container has exactly one name with '/' as prefix
    obj[container.Names[0].slice(1)] = container; // remove leading slash in name
    return obj;
  }, {});
  return existingContainers;
}

/**
 * Determines the Docker restart policy based on container type
 * @param containerType Type of container (PodStartup or LongRunning)
 * @returns Docker restart policy string
 */
function getRestartPolicy(containerType: ContainerType): string {
  switch (containerType) {
    case ContainerType.PodStartup:
      return "no";
    case ContainerType.LongRunning:
      return "unless-stopped";
  }
}

/**
 * Generates an MD5 hash of the provided string
 * @param item String to hash
 * @returns MD5 hash as a hex string
 */
function getHash(item: string): string {
  return createHash("md5").update(item).digest("hex");
}

async function launchPodContainer(
  docker: Docker,
  vault: Vault,
  networks: PodNetworks,
  existingContainers: ExistingContainers,
  podEntry: ConsulPodEntry,
  containerConfig: Container,
): Promise<object> {
  logger.info({ image: containerConfig.image }, "Pulling image");
  await docker.pull(containerConfig.image);
  const containerName = `${podEntry.pod.name}.${containerConfig.name}`;
  const configHash = getHash(JSON.stringify(containerConfig));
  logger.trace({ configHash, containerConfig }, "Created config hash");
  const existingContainerInfo = existingContainers[containerName];
  try {
    if (existingContainerInfo !== undefined) {
      logger.trace(
        { containerName, existingContainerInfo },
        "Found existing container",
      );
      const existingContainer = docker.getContainer(existingContainerInfo.Id);
      // TODO: check image hash
      if (existingContainerInfo.Labels.ConfigHash === configHash) {
        logger.debug(
          { containerName, existingContainerInfo },
          "Container config matches existing config",
        );
        if (
          existingContainerInfo.State !== "running" &&
          containerConfig.containerType !== ContainerType.PodStartup
        ) {
          logger.debug(
            { containerName, existingContainerInfo },
            "Existing container is not running, killing it.",
          );
          await existingContainer.remove({ force: true });
        } else {
          return {
            container: await existingContainer.inspect(),
            config: containerConfig,
          };
        }
      }
      logger.debug({ existingContainerInfo }, "Removing existing container");
      await existingContainer.remove({ force: true });
      logger.debug(
        { containerName, existingContainerInfo },
        "Removed existing container",
      );
    }
  } catch (error) {
    logger.warn(
      { error, existingContainerInfo },
      "Failed to launch existing container",
    );
    await docker.getContainer(existingContainerInfo.Id).remove({ force: true });
  }
  let containerTTL: number | undefined;
  const env: string[] = [
    `HOSTNAME=${config.name}`,
    `RAFTAINER_SECURE_IP=${config.secureIp || ""}`,
    `RAFTAINER_INTERNAL_IP=${config.internalIp || ""}`,
  ];
  if (containerConfig.environment !== undefined) {
    const vaultDatabaseRoles: Record<
      string,
      { username: string; password: string }
    > = {};
    const vaultSecrets: Record<string, string> = await vault.kvRead(
      `raftainer/${podEntry.pod.name}`,
    );
    for (const [k, v] of Object.entries(containerConfig.environment)) {
      if (typeof v === "string") {
        env.push(`${k}=${v}`);
      } else if ("vaultDatabaseRole" in v) {
        if (!vaultDatabaseRoles[v.vaultDatabaseRole]) {
          const { username, password, ttl } = await vault.getDbCredentials(
            v.vaultDatabaseRole,
          );
          vaultDatabaseRoles[v.vaultDatabaseRole] = { username, password };
          containerTTL = Math.min(ttl, containerTTL ?? ttl);
        }
        env.push(
          `${k}=${vaultDatabaseRoles[v.vaultDatabaseRole][v.loginField]}`,
        );
      } else if ("vaultKey" in v) {
        env.push(`${k}=${vaultSecrets[v.vaultKey]}`);
      } else if ("ip" in v) {
        switch (v.ip) {
          case "secure":
            env.push(`${k}=${config.secureIp}`);
            break;
        }
      }
    }
  }

  const portBindings = (containerConfig.ports || []).reduce((obj, port) => {
    const bindings = [];
    if (port.portType === "Internal") {
      bindings.push({
        HostIp: config.secureIp,
        HostPort: String(port.internalPort),
      });
    } else if (port.portType === "External") {
      bindings.push({ HostPort: String(port.externalPort) });
    } else {
      return obj;
    }
    // @ts-expect-error calling Docker API
    obj[`${port.containerPort}/${getDockerProtocol(port)}`] = bindings;
    return obj;
  }, {});

  logger.info({ containerName, portBindings }, "Created port bindings");
  const deviceRequests = [];
  if (containerConfig.hardwareConstraints?.gpus !== undefined) {
    deviceRequests.push({
      Driver: "nvidia",
      Count: -1, // Number of GPUs to assign; use -1 for all available GPUs
      Capabilities: [["gpu"]],
    });
  }
  const container = await docker.createContainer({
    name: containerName,
    Image: containerConfig.image,
    Env: env,
    Entrypoint: containerConfig.entrypoint,
    Cmd: containerConfig.command,
    ExposedPorts: Object.keys(portBindings).reduce(
      (obj, binding) => ({ ...obj, [binding]: {} }),
      {},
    ),
    HostConfig: {
      ShmSize: 2147483648, //2gb
      CapAdd: containerConfig.capAdd || [],
      RestartPolicy: { Name: getRestartPolicy(containerConfig.containerType) },
      PortBindings: portBindings,
      Binds: (containerConfig.localVolumes || []).map(
        (v) => `${v.hostPath}:${v.containerPath}:${v.mode}`,
      ),
      NetworkMode: networks.primary.id,
      DeviceRequests: deviceRequests,
    },
    Labels: {
      PodName: podEntry.pod.name,
      PodContainerName: containerConfig.name,
      OrchestratorName,
      ConfigHash: configHash,
      TTL: String(containerTTL ?? -1),
      StartTime: String(Date.now()),
    },
    NetworkingConfig: {
      EndpointsConfig: {
        [networks.primary.id]: {
          Aliases: [containerName, containerConfig.name],
        },
      },
    },
  });
  logger.debug({ containerConfig, container }, "Created container");
  await container.start();
  return {
    container: await container.inspect(),
    config: containerConfig,
  };
}

export interface PodEntryWithContainers extends ConsulPodEntry {
  readonly launchedContainers: object[];
}

export async function launchPodContainers(
  docker: Docker,
  vault: Vault,
  networks: PodNetworks,
  podEntry: ConsulPodEntry,
): Promise<PodEntryWithContainers> {
  const existingContainers = await getExistingContainers(docker);
  logger.info({ podEntry }, "Launching pod");
  const launchedContainers = [];
  for (const containerConfig of podEntry.pod.containers) {
    launchedContainers.push(
      await launchPodContainer(
        docker,
        vault,
        networks,
        existingContainers,
        podEntry,
        containerConfig,
      ),
    );
  }

  return { ...podEntry, launchedContainers };
}

export async function stopOrphanedContainers(
  docker: Docker,
  activePodNames: Set<string>,
) {
  try {
    logger.debug(
      {
        activePodCount: activePodNames.size,
        activePods: Array.from(activePodNames),
      },
      "Checking for orphaned containers",
    );

    const existingContainers = await getExistingContainers(docker);
    logger.debug(
      {
        containerCount: Object.keys(existingContainers).length,
      },
      "Found existing containers",
    );

    const containersToRemove = [];
    const removalResults = [];

    for (const name of Object.keys(existingContainers)) {
      const containerInfo = existingContainers[name];
      // Get the name of the pod associated with the container
      const podName = containerInfo.Labels["PodName"];

      if (!activePodNames.has(podName)) {
        containersToRemove.push({
          id: containerInfo.Id,
          name: containerInfo.Names[0],
          podName,
        });

        logger.info(
          {
            containerId: containerInfo.Id,
            containerName: containerInfo.Names[0],
            podName,
            state: containerInfo.State,
          },
          "Terminating orphaned container",
        );

        const container = docker.getContainer(containerInfo.Id);
        try {
          await container.remove({ force: true });
          removalResults.push({
            id: containerInfo.Id,
            name: containerInfo.Names[0],
            success: true,
          });
        } catch (error) {
          logger.error(
            {
              containerId: containerInfo.Id,
              containerName: containerInfo.Names[0],
              error: error,
              message: error.message,
              stack: error.stack,
            },
            "Failed to delete container",
          );

          removalResults.push({
            id: containerInfo.Id,
            name: containerInfo.Names[0],
            success: false,
            error: error.message,
          });
        }
      }
    }

    if (containersToRemove.length > 0) {
      logger.info(
        {
          removedCount: containersToRemove.length,
          successCount: removalResults.filter((r) => r.success).length,
          failCount: removalResults.filter((r) => !r.success).length,
        },
        "Container cleanup summary",
      );
    }
  } catch (error) {
    logger.error(
      {
        error: error,
        message: error.message,
        stack: error.stack,
      },
      "Error stopping orphaned containers",
    );
  }
}
