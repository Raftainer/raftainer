import Docker from 'dockerode';
import Consul from 'consul';
import { Kafka, Partitioners, Producer } from 'kafkajs';
import { config } from './config';
import { logger } from './logger';

export async function initKafka(consul: Consul.Consul, docker: Docker): Promise<Producer> {
  logger.debug('Connecting to Kakfa');
  const kafka = new Kafka({
    clientId: `raftainer-${config.name}`,
    brokers: config.kafkaBrokers,
  });
  const producer: Producer = kafka.producer({
    createPartitioner: Partitioners.DefaultPartitioner,
  });
  await producer.connect();

  setInterval(async () => {
    producer.send({
      topic: 'raftainer.docker.stats',
      messages: [
        {
          key: config.name,
          value: JSON.stringify(await docker.info()),
        }
      ]
    }).catch(err => logger.error(`Failed to publish docker statistics: ${err}`));
    producer.send({
      topic: 'raftainer.consul.stats',
      messages: [
        {
          key: config.name,
          value: JSON.stringify({
            peers: await consul.status.peers(),
            leader: await consul.status.leader(),
            sessions: await consul.session.list(),
          }),
        }
      ]
    }).catch(err => logger.error(`Failed to publish consul statistics: ${err}`));
  }, 1_000);

  return producer;
}
