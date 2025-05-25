import Docker from "dockerode";
import { logger } from "./logger";
import { ConsulPodEntryWithLock } from "./consul";
import { launchPodContainers } from "./containers";
import { launchPodNetworks } from "./networks";
import { Vault } from "./vault";
import { TTLCache } from "./ttlCache";

export async function launchPods(
  lockedPods: ConsulPodEntryWithLock[],
  docker: Docker,
  vault: Vault,
  failedPods: TTLCache<string, string>,
) {
  const launchedPods = Promise.all(
    lockedPods.map(async (podEntry: ConsulPodEntryWithLock) => {
      try {
        logger.trace({ podEntry }, "Loading vault secrets");
        const networks = await launchPodNetworks(docker, podEntry);
        logger.trace({ podEntry, networks }, "Launched pod networks");
        const { launchedContainers } = await launchPodContainers(
          docker,
          vault,
          networks,
          podEntry,
        );
        logger.debug("Launched pod %s", podEntry.pod.name);
        return { podEntry, launchedContainers, networks };
      } catch (error) {
        failedPods.set(podEntry.pod.name, String(error));
        logger.error({ error, podEntry }, "Failed to launch pod");
        return { podEntry, error };
      }
    }),
  );

  return launchedPods;
}
