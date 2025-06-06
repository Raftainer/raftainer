import Consul from "@wkronmiller/consul";
import { config } from "./config";
import { logger } from "./logger";
import { Pod, ConsulPodEntry } from "@raftainer/models";

export const HostSessionName = "Raftainer Host";
export const RaftainerPodsKey = "raftainer/pods/configs";

export interface ConsulPodEntryWithLock extends ConsulPodEntry {
  readonly lockKey: string;
}

/**
 * Maps pod names to their lock keys in Consul
 */
export type PodLock = { [podName: string]: string };

// Mark the host as online
export async function configureHostSession(consul: Consul): Promise<string> {
  if (!config.fastStartup) {
    while (
      (await consul.session.node(config.name)).find(
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
  const session: string = (
    await consul.session.create({
      name: HostSessionName,
      node: config.name,
      ttl: "90s",
      lockdelay: "10s",
    })
  ).ID;
  logger.debug(`Created consul session: ${session}`);

  setInterval(async () => {
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
export async function getPods(consul: Consul): Promise<ConsulPodEntry[]> {
  const keys: string[] = await consul.kv.keys(RaftainerPodsKey);
  logger.debug({ keys }, "All Consul Raftainer keys");
  return await Promise.all(
    keys.map(async (key: string) => {
      // @ts-expect-error consul API call
      const json: string = (await consul.kv.get(key)).Value;
      return { key, pod: JSON.parse(json) as Pod };
    }),
  );
}

async function tryLock(consul: Consul, session: string, lockKey: string) {
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

/**
 * Generates a Consul lock key for a specific pod and instance index
 * @param podName Name of the pod
 * @param index Instance index of the pod
 * @returns Formatted lock key string
 */
function getLockKey(podName: string, index: number): string {
  return `raftainer/pods/locks/${podName}/${index}.lock`;
}

// Try to lock a slot for a pod deployment
export async function tryLockPod(
  consul: Consul,
  session: string,
  podLocks: PodLock,
  pod: ConsulPodEntry,
): Promise<ConsulPodEntryWithLock | null> {
  logger.debug({ pod }, "Attempting to lock pod");

  // Try to use existing lock key, iff it would not violate the current `maxInstances` count
  let lockKey = podLocks[pod.pod.name];
  if (lockKey && lockKey < getLockKey(pod.pod.name, pod.pod.maxInstances)) {
    const lockResult = await tryLock(consul, session, lockKey);
    if (lockResult) {
      logger.debug("Got lock %s for pod %s", lockKey, pod.pod.name);
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
      logger.debug("Got lock %s for pod %s", lockKey, pod.pod.name);
      return { ...pod, lockKey };
    }
  }
  logger.debug("Did not get lock for pod %s", pod.pod.name);

  return null;
}

/**
 * If we failed to deploy a pod, release it so that other hosts can attempt
 * to launch it.
 */
export async function releasePod(
  consul: Consul,
  session: string,
  pod: ConsulPodEntryWithLock,
  error: any,
) {
  try {
    await consul.kv.set({
      key: pod.lockKey,
      value: JSON.stringify({
        error:
          typeof error === "object" ? JSON.stringify(error) : String(error),
        host: config.name,
        region: config.region,
        timestamp: Date.now(),
      }),
      release: session,
    });
    logger.info(
      { podName: pod.pod.name, lockKey: pod.lockKey },
      "Successfully released pod lock",
    );
  } catch (releaseError) {
    logger.error(
      {
        podName: pod.pod.name,
        lockKey: pod.lockKey,
        error: releaseError,
      },
      "Failed to release pod lock",
    );
  }
}

/**
 * Remove local Consul Service registrations for Raftainer pods that are no longer
 * deployed to the current host.
 */
export async function deregisterServices(
  consul: Consul,
  activeServiceIds: string[],
) {
  try {
    const registeredServices: object = await consul.agent.service.list();
    logger.debug({ registeredServices }, "Loaded registered Consul services");
    const servicesToDeregister = new Set(
      Object.entries(registeredServices)
        //.filter(([_, metadata]) => metadata.Tags.includes('raftainer-pod'))
        .filter(([_, metadata]) => metadata.Tags.includes("raftainer"))
        .filter(([id]) => !activeServiceIds.includes(id))
        .map(([id]) => id),
    );
    if (servicesToDeregister.size > 0) {
      logger.info(
        {
          servicesToDeregister,
          activeCount: activeServiceIds.length,
        },
        "Deregistering services",
      );
      const results = await Promise.all(
        Array.from(servicesToDeregister).map((id) =>
          consul.agent.service
            .deregister(id)
            .catch((err) => {
              logger.error(
                {
                  id,
                  error: err,
                  message: err.message,
                  stack: err.stack,
                },
                "Failed to deregister service",
              );
              return { id, success: false, error: err };
            })
            .then(() => ({ id, success: true })),
        ),
      );
      logger.debug({ results }, "Service deregistration results");
    }
  } catch (error) {
    logger.error(
      {
        error: error,
        message: error.message,
        stack: error.stack,
      },
      "Error listing or deregistering services",
    );
  }
}
