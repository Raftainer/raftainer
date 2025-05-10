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
    try {
      const { controllers: gpus }: Systeminformation.GraphicsData = await si.graphics();
      logger.debug({ 
        podName: pod.pod.name, 
        availableGpus: gpus.map(gpu => ({ 
          model: gpu.model, 
          vram: gpu.vram 
        }))
      }, 'Checking GPU constraints');

      const gpuConstraints = pod.pod.containers.flatMap(container => container.hardwareConstraints?.gpus || []);
      for (const constraint of gpuConstraints) {
        if (constraint.gpuCount > gpus.length) {
          logger.debug({ 
            podName: pod.pod.name, 
            requiredCount: constraint.gpuCount, 
            availableCount: gpus.length 
          }, 'GPU count constraint not met');
          return false;
        }
        if (constraint.vramBytes && !gpus.some(gpu => (gpu.vram || 0) >= (constraint.vramBytes || 0))) {
          logger.debug({ 
            podName: pod.pod.name, 
            requiredVram: constraint.vramBytes, 
            availableVram: gpus.map(gpu => gpu.vram) 
          }, 'GPU VRAM constraint not met');
          return false;
        }
      }
      return true;
    } catch (error) {
      logger.error({ 
        podName: pod.pod.name, 
        error: error,
        message: error.message,
        stack: error.stack
      }, 'Error checking GPU constraints');
      return false;
    }
  }

  /**
   * Checks if the host system meets all hardware constraints for a pod
   * @param pod Pod entry to check constraints for
   * @returns True if all constraints are met, false otherwise
   */
  async meetsConstraints(pod: ConsulPodEntry) {
    try {
      logger.debug({ podName: pod.pod.name }, 'Checking hardware constraints');
      const result = await this.meetsGpuConstraints(pod);
      logger.debug({ podName: pod.pod.name, result }, 'Hardware constraint check result');
      return result;
    } catch (error) {
      logger.error({ 
        podName: pod.pod.name, 
        error: error,
        message: error.message,
        stack: error.stack
      }, 'Error checking hardware constraints');
      return false;
    }
  }

}
