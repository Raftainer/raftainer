import Consul from "@wkronmiller/consul";
import { logger } from "./logger";
import { deregisterServices } from "./consul";
import { config } from "./config";
import { InternalPort, TraefikPort } from "@raftainer/models/dist";

const UpdateInterval = 10_000;

async function registerPod(consul: Consul, pod: any) {
  const id = `raftainer-${pod.podEntry.pod.name}-pod`;
  await consul.agent.service.register({
    id,
    name: pod.podEntry.pod.name,
    tags: [
      "raftainer",
      "raftainer-pod",
      "pod",
      `host-${config.name}`,
      `region-${config.region}`,
    ],
    check: {
      name: `raftainer-${pod.podEntry.pod.name}-check`,
      timeout: `${(UpdateInterval / 1_000) * 10}s`,
      ttl: `${(UpdateInterval / 1_000) * 10}s`,
    },
  });
  if (pod.error) {
    logger.warn({ id, error: pod.error }, "Marking service unhealthy");
    await consul.agent.check.fail({
      id: `service:${id}`,
      note: String(pod.error),
    });
  } else {
    logger.info({ id }, "Marking service healthy");
    await consul.agent.check.pass(`service:${id}`);
  }
  return id;
}

async function registerInternalPorts(consul: Consul, pod: any) {
  const ids = [];
  for (const container of pod.podEntry.pod.containers) {
    if (container.ports) {
      for (const port of container.ports) {
        if ("internalPort" in port) {
          const id = `raftainer-${pod.podEntry.pod.name}-${port.name}`;
          await consul.agent.service.register({
            id,
            name: pod.podEntry.pod.name,
            address: config.internalIp,
            port: port.internalPort,
            tags: [
              "raftainer",
              "raftainer-internal-port",
              "container",
              `host-${config.name}`,
              `region-${config.region}`,
              ...("hostname" in port
                ? [
                    "traefik.enable=true",
                    `traefik.http.routers.${id}-router.rule=Host(\`${port.hostname}\`)`,
                  ]
                : []),
            ],
            check: {
              name: `raftainer-${pod.podEntry.pod.name}-${container.name}-check`,
              interval: "10s",
              timeout: "5s",
              tcp: `${config.internalIp}:${port.internalPort}`,
              deregistercriticalserviceafter: "5m",
            },
          });
          logger.info({ id }, "Registered service for internal port");
          ids.push(id);
        }
      }
    }
  }
  return ids;
}

export async function registerPods(
  consul: Consul,
  launchedPods: any[],
): Promise<string[]> {
  const serviceIds: string[] = (
    await Promise.all(
      launchedPods
        .map(async (pod) => {
          const podId = await registerPod(consul, pod);
          const portIds = await registerInternalPorts(consul, pod);
          return [podId, ...portIds];
        })
        .map((promise) =>
          promise.catch((err) => {
            logger.error({ err }, "Failed to launch pod");
            return null;
          }),
        ),
    )
  )
    .flat()
    .filter((a) => a !== null);

  await deregisterServices(consul, serviceIds);
  logger.info("Synced services", { serviceIds });

  return serviceIds;
}
