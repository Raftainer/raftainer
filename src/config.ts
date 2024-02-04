import { SystemConfig, HostConfig } from '@raftainer/models'

export const config: SystemConfig & HostConfig = {
  name: 'Morningstar',
  region: 'JFK',
  kafkaBrokers: ['broker.kafka.service.consul:9092'],
  consulHosts: ['http://consul.service.consul:8500']
}
