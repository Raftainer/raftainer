import { Container } from "./container";

/**
 * A group of containers that are launched together
 */ 
export interface Pod {
  readonly name: string;
  readonly containers: Container[];
  // Number of copies of the pod to launch
  readonly maxInstances: number;
  // Names of hosts that this pod can be launched on (e.g. server-1)
  readonly allowedHosts?: string[];
  // Names of geographic regions that this pod can be launched on (e.g. IAD-1)
  readonly allowedRegions?: string[];
};
