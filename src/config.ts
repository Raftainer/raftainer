import { SystemConfig, HostConfig } from '@raftainer/models';

export const config: SystemConfig & HostConfig = {
  name: process.env.HOSTNAME!,
  region: process.env.RAFTAINER_REGION!,
  secureIp: process.env.RAFTAINER_SECURE_IP,
  internalIp: process.env.RAFTAINER_INTERNAL_IP!,
  consul: {
    host: process.env.RAFTAINER_CONSUL_HOST!,
    port: Number(process.env.RAFTAINER_CONSUL_PORT || '8500'),
  },
  fastStartup: Boolean(JSON.parse(process.env.RAFTAINER_FAST_STARTUP || 'false')),
};
