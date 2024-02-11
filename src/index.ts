import Docker from 'dockerode';
import Consul from 'consul';
import { logger } from './logger';
import { configureHostSession, getPods, tryLockPod, ConsulPodEntryWithLock, PodLock, } from './consul';
import { launchPodContainers, stopOrphanedContainers } from './containers';
import { ConsulPodEntry } from '@raftainer/models';
import { config } from './config';

const podLocks: PodLock = {};

const UpdateInterval = 10_000;

async function syncPods(consul: Consul.Consul, docker: Docker, session: string) {
  logger.info('Syncing pods', { session });
  const podEntries: ConsulPodEntry[] = await getPods(consul);
  logger.debug('Full list of pods',  { podEntries });
  const lockedPods: ConsulPodEntryWithLock[] = (await Promise.all(podEntries.map(async podEntry => tryLockPod(consul, session, podLocks, podEntry))))
    .filter(elem => elem !== null)
    .map(elem => elem as ConsulPodEntryWithLock);
  logger.debug('Acquired pods', { podEntries, session, });

  for(const lockedPod of lockedPods) {
    podLocks[lockedPod.pod.name] = lockedPod.lockKey;
  }

  const launchedPods = await Promise.all(lockedPods.map(async (podEntry) => {
    try {
      const { launchedContainers } = await launchPodContainers(docker, podEntry);
      logger.info('Launched pod %s', podEntry.pod.name);
      return { podEntry, launchedContainers };
    } catch (error) {
      return { podEntry, error };
    }
  }));

  launchedPods.forEach(async pod => {
    await consul.agent.service.register({
      name: `raftainer:${pod.podEntry.pod.name}`,
      id: `raftainer:${pod.podEntry.pod.name}:pod`,
      check: {
        status: (pod.error) ? 'critical': 'passing',
        ttl: `${UpdateInterval / 1_000 * 1.2}s`,
      },
    });
  });

  const successfulPods = launchedPods.filter(({ error }) => !error);
  const failedPods = launchedPods.filter(({ error }) => error);
  if(failedPods.length > 0) {
    logger.error('Failed to launch all pods', {failedPods});
  }

  // Deregister old pods
  const deactivatedPodNames = await stopOrphanedContainers(docker, new Set(successfulPods.map(pod => pod.podEntry.pod.name)));
  for(const podName of deactivatedPodNames) {
    consul.agent.service.deregister(`raftainer:${podName}`);
  }
}

(async function main () {
  logger.info('Starting service');

  logger.debug('Initializing consul connection');
  const consul: Consul.Consul = new Consul({
    host: config.consul.host,
    port: String(config.consul.port),
  });

  logger.debug('Initializing docker connection');
  const docker = new Docker();

  await docker.pruneVolumes({});
  await docker.pruneImages({});
  await docker.pruneNetworks({});

  const session: string = await configureHostSession(consul);
  syncPods(consul, docker, session);
  setInterval(() => syncPods(consul, docker, session), UpdateInterval);

})().catch(err => {
  logger.error(`Service crashed: ${err}`);
});
