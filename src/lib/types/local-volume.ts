export interface LocalVolume {
  readonly hostPath: string;
  readonly containerPath: string;
  readonly mode: 'ro' | 'rw';
}
