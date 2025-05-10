import { ConsulPodEntry } from '@raftainer/models/dist';
import si, { Systeminformation } from 'systeminformation';

/**
 * Checks whether a host system can run a pod, based on hardware constraints
 */
export class ConstraintMatcher {

  /**
   * Checks if the host system meets the GPU constraints specified by the pod
   * @param pod Pod entry to check constraints for
   * @returns True if constraints are met, false otherwise
   */
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

  /**
   * Checks if the host system meets all hardware constraints for a pod
   * @param pod Pod entry to check constraints for
   * @returns True if all constraints are met, false otherwise
   */
  async meetsConstraints(pod: ConsulPodEntry) {
    return await this.meetsGpuConstraints(pod);
  }

}
