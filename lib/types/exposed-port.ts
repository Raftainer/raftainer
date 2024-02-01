/**
 * Configuration for a port exposed by a container
 */
export interface ExposedPort {
  // Name of the service that this port exposes (e.g. "ui" or "postgres")
  readonly name: string;
  readonly protocol: 'HTTP' | 'HTTPS' | 'TCP' | 'UDP';
  readonly portType: 'Internal' | 'External';
  // The port inside the container to forward traffic to
  readonly containerPort: number;
}

/**
 * Configuration for a port that is exposed over a secure data plane 
 * such as WireGuard or an overlay network.
 */
export interface InternalPort extends ExposedPort {
  readonly portType: 'Internal';
  readonly internalPort: number;
}

/**
 * Configuration for a port that is exposed on the host's primary interface
 */
export interface ExternalPort extends ExposedPort {
  readonly portType: 'External';
  readonly externalPort: number;
}
