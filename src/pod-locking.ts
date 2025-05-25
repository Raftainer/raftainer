import Consul from "@wkronmiller/consul";
import { logger } from "./logger";
import { tryLockPod, ConsulPodEntryWithLock, PodLock } from "./consul";
import { ConsulPodEntry } from "@raftainer/models";
import { ConstraintMatcher } from "./constraint-matcher";
import { TTLCache } from "./ttlCache";

export async function lockPods(
  podEntries: ConsulPodEntry[],
  consul: Consul,
  session: string,
  podLocks: PodLock,
  failedPods: TTLCache<string, string>,
  constraintMatcher: ConstraintMatcher,
): Promise<ConsulPodEntryWithLock[]> {
  try {
    logger.debug({ podCount: podEntries.length }, "Attempting to lock pods");

    const lockResults = await Promise.all(
      podEntries.map(async (podEntry) => {
        try {
          if (!(await constraintMatcher.meetsConstraints(podEntry))) {
            logger.info(
              {
                podName: podEntry.pod.name,
                constraints: podEntry.pod.containers.flatMap(
                  (c) => c.hardwareConstraints?.gpus || [],
                ),
              },
              "Host does not meet pod constraints",
            );
            return null;
          }

          const failureReason = failedPods.get(podEntry.pod.name);
          if (failureReason) {
            logger.warn(
              {
                podName: podEntry.pod.name,
                failureReason,
              },
              "Skipping previously failed pod",
            );
            return null;
          }

          logger.debug(
            { podName: podEntry.pod.name },
            "Attempting to lock pod",
          );
          const result = await tryLockPod(consul, session, podLocks, podEntry);
          if (result) {
            logger.debug(
              {
                podName: podEntry.pod.name,
                lockKey: result.lockKey,
              },
              "Successfully locked pod",
            );
          } else {
            logger.debug({ podName: podEntry.pod.name }, "Failed to lock pod");
          }
          return result;
        } catch (error) {
          logger.error(
            {
              podName: podEntry.pod.name,
              error: error,
              message: error.message,
              stack: error.stack,
            },
            "Error while trying to lock pod",
          );
          return null;
        }
      }),
    );

    const lockedPods: ConsulPodEntryWithLock[] = lockResults
      .filter((elem) => elem !== null)
      .map((elem) => elem as ConsulPodEntryWithLock);

    logger.info(
      {
        lockedPodCount: lockedPods.length,
        lockedPods: lockedPods.map((p) => p.pod.name),
        session,
      },
      "Acquired pods",
    );

    for (const lockedPod of lockedPods) {
      podLocks[lockedPod.pod.name] = lockedPod.lockKey;
    }

    return lockedPods;
  } catch (error) {
    logger.error(
      {
        error: error,
        message: error.message,
        stack: error.stack,
      },
      "Error locking pods",
    );
    return [];
  }
}
