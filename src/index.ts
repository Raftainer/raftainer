import Docker from 'dockerode';
import Consul from 'consul';
import Pino from 'pino';
// @ts-ignore
import { Consumer, Kafka, Producer } from 'kafkajs';
import { SystemConfig } from '../lib/types/system-config';
import { HostConfig } from '../lib/types/host-config';

const config: SystemConfig & HostConfig = {
  name: 'Macbook',
  region: 'OTHER',
  kafkaBrokers: ['broker.kafka.service.consul:9092'],
};

const logger = Pino({});

(async function main() {
  logger.info('Starting service');

  logger.info('Connecting to Kakfa');
  const kafka = new Kafka({
    clientId: `raftainer-${config.name}`,
    brokers: config.kafkaBrokers,
  });
  const producer: Producer = kafka.producer();
  const consumer: Consumer = kafka.consumer({ groupId: `raftainer-${config.name}` });

  logger.info('Initializing docker connection');
  const docker = new Docker();
  logger.info(`Docker info ${await docker.info()}`);

  logger.info('Initializing consul connection');
  const consul = new Consul();
  logger.debug(await consul.agent.members());
})();
