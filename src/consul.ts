import Consul from "consul";
import { config } from "./config";
import { logger } from "./logger";
import { Pod, ConsulPodEntry } from "@raftainer/models";

export const HostSessionName = "Raftainer Host";
export const RaftainerPodsKey = "raftainer/pods/configs";

export interface ConsulPodEntryWithLock extends ConsulPodEntry {
  readonly lockKey: string;
}

export type PodLock = { [podName: string]: string };

// Mark the host as online
export async function configureHostSession(
  consul: Consul.Consul,
): Promise<string> {
  if (!config.fastStartup) {
    while (
      // @ts-expect-error consul API call
      (await consul.session.node(config.name)).find(
        // @ts-expect-error consul API call
        ({ Name: name }) => name === HostSessionName,
      )
    ) {
      logger.warn(
        "Node already has a Raftainer lock. Waiting for lock to expire...",
      );
      await new Promise((resolve) =>
        setTimeout(resolve, 10_000 * Math.random()),
      );
    }
  }
  // @ts-expect-error consul API call
  const session: string = (
    await consul.session.create({
      name: HostSessionName,
      node: config.name,
      ttl: "10s",
      lockdelay: "10s",
    })
  ).ID;
  logger.info(`Created consul session: ${session}`);

  setInterval(async () => {
    // @ts-expect-error consul API call
    const [{ CreateIndex: createIndex, ModifyIndex: modifyIndex }] =
      await consul.session.renew(session);
    logger.trace(
      `Renewed consul session: ${session}: ${createIndex}, ${modifyIndex}`,
    );
  }, 5_000);

  process.on("exit", function () {
    consul.session.destroy(session).catch((error) => {
      logger.error(
        `Failed to destroy consul session during shutdown: ${error}`,
      );
    });
  });

  return session;
}

// List all pods
export async function getPods(
  consul: Consul.Consul,
): Promise<ConsulPodEntry[]> {
  const keys: string[] = await consul.kv.keys(RaftainerPodsKey);
  logger.info({ keys }, "All Consul Raftainer keys");
  return await Promise.all(
    keys.map(async (key: string) => {
      // @ts-expect-error consul API call
      const json: string = (await consul.kv.get(key)).Value;
      return { key, pod: JSON.parse(json) as Pod };
    }),
  );
}

async function tryLock(
  consul: Consul.Consul,
  session: string,
  lockKey: string,
) {
  const lockResult = await consul.kv.set({
    key: lockKey,
    value: JSON.stringify({
      holder: session,
      host: config.name,
      region: config.region,
      timestamp: Date.now(),
    }),
    acquire: session,
  });
  logger.debug("Lock result for key %s: ", lockKey, lockResult || false);
  return lockResult;
}

function getLockKey(podName: string, index: Number): string {
  return `raftainer/pods/locks/${podName}/${index}.lock`;
}

// Try to lock a slot for a pod deployment
export async function tryLockPod(
  consul: Consul.Consul,
  session: string,
  podLocks: PodLock,
  pod: ConsulPodEntry,
): Promise<ConsulPodEntryWithLock | null> {
  logger.info({ pod }, "Attempting to lock pod");

  // Try to use existing lock key, iff it would not violate the current `maxInstances` count
  let lockKey = podLocks[pod.pod.name];
  if (lockKey && lockKey < getLockKey(pod.pod.name, pod.pod.maxInstances)) {
    const lockResult = await tryLock(consul, session, lockKey);
    if (lockResult) {
      logger.info("Got lock %s for pod %s", lockKey, pod.pod.name);
      return { ...pod, lockKey };
    }
  } else {
    logger.debug({ lockKey }, "Skipping lock key");
  }

  for (let i = 0; i < pod.pod.maxInstances; i++) {
    lockKey = getLockKey(pod.pod.name, i);
    logger.debug("Attempting to lock key %s", lockKey);
    const lockResult = await tryLock(consul, session, lockKey);
    if (lockResult) {
      logger.info("Got lock %s for pod %s", lockKey, pod.pod.name);
      return { ...pod, lockKey };
    }
  }
  logger.info("Did not get lock for pod %s", pod.pod.name);

  return null;
}

/**
 * If we failed to deploy a pod, release it so that other hosts can attempt
 * to launch it.
 */
export async function releasePod(
  consul: Consul.Consul,
  session: string,
  pod: ConsulPodEntryWithLock,
  error: any,
) {
  consul.kv.set({
    key: pod.lockKey,
    value: JSON.stringify({
      error,
      host: config.name,
      region: config.region,
      timestamp: Date.now(),
    }),
    release: session,
  });
}
