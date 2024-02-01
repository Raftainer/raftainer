import { ExposedPort } from "./exposed-port";

/**
 * Configuration for a docker container in a pod
 */
export interface Container {
  readonly name: string;
  readonly image: string;
  readonly environment: {[name: string]: string};
  readonly localVolumes: {[containerPath: string]: string};
  readonly restartPolicy: string;
  readonly ports: ExposedPort[];
};
