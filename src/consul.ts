import Consul from 'consul';
import { config } from './config';
import { logger } from './logger';
import { Pod, ConsulPodEntry } from '@raftainer/models';

export const HostSessionName = 'Raftainer Host';

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
  const keys: string[] = await consul.kv.keys('raftainer/pods');
  return await Promise.all(keys.map(async (key: string) => {
    // @ts-expect-error consul API call
    const json: string = (await consul.kv.get(key)).Value;
    return { key, pod: JSON.parse(json) as Pod };
  }));
}
