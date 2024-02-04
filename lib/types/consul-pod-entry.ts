import { Pod } from "./pod";

export interface ConsulPodEntry {
  readonly key: string;
  readonly pod: Pod;
}
