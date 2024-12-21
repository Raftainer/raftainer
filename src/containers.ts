import Docker from 'dockerode';
import { createHash } from 'node:crypto';
import { logger } from './logger';
import {
  ExposedPort,
  ConsulPodEntry,
  OrchestratorName,
  Container,
  ContainerType,
} from '@raftainer/models';
import { ContainerInfo } from 'dockerode';
import { PodNetworks } from './networks';
import { config } from './config';

export function getDockerProtocol(port: ExposedPort): string {
  switch (port.protocol) {
  case 'UDP':
    return 'udp';
  default:
    return 'tcp';
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
    logger.trace({ container }, 'Found existing container');
    // @ts-expect-error assuming that container has exactly one name with '/' as prefix
    obj[container.Names[0].slice(1)] = container; // remove leading slash in name
    return obj;
  }, {});
  return existingContainers;
}

function getRestartPolicy(containerType: ContainerType): string {
  switch (containerType) {
  case ContainerType.PodStartup:
    return 'no';
  case ContainerType.LongRunning:
    return 'unless-stopped';
  }
}

function getHash(item: string): string {
  return createHash('md5').update(item).digest('hex');
}

async function launchPodContainer(
  docker: Docker,
  vaultSecrets: Record<string, string>,
  networks: PodNetworks,
  existingContainers: ExistingContainers,
  podEntry: ConsulPodEntry,
  containerConfig: Container,
): Promise<object> {
  logger.info({ image: containerConfig.image }, 'Pulling image');
  await docker.pull(containerConfig.image);
  const containerName = `${podEntry.pod.name}.${containerConfig.name}`;
  const configHash = getHash(JSON.stringify(containerConfig));
  logger.trace({ configHash, containerConfig }, 'Created config hash');
  const existingContainerInfo = existingContainers[containerName];
  try {
    if (existingContainerInfo !== undefined) {
      logger.trace(
        { containerName, existingContainerInfo },
        'Found existing container',
      );
      const existingContainer = docker.getContainer(existingContainerInfo.Id);
      // TODO: check image hash
      if (existingContainerInfo.Labels.ConfigHash === configHash) {
        logger.debug(
          { containerName, existingContainerInfo },
          'Container config matches existing config',
        );
        if (
          existingContainerInfo.State !== 'running' &&
          containerConfig.containerType !== ContainerType.PodStartup
        ) {
          //TODO: perhaps it makes more sense to re-create the container?
          logger.debug(
            { containerName, existingContainerInfo },
            'Re-starting existing container',
          );
          await existingContainer.start();
        }
        return {
          container: await existingContainer.inspect(),
          config: containerConfig,
        };
      }
      logger.debug({ existingContainerInfo }, 'Removing existing container');
      await existingContainer.remove({ force: true });
      logger.debug(
        { containerName, existingContainerInfo },
        'Removed existing container',
      );
    }
  } catch (error) {
    logger.warn(
      { error, existingContainerInfo },
      'Failed to launch existing container',
    );
    await docker.getContainer(existingContainerInfo.Id).remove({ force: true });
  }
  const env: string[] = [];
  if(containerConfig.environment !== undefined) {
    for(const [k,v] of Object.entries(containerConfig.environment)) {
      if(typeof v === 'string') {
        env.push(`${k}=${v}`);
      } else if('vaultKey' in v) {
        env.push(`${k}=${vaultSecrets[v.vaultKey]}`);
      } else if('ip' in v) {
        switch (v.ip) {
        case 'secure':
          env.push(`${k}=${config.secureIp}`);
          break;
        }
      }
    }
  }

  const portBindings = (containerConfig.ports || []).reduce((obj, port) => {
    const bindings = [];
    if(port.portType === 'Internal') {
      bindings.push(
        { 
          HostIp: config.secureIp,
          HostPort: String(port.internalPort) 
        },
      );
    } else if (port.portType === 'External') {
      bindings.push(
        { HostPort: String(port.externalPort) },
      );
    } else {
      return obj;
    }
    // @ts-expect-error calling Docker API
    obj[`${port.containerPort}/${getDockerProtocol(port)}`] = bindings;
    return obj;
  }, {});

  logger.info({ containerName, portBindings}, 'Created port bindings');
  const container = await docker.createContainer({
    name: containerName,
    Image: containerConfig.image,
    Env: env,
    Entrypoint: containerConfig.entrypoint,
    Cmd: containerConfig.command,
    ExposedPorts: Object.keys(portBindings).reduce((obj, binding) => ({ ...obj, [binding]: {} }), {}),
    HostConfig: {
      ShmSize: 2147483648, //2gb
      CapAdd: containerConfig.capAdd || [],
      RestartPolicy: { Name: getRestartPolicy(containerConfig.containerType) },
      PortBindings: portBindings,
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
  logger.debug({ containerConfig, container }, 'Created container');
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
  vaultSecrets: Record<string, string>,
  networks: PodNetworks,
  podEntry: ConsulPodEntry,
): Promise<PodEntryWithContainers> {
  const existingContainers = await getExistingContainers(docker);
  logger.info({ podEntry }, 'Launching pod');
  const launchedContainers = [];
  for(const containerConfig of podEntry.pod.containers) {
    launchedContainers.push(
      await launchPodContainer(
        docker,
        vaultSecrets,
        networks,
        existingContainers,
        podEntry,
        containerConfig));
  }

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
    const podName = containerInfo.Labels['PodName'];
    if (!activePodNames.has(podName)) {
      logger.info('Terminating container: %s', containerInfo.Names[0]);
      const container = docker.getContainer(containerInfo.Id);
      container
        .remove({ force: true })
        .catch((error) =>
          logger.error({ error }, 'Failed to delete container'),
        );
    }
  });
}
