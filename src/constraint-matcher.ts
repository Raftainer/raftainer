import { ConsulPodEntry } from '@raftainer/models/dist';
import si, { Systeminformation } from 'systeminformation';

/**
 * Checks whether a host system can run a pod, based on hardware constraints
 */
export class ConstraintMatcher {

  private async meetsGpuConstraints(pod: ConsulPodEntry) {
    const { controllers: gpus }: Systeminformation.GraphicsData = await si.graphics();

    const gpuConstraints = pod.pod.containers.flatMap(container => container.hardwareConstraints?.gpus || []);
    for (const constraint of gpuConstraints) {
      if (constraint.gpuCount > gpus.length) {
        return false;
      }
      if (constraint.vramBytes && !gpus.some(gpu => (gpu.vram || 0) >= (constraint.vramBytes || 0))) {
        return false;
      }
    }
  }

  async meetsConstraints(pod: ConsulPodEntry) {
    return await this.meetsGpuConstraints(pod);
  }

}
