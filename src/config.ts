import { SystemConfig, HostConfig } from "@raftainer/models";

/**
 * Extended system configuration that includes Consul datacenter
 */
export interface ExtendedSystemConfig extends SystemConfig {
  readonly consul: SystemConfig['consul'] & {
    readonly datacenter?: string;
  };
}

/**
 * Configuration object that combines system and host configuration
 * Loads values from environment variables
 */
export const config: ExtendedSystemConfig & HostConfig = {
  name: process.env.HOSTNAME!,
  region: process.env.RAFTAINER_REGION!,
  secureIp: process.env.RAFTAINER_SECURE_IP,
  internalIp: process.env.RAFTAINER_INTERNAL_IP!,
  consul: {
    host: process.env.RAFTAINER_CONSUL_HOST!,
    port: Number(process.env.RAFTAINER_CONSUL_PORT || "8500"),
    datacenter: process.env.RAFTAINER_CONSUL_DATACENTER,
  },
  fastStartup: Boolean(
    JSON.parse(process.env.RAFTAINER_FAST_STARTUP || "false"),
  ),
};
