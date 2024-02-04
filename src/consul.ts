import Consul from 'consul';
import { config } from './config';
import { logger } from './logger';
import { ConsulPodEntry } from '../lib/types/consul-pod-entry';

export const HostSessionName = 'Raftainer Host';

export async function configureHostSession(consul: Consul.Consul) {
  // @ts-ignore
  while ((await consul.session.node(config.name)).find(({ Name: name }) => name === HostSessionName)) {
    logger.warn('Node already has a Raftainer lock. Waiting for lock to expire...');
    await new Promise(resolve => setTimeout(resolve, 10_000 * Math.random()));
  }
  // @ts-ignore
  const { ID: session } = await consul.session.create({
    name: HostSessionName,
    node: config.name,
    ttl: '10s',
    lockdelay: '10s',
  });
  logger.info(`Created consul session: ${session}`);
  setInterval(async () => {
    // @ts-ignore
    const [{ CreateIndex: createIndex, ModifyIndex: modifyIndex }] = await consul.session.renew(session);
    logger.trace(`Renewed consul session: ${session}: ${createIndex}, ${modifyIndex}`);
  }, 5_000);

  process.on('exit', function() {
    consul.session.destroy(session);
  });

  return session;
}

export async function getPods(consul: Consul.Consul): Promise<ConsulPodEntry[]> {
  const keys: string[] = await consul.kv.keys('raftainer/pods');
  return Promise.all(keys.map(async (key: string) => {
    // @ts-ignore
    const { Value: json } = await consul.kv.get(key);
    return { key, pod: JSON.parse(json) };
  }));
}
