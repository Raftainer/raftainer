import Docker from 'dockerode';
import Consul from 'consul';
import { logger } from './logger';
import {
  configureHostSession,
  getPods,
  tryLockPod,
  ConsulPodEntryWithLock,
  PodLock,
  RaftainerPodsKey,
  releasePod,
  deregisterServices,
} from './consul';
import { launchPodContainers, stopOrphanedContainers } from './containers';
import { ConsulPodEntry } from '@raftainer/models';
import { config } from './config';
import { launchPodNetworks, stopOrphanedNetworks } from './networks';
import { Vault } from './vault';
import { ConstraintMatcher } from './constraint-matcher';
import { Mutex } from 'async-mutex';
import { TTLCache } from './ttlCache';

const vault = new Vault();

const podLocks: PodLock = {};
const failedPods = new TTLCache<string, string>(5 * 60 * 1000); // 5 minutes TTL for failed pods

const UpdateInterval = 10_000;

const constraintMatcher = new ConstraintMatcher();

/**
 * Tries to get Consul locks for available pods, then returns the list of pods
 * that were successfully locked.
 *
 * @param podEntries List of pods to try to lock
 * @param consul Consul client
 * @param session Consul session ID
 *
 * @returns List of pods that were successfully locked
 */
async function lockPods(podEntries: ConsulPodEntry[], consul: Consul.Consul, session: string) {
  const lockedPods: ConsulPodEntryWithLock[] = (
    await Promise.all(
      podEntries.map(async (podEntry) => {
        if(!constraintMatcher.meetsConstraints(podEntry)) {
          logger.info({ podEntry }, 'Host does not meet pod constraints');
          return null;
        }
        if (failedPods.get(podEntry.pod.name)) {
          logger.warn({ podEntry }, 'Skipping failed pod');
          return null;
        }
        return tryLockPod(consul, session, podLocks, podEntry);
      }),
    )
  )
    .filter((elem) => elem !== null)
    .map((elem) => elem as ConsulPodEntryWithLock);
  logger.debug('Acquired pods', { podEntries, session });

  for (const lockedPod of lockedPods) {
    podLocks[lockedPod.pod.name] = lockedPod.lockKey;
  }

  return lockedPods;
}

/**
 * Launches networks and containers for the list of pods.
 *
 * @param lockedPods List of pods to launch
 * @param docker Docker client
 *
 * @returns List of launched pods
 */
async function launchPods(lockedPods: ConsulPodEntryWithLock[], docker: Docker) {
  const launchedPods = Promise.all(lockedPods.map(async (podEntry) => {
    try {
      logger.trace({ podEntry }, 'Loading vault secrets');
      const networks = await launchPodNetworks(docker, podEntry);
      logger.trace({ podEntry, networks, }, 'Launched pod networks');
      const { launchedContainers } = await launchPodContainers(
        docker,
        vault,
        networks,
        podEntry,
      );
      logger.debug('Launched pod %s', podEntry.pod.name);
      return { podEntry, launchedContainers, networks };
    } catch (error) {
      failedPods.set(podEntry.pod.name, String(error));
      logger.error({ error, podEntry, }, 'Failed to launch pod');
      return { podEntry, error };
    }
  }));

  return launchedPods;
}

/**
 * Registers the launched pods with Consul.
 *
 * @param consul Consul client
 * @param launchedPods List of launched pods
 * @returns List of service IDs
 */
async function registerPods(consul: Consul.Consul, launchedPods: any[]): Promise<string[]> {
  const serviceIds: string[] = (await Promise.all(
    launchedPods.map(async (pod) => {
      const id = `raftainer-${pod.podEntry.pod.name}-pod`;
      await consul.agent.service.register({
        id,
        name: pod.podEntry.pod.name,
        tags: ['raftainer', 'pod', `host-${config.name}`, `region-${config.region}`],
        check: {
          ttl: `${(UpdateInterval / 1_000) * 10}s`,
        },
      });
      if (pod.error) {
        logger.warn({ id, error: pod.error }, 'Marking service unhealthy');
        await consul.agent.check.fail({
          id: `service:${id}`,
          note: String(pod.error),
        });
      } else {
        logger.info({ id }, 'Marking service healthy');
        await consul.agent.check.pass(`service:${id}`);
      }
      return id;
    }).map(promise => promise.catch(err => {
      logger.error({ err }, 'Failed to launch pod');
      return null;
    })),
  )).filter(a => a !== null);

  // Clear existing registrations for pods that are no longer launched
  await deregisterServices(consul, serviceIds);
  logger.info('Synced services', { serviceIds });

  return serviceIds;

}

/**
 * Update Consul locks and launches/shuts down pods based on acquired locks.
 *
 * @param consul Consul client
 * @param docker Docker client
 * @param session Consul session ID
 */
async function syncPods(
  consul: Consul.Consul,
  docker: Docker,
  session: string,
) {
  logger.info('Syncing pods', { session });
  const podEntries: ConsulPodEntry[] = await getPods(consul);
  logger.debug('Locking pods', { podEntries });
  const lockedPods = await lockPods(podEntries, consul, session);
  const launchedPods = await launchPods(lockedPods, docker);

  const successfulPods = launchedPods.filter(({ error }) => !error);
  const failedPods = launchedPods.filter(({ error }) => error);

  if (failedPods.length > 0) {
    logger.error({ failedPods }, 'Failed to launch all pods');
    for (const { podEntry, error } of failedPods) {
      await releasePod(consul, session, podEntry, error);
    }
  }

  await registerPods(consul, successfulPods);

  // Deregister old pods
  const successfulPodNames = new Set(
    successfulPods.map((pod) => pod.podEntry.pod.name),
  );
  await stopOrphanedContainers(docker, successfulPodNames);
  await stopOrphanedNetworks(docker, successfulPodNames);
  logger.info('Sync complete', { session, successfulPodNames, failedPods });
}

(async function main() {
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

  const configWatch = consul.watch({
    method: consul.kv.get,
    options: {
      key: RaftainerPodsKey,
      //@ts-ignore
      recurse: true,
    },
  });

  // Only sync one at a time
  const syncMutex = new Mutex();

  configWatch.on('change', (change) => {
    logger.info({ change }, 'Config changed');
    syncMutex.runExclusive(() => syncPods(consul, docker, session));
  });

  while(true) {
    await syncMutex.runExclusive(async () => await syncPods(consul, docker, session));
    await new Promise(resolve => setTimeout(resolve, UpdateInterval));
  }
})().catch((err) => {
  logger.error(`Service crashed: ${err}`);
});
