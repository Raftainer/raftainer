import { SystemConfig, HostConfig } from '@raftainer/models';

export const config: SystemConfig & HostConfig = {
  name: 'Morningstar',
  region: 'JFK',
  secureIp: '192.168.6.2',
  internalIp: '192.168.69.130',
  consul: {
    host: 'consul.service.consul',
    port: 8500,
  },
  fastStartup: true, // TODO: load all these settings from environment
};
