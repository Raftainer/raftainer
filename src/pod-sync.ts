import Docker from "dockerode";
import Consul from "@wkronmiller/consul";
import { logger } from "./logger";
import { getPods, releasePod, PodLock } from "./consul";
import { ConsulPodEntry } from "@raftainer/models";
import { stopOrphanedContainers } from "./containers";
import { stopOrphanedNetworks } from "./networks";
import { Vault } from "./vault";
import { ConstraintMatcher } from "./constraint-matcher";
import { TTLCache } from "./ttlCache";
import { lockPods } from "./pod-locking";
import { launchPods } from "./pod-launcher";
import { registerPods } from "./pod-registration";

export async function syncPods(
  consul: Consul,
  docker: Docker,
  session: string,
  podLocks: PodLock,
  failedPods: TTLCache<string, string>,
  constraintMatcher: ConstraintMatcher,
  vault: Vault,
) {
  const syncStartTime = Date.now();
  logger.info("Starting pod synchronization", { session });

  try {
    const podEntries: ConsulPodEntry[] = await getPods(consul);
    logger.debug(
      { podCount: podEntries.length },
      "Retrieved pod definitions from Consul",
    );

    const lockedPods = await lockPods(
      podEntries,
      consul,
      session,
      podLocks,
      failedPods,
      constraintMatcher,
    );
    logger.debug(
      {
        lockedPodCount: lockedPods.length,
        lockedPods: lockedPods.map((p) => p.pod.name),
      },
      "Locked pods for this host",
    );

    const launchedPods = await launchPods(
      lockedPods,
      docker,
      vault,
      failedPods,
    );

    const successfulPods = launchedPods.filter(({ error }) => !error);
    const failedPodsResults = launchedPods.filter(({ error }) => error);

    logger.info(
      {
        successCount: successfulPods.length,
        failCount: failedPodsResults.length,
        successfulPods: successfulPods.map((p) => p.podEntry.pod.name),
        failedPods: failedPodsResults.map((p) => p.podEntry.pod.name),
      },
      "Pod launch results",
    );

    if (failedPodsResults.length > 0) {
      logger.error(
        {
          failedPods: failedPodsResults.map((p) => ({
            name: p.podEntry.pod.name,
            error: p.error,
          })),
        },
        "Failed to launch some pods",
      );

      for (const { podEntry, error } of failedPodsResults) {
        logger.debug(
          {
            podName: podEntry.pod.name,
            error,
          },
          "Releasing lock for failed pod",
        );
        await releasePod(consul, session, podEntry, error);
      }
    }

    const registeredServiceIds = await registerPods(consul, successfulPods);
    logger.debug(
      {
        registeredCount: registeredServiceIds.length,
        serviceIds: registeredServiceIds,
      },
      "Registered services in Consul",
    );

    const successfulPodNames = new Set(
      successfulPods.map((pod) => pod.podEntry.pod.name),
    );

    await stopOrphanedContainers(docker, successfulPodNames);
    await stopOrphanedNetworks(docker, successfulPodNames);

    const syncDuration = Date.now() - syncStartTime;
    logger.info("Sync complete", {
      session,
      successfulPodCount: successfulPodNames.size,
      successfulPods: Array.from(successfulPodNames),
      failedPodCount: failedPodsResults.length,
      durationMs: syncDuration,
    });
  } catch (error) {
    process.exit(1);
    const syncDuration = Date.now() - syncStartTime;
    logger.error(
      {
        error: error,
        message: error.message,
        stack: error.stack,
        durationMs: syncDuration,
      },
      "Error during pod synchronization",
    );
  }
}
