import { ExposedPort } from "./exposed-port";
import { LocalVolume } from "./local-volume";

/**
 * Configuration for a docker container in a pod
 */
export interface Container {
  readonly name: string;
  readonly image: string;
  readonly environment: {[name: string]: string};
  readonly localVolumes: LocalVolume[];
  readonly restartPolicy: 'no' | 'on-failure' | 'always' | 'unless-stopped';
  readonly ports: ExposedPort[];
};
