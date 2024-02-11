import Consul from 'consul';
import { config } from './config';
import { logger } from './logger';
import { Pod, ConsulPodEntry } from '@raftainer/models';

export const HostSessionName = 'Raftainer Host';
export const RaftainerPodsKey = 'raftainer/pods';

export interface ConsulPodEntryWithLock extends ConsulPodEntry {
  readonly lockKey: string;
}

export type PodLock = { [podName: string]: string };

export async function configureHostSession (consul: Consul.Consul): Promise<string> {
  if(!config.fastStartup) {
    // @ts-expect-error consul API call
    while ((await consul.session.node(config.name)).find(({ Name: name }) => name === HostSessionName)) {
      logger.warn('Node already has a Raftainer lock. Waiting for lock to expire...');
      await new Promise(resolve => setTimeout(resolve, 10_000 * Math.random()));
    }
  }
  // @ts-expect-error consul API call
  const session: string = (await consul.session.create({
    name: HostSessionName,
    node: config.name,
    ttl: '10s',
    lockdelay: '10s'
  })).ID;
  logger.info(`Created consul session: ${session}`);

  setInterval(async () => {
    // @ts-expect-error consul API call
    const [{ CreateIndex: createIndex, ModifyIndex: modifyIndex }] = await consul.session.renew(session);
    logger.trace(`Renewed consul session: ${session}: ${createIndex}, ${modifyIndex}`);
  }, 5_000);

  process.on('exit', function () {
    consul.session.destroy(session)
      .catch(error => { logger.error(`Failed to destroy consul session during shutdown: ${error}`); });
  });

  return session;
}

export async function getPods (consul: Consul.Consul): Promise<ConsulPodEntry[]> {
  const keys: string[] = await consul.kv.keys(RaftainerPodsKey);
  return await Promise.all(keys.map(async (key: string) => {
    // @ts-expect-error consul API call
    const json: string = (await consul.kv.get(key)).Value;
    return { key, pod: JSON.parse(json) as Pod };
  }));
}

async function tryLock(consul: Consul.Consul, session: string, lockKey: string) {
  const lockResult = await consul.kv.set({ 
    key: lockKey, 
    value: JSON.stringify({ 
      holders: [session],
      host: config.name,
      region: config.region,
      timestamp: Date.now(),
    }), 
    acquire: session 
  });
  logger.debug('Lock result for key %s: ', lockKey, lockResult || false);
  return lockResult;

}

export async function tryLockPod(
  consul: Consul.Consul, 
  session: string, 
  podLocks: PodLock,
  pod: ConsulPodEntry,
): Promise<ConsulPodEntryWithLock | null> {
  logger.info('Attempting to lock pod %s', pod.pod.name);

  // Try to use existing lock key, iff it would not violate the current `maxInstances` count
  let lockKey = podLocks[pod.pod.name];
  if(lockKey && lockKey < `${pod.key}/hosts/${pod.pod.maxInstances}/.lock`) {
    const lockResult = await tryLock(consul, session, lockKey);
    if(lockResult) {
      logger.info('Got lock %s for pod %s', lockKey, pod.pod.name);
      return { ...pod, lockKey, };
    }
  }

  for(let i = 0; i < pod.pod.maxInstances; i++) {
    lockKey = `${pod.key}/hosts/${i}/.lock`;
    logger.debug('Attempting to lock key %s', lockKey);
    const lockResult = await tryLock(consul, session, lockKey);
    if(lockResult) {
      logger.info('Got lock %d for pod %s', lockKey, pod.pod.name);
      return { ...pod, lockKey };
    }
  }
  logger.info('Did not get lock for pod %s', pod.pod.name);

  return null;
}


