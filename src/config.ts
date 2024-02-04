import { SystemConfig, HostConfig } from '@raftainer/models'

export const config: SystemConfig & HostConfig = {
  name: 'Morningstar',
  region: 'JFK',
  secureIp: '192.168.6.2',
  internalIp: '192.168.69.130',
  kafkaBrokers: ['broker.kafka.service.consul:9092'],
  consulHosts: ['http://consul.service.consul:8500']
}
