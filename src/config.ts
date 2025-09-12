import { HostConfig } from '@raftainer/models';

/**
 * System configuration interface with Consul datacenter support
 */
export interface SystemConfig {
  readonly consul: {
    readonly host: string;
    readonly port: number;
    readonly datacenter?: string;
  };
}

/**
 * Configuration object that combines system and host configuration
 * Loads values from environment variables
 */
export const config: SystemConfig & HostConfig = {
  name: process.env.HOSTNAME!,
  region: process.env.RAFTAINER_REGION!,
  secureIp: process.env.RAFTAINER_SECURE_IP,
  internalIp: process.env.RAFTAINER_INTERNAL_IP!,
  consul: {
    host: process.env.RAFTAINER_CONSUL_HOST!,
    port: Number(process.env.RAFTAINER_CONSUL_PORT || '8500'),
    datacenter: process.env.RAFTAINER_CONSUL_DATACENTER,
  },
  fastStartup: Boolean(
    JSON.parse(process.env.RAFTAINER_FAST_STARTUP || 'false'),
  ),
};
