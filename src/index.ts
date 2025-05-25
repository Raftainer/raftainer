import Docker from "dockerode";
import Consul from "@wkronmiller/consul";
import { logger } from "./logger";
import { configureHostSession, PodLock, RaftainerPodsKey } from "./consul";
import { config } from "./config";
import { Vault } from "./vault";
import { ConstraintMatcher } from "./constraint-matcher";
import { Mutex } from "async-mutex";
import { TTLCache } from "./ttlCache";
import { syncPods } from "./pod-sync";

const vault = new Vault();

const podLocks: PodLock = {};
const failedPods = new TTLCache<string, string>(5 * 60 * 1000);

const UpdateInterval = 10_000;

const constraintMatcher = new ConstraintMatcher();

(async function main() {
  logger.info("Starting service");

  logger.debug("Initializing consul connection");
  const consul: Consul = new Consul({
    host: config.consul.host,
    port: config.consul.port,
  });

  logger.debug("Initializing docker connection");
  const docker = new Docker();

  await docker.pruneVolumes({});
  await docker.pruneImages({});
  await docker.pruneNetworks({});

  const session: string = await configureHostSession(consul);

  const configWatch = consul.watch({
    method: consul.kv.get,
    options: {
      key: RaftainerPodsKey,
      //@ts-ignore
      recurse: true,
    },
  });

  // Only sync one at a time
  const syncMutex = new Mutex();

  configWatch.on("change", (change) => {
    logger.info({ change }, "Config changed");
    syncMutex.runExclusive(() =>
      syncPods(
        consul,
        docker,
        session,
        podLocks,
        failedPods,
        constraintMatcher,
        vault,
      ),
    );
  });

  while (true) {
    await syncMutex.runExclusive(
      async () =>
        await syncPods(
          consul,
          docker,
          session,
          podLocks,
          failedPods,
          constraintMatcher,
          vault,
        ),
    );
    await new Promise((resolve) => setTimeout(resolve, UpdateInterval));
  }
})().catch((err) => {
  logger.error(`Service crashed: ${err}`);
});
