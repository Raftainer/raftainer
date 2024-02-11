import Docker from 'dockerode';
import Consul from 'consul';
import { logger } from './logger';
import { configureHostSession, getPods } from './consul';
import { launchPodContainers } from './containers';
import { ConsulPodEntry } from '@raftainer/models';
import { config } from './config';

interface ConsulPodEntryWithLock extends ConsulPodEntry {
  readonly lockKey: string;
}

async function tryLockPod(
  consul: Consul.Consul, 
  session: string, 
  pod: ConsulPodEntry,
): Promise<ConsulPodEntryWithLock | null> {
  logger.info('Attempting to lock pod %s', pod.pod.name);

  for(let i = 0; i < pod.pod.maxInstances; i++) {
    const lockKey = `${pod.key}/hosts/${i}/.lock`;
    logger.debug('Attempting to lock key %s', lockKey);
    const lockResult = await consul.kv.set({ 
      key: lockKey, 
      value: JSON.stringify({ 
        holders: [session],
        host: config.name,
        region: config.region,
      }), 
      acquire: session 
    });
    logger.debug('Lock result for key %s: ', lockKey, lockResult || false);
    if(lockResult) {
      logger.info('Got lock %d for pod %s', i, pod.pod.name);
      return { ...pod, lockKey };
    }
  }
  logger.info('Did not get lock for pod %s', pod.pod.name);

  return null;
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

  const podEntries: ConsulPodEntry[] = await getPods(consul);
  const lockedPods: ConsulPodEntryWithLock[] = (await Promise.all(podEntries.map(async podEntry => tryLockPod(consul, session, podEntry))))
    .filter(elem => elem !== null)
    .map(elem => elem as ConsulPodEntryWithLock);

  await Promise.all(lockedPods.map(async (podEntry) => {
    const { launchedContainers } = await launchPodContainers(docker, podEntry);
    logger.info('Launched pod %s', podEntry.pod.name);
    return { podEntry, launchedContainers };
  }));
  // TODO: prune out extra containers running on host
})().catch(err => {
  logger.error(`Service crashed: ${err}`);
});
