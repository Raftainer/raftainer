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

function getRestartPolicy(containerType: ContainerType): string {
  switch (containerType) {
    case ContainerType.PodStartup:
      return "no";
    case ContainerType.LongRunning:
      return "unless-stopped";
  }
}

function getHash(item: string): string {
  return createHash("md5").update(item).digest("hex");
}

async function launchPodContainer(
  docker: Docker,
  networks: PodNetworks,
  existingContainers: ExistingContainers,
  podEntry: ConsulPodEntry,
  containerConfig: Container,
): Promise<object> {
  await docker.pull(containerConfig.image);
  const containerName = `${podEntry.pod.name}.${containerConfig.name}`;
  const configHash = getHash(JSON.stringify(containerConfig));
  const existingContainerInfo = existingContainers[containerName];
  try {
    if (existingContainerInfo !== undefined) {
      logger.debug(
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
          //TODO: perhaps it makes more sense to re-create the container?
          logger.debug(
            { containerName, existingContainerInfo },
            "Re-starting existing container",
          );
          await existingContainer.start();
        }
        return {
          container: await existingContainer.inspect(),
          config: containerConfig,
        };
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
  let env: string[] = [];
  if(containerConfig.environment !== undefined) {
    env = Object.keys(containerConfig.environment).map(
      // @ts-ignore
      (k) => `${k}=${containerConfig.environment[k]}`,
    );

  }
  const container = await docker.createContainer({
    name: containerName,
    Image: containerConfig.image,
    Env: env,
    Entrypoint: containerConfig.entrypoint,
    Cmd: containerConfig.command,
    HostConfig: {
      CapAdd: containerConfig.capAdd || [],
      RestartPolicy: { Name: getRestartPolicy(containerConfig.containerType) },
      PortBindings: (containerConfig.ports || []).reduce((obj, port) => {
        // @ts-expect-error calling Docker API
        obj[`${port.containerPort}/${getDockerProtocol(port)}`] = [
          { HostPort: String(port.containerPort) },
        ];
        return obj;
      }, {}),
      Binds: (containerConfig.localVolumes || []).map(
        (v) => `${v.hostPath}:${v.containerPath}:${v.mode}`,
      ),
      NetworkMode: networks.primary.id,
    },
    Labels: {
      PodName: podEntry.pod.name,
      PodContainerName: containerConfig.name,
      OrchestratorName,
      ConfigHash: configHash,
    },
    NetworkingConfig: {
      EndpointsConfig: {
        [networks.primary.id]: {
          Aliases: [
            containerName,
            containerConfig.name,
          ],
        },
      }
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
  networks: PodNetworks,
  podEntry: ConsulPodEntry,
): Promise<PodEntryWithContainers> {
  const existingContainers = await getExistingContainers(docker);
  logger.info({ podEntry }, "Launching pod");
  const launchedContainers = await Promise.all(
    podEntry.pod.containers.map(
      async (containerConfig) =>
        await launchPodContainer(
          docker,
          networks,
          existingContainers,
          podEntry,
          containerConfig,
        ),
    ),
  );

  return { ...podEntry, launchedContainers };
}

export async function stopOrphanedContainers(
  docker: Docker,
  activePodNames: Set<string>,
) {
  const existingContainers = await getExistingContainers(docker);
  Object.keys(existingContainers).forEach((name) => {
    const containerInfo = existingContainers[name];
    // Get the name of the pod associated with the container
    const podName = containerInfo.Labels["PodName"];
    if (!activePodNames.has(podName)) {
      logger.info("Terminating container: %s", containerInfo.Names[0]);
      const container = docker.getContainer(containerInfo.Id);
      container
        .remove({ force: true })
        .catch((error) =>
          logger.error({ error }, "Failed to delete container"),
        );
    }
  });
}
