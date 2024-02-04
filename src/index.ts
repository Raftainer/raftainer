import Docker, { ContainerInfo } from 'dockerode';
import Consul from 'consul';
import { createHash } from 'node:crypto';
import { config } from './config';
import { logger } from './logger';
import { ExposedPort } from '../lib/types/exposed-port';
import { ConsulPodEntry } from '../lib/types/consul-pod-entry';
import { configureHostSession, getPods } from './consul';

const OrchestratorName = 'Raftainer';

function getDockerProtocol(port: ExposedPort): string {
  switch(port.protocol) {
    case 'UDP':
      return 'udp';
    default:
      return 'tcp';
  }
}

type ExistingContainers = { [name: string]: ContainerInfo };

async function launchPodContainers(docker: Docker, podEntry: ConsulPodEntry) {
  const existingContainers = await getExistingContainers(docker);
  logger.info({ podEntry }, 'Launching pod');
  const launchedContainers = await Promise.all(podEntry.pod.containers.map(async containerConfig => {
    await docker.pull(containerConfig.image);
    const containerName = `${podEntry.pod.name}.${containerConfig.name}`;
    const configHash = createHash('md5').update(JSON.stringify(containerConfig)).digest('hex');
    const existingContainerInfo = existingContainers[containerName];
    if(existingContainerInfo) {
      logger.debug({ containerName, existingContainerInfo }, 'Found existing container');
      const existingContainer = docker.getContainer(existingContainerInfo.Id)
      // TODO: check image hash
      if(existingContainerInfo.Labels['ConfigHash'] === configHash) {
        logger.debug({ containerName, existingContainerInfo }, 'Container config matches existing config');
        if(existingContainerInfo.State !== 'running' && containerConfig.restartPolicy !== 'no') {
          logger.debug({ containerName, existingContainerInfo }, 'Re-starting existing container');
          await existingContainer.start();
        }
        return { 
          container: await existingContainer.inspect(),
          config: containerConfig,
        };
      } 
      logger.debug({ existingContainerInfo }, 'Removing existing container');
      await existingContainer.remove({ force: true });
      logger.debug({ containerName, existingContainerInfo }, 'Removed existing container');
    }
    const container = await docker.createContainer({
      name: containerName,
      Image: containerConfig.image,
      Env: Object.keys(containerConfig.environment)
        .map(k => `${k}=${containerConfig.environment[k]}`),
      HostConfig: {
        RestartPolicy: { Name: containerConfig.restartPolicy },
        PortBindings: containerConfig.ports.reduce((obj, port) => {
          // @ts-ignore
          obj[`${port.containerPort}/${getDockerProtocol(port)}`] = [
            { HostPort: String(port.containerPort) }
          ];
          return obj;
        }, {}),
        Binds: containerConfig.localVolumes.map(v => `${v.hostPath}:${v.containerPath}:${v.mode}`),
      },
      Labels: {
        PodName: podEntry.pod.name,
        PodConsulKey: podEntry.key,
        PodContainerName: containerConfig.name,
        OrchestratorName,
        ConfigHash: configHash,
      },
    });
    logger.debug({ containerConfig, container }, `Created container`);
    await container.start();
    return { 
      container: await container.inspect(),
      config: containerConfig,
    };
  }));

  return { podEntry, launchedContainers };
}

async function getExistingContainers(docker: Docker): Promise<ExistingContainers> {
  const existingContainers: ExistingContainers = (await docker.listContainers({ 
    all: true,
    filters: { 
      label: [`OrchestratorName=${OrchestratorName}`],
    } 
  })).reduce((obj, container: ContainerInfo) => {
    logger.trace({ container }, 'Found existing container');
    // @ts-ignore
    obj[container.Names[0].slice(1)] = container; // remove leading slash in name
    return obj;
  }, {});
  return existingContainers;
}

(async function main() {
  logger.info('Starting service');

  logger.debug('Initializing consul connection');
  const consul: Consul.Consul = new Consul();

  logger.debug('Initializing docker connection');
  const docker = new Docker();

  await docker.pruneVolumes({});
  await docker.pruneImages({});
  await docker.pruneNetworks({});

  await configureHostSession(consul);

  const podEntries: ConsulPodEntry[] = await getPods(consul);
  //TODO: get and lock pods for this machine
  await Promise.all(podEntries.map(async podEntry => {
    //TODO: check if pod is already full
    //TODO: lock pod
    const { launchedContainers } = await launchPodContainers(docker, podEntry);
    //TODO: fire event for pod update
    return { podEntry, launchedContainers };
  }));
  //TODO: prune out extra containers

})();
