import Docker from "dockerode";
import Consul from "consul";
import { logger } from "./logger";
import {
  configureHostSession,
  getPods,
  tryLockPod,
  ConsulPodEntryWithLock,
  PodLock,
  RaftainerPodsKey,
  releasePod,
  deregisterServices,
} from "./consul";
import { launchPodContainers, stopOrphanedContainers } from "./containers";
import { ConsulPodEntry } from "@raftainer/models";
import { config } from "./config";
import { launchPodNetworks, stopOrphanedNetworks } from "./networks";
import { Vault } from "./vault";

const vault = new Vault();

const podLocks: PodLock = {};

const UpdateInterval = 10_000;

async function syncPods(
  consul: Consul.Consul,
  docker: Docker,
  session: string,
) {
  logger.info("Syncing pods", { session });
  const podEntries: ConsulPodEntry[] = await getPods(consul);

  logger.debug("Full list of pods", { podEntries });
  const lockedPods: ConsulPodEntryWithLock[] = (
    await Promise.all(
      podEntries.map(async (podEntry) =>
        tryLockPod(consul, session, podLocks, podEntry),
      ),
    )
  )
    .filter((elem) => elem !== null)
    .map((elem) => elem as ConsulPodEntryWithLock);
  logger.debug("Acquired pods", { podEntries, session });

  for (const lockedPod of lockedPods) {
    podLocks[lockedPod.pod.name] = lockedPod.lockKey;
  }

  const launchedPods = await Promise.all(
    lockedPods.map(async (podEntry) => {
      try {
        logger.trace({ podEntry }, "Loading vault secrets");
        const vaultSecrets: Record<string, string> = await vault.kvRead(`raftainer/${podEntry.pod.name}`);
        logger.trace({ podEntry }, "Loaded vault secrets");
        const networks = await launchPodNetworks(docker, podEntry);
        logger.trace({ podEntry, networks, }, "Launched pod networks");
        const { launchedContainers } = await launchPodContainers(
          docker,
          vaultSecrets,
          networks,
          podEntry,
        );
        logger.info("Launched pod %s", podEntry.pod.name);
        return { podEntry, launchedContainers, networks };
      } catch (error) {
        logger.error({ error, podEntry, }, 'Failed to laucnh pod');
        return { podEntry, error };
      }
    }),
  );

  // (Re)init pods
  const serviceIds = await Promise.all(
    launchedPods.map(async (pod) => {
      const id = `raftainer-${pod.podEntry.pod.name}-pod`;
      await consul.agent.service.register({
        id,
        name: pod.podEntry.pod.name,
        tags: ["raftainer", "pod", `host-${config.name}`, `region-${config.region}`],
        check: {
          ttl: `${(UpdateInterval / 1_000) * 1.2}s`,
        },
      });
      if (pod.error) {
        await consul.agent.check.fail({
          id: `service:${id}`,
          note: String(pod.error),
        });
      } else {
        logger.info({ id }, "Marking service healthy");
        await consul.agent.check.pass(`service:${id}`);
      }
      return id;
    }),
  );

  // Clear existing registrations
  await deregisterServices(consul, serviceIds);

  const successfulPods = launchedPods.filter(({ error }) => !error);
  const failedPods = launchedPods.filter(({ error }) => error);

  if (failedPods.length > 0) {
    logger.error({ failedPods }, "Failed to launch all pods");
    for (const { podEntry, error } of failedPods) {
      await releasePod(consul, session, podEntry, error);
    }
  }

  // Deregister old pods
  const successfulPodNames = new Set(
    successfulPods.map((pod) => pod.podEntry.pod.name),
  );
  await stopOrphanedContainers(docker, successfulPodNames);
  await stopOrphanedNetworks(docker, successfulPodNames);
}

(async function main() {
  logger.info("Starting service");

  logger.debug("Initializing consul connection");
  const consul: Consul.Consul = new Consul({
    host: config.consul.host,
    port: String(config.consul.port),
  });

  logger.debug("Initializing docker connection");
  const docker = new Docker();

  await docker.pruneVolumes({});
  await docker.pruneImages({});
  await docker.pruneNetworks({});

  const session: string = await configureHostSession(consul);
  syncPods(consul, docker, session);

  const configWatch = consul.watch({
    method: consul.kv.get,
    options: {
      key: RaftainerPodsKey,
      //@ts-ignore
      recurse: true,
    },
  });
  configWatch.on("change", (change) => {
    logger.debug({ change }, "Config changed");
    syncPods(consul, docker, session);
  });

  setInterval(() => syncPods(consul, docker, session), UpdateInterval);
})().catch((err) => {
  logger.error(`Service crashed: ${err}`);
});
