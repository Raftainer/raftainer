import type Consul from 'consul'
import { config } from './config'
import { logger } from './logger'
import { ConsulPodEntry } from '@raftainer/models'

export const HostSessionName = 'Raftainer Host'

export async function configureHostSession (consul: Consul.Consul) {
  // @ts-expect-error
  while ((await consul.session.node(config.name)).find(({ Name: name }) => name === HostSessionName)) {
    logger.warn('Node already has a Raftainer lock. Waiting for lock to expire...')
    await new Promise(resolve => setTimeout(resolve, 10_000 * Math.random()))
  }
  // @ts-expect-error
  const { ID: session } = await consul.session.create({
    name: HostSessionName,
    node: config.name,
    ttl: '10s',
    lockdelay: '10s'
  })
  logger.info(`Created consul session: ${session}`)
  setInterval(async () => {
    // @ts-expect-error
    const [{ CreateIndex: createIndex, ModifyIndex: modifyIndex }] = await consul.session.renew(session)
    logger.trace(`Renewed consul session: ${session}: ${createIndex}, ${modifyIndex}`)
  }, 5_000)

  process.on('exit', function () {
    consul.session.destroy(session)
  })

  return session
}

export async function getPods (consul: Consul.Consul): Promise<ConsulPodEntry[]> {
  const keys: string[] = await consul.kv.keys('raftainer/pods')
  return await Promise.all(keys.map(async (key: string) => {
    // @ts-expect-error
    const { Value: json } = await consul.kv.get(key)
    return { key, pod: JSON.parse(json) }
  }))
}
