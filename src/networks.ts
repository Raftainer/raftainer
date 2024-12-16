import Docker, { Network, NetworkInspectInfo } from "dockerode";
import { logger } from "./logger";
import { ConsulPodEntry, OrchestratorName } from "@raftainer/models";

type ExistingNetworks = { [name: string]: Network };

async function getExistingNetworks(docker: Docker): Promise<ExistingNetworks> {
  const existingNetworks: NetworkInspectInfo[] = await docker.listNetworks({
    all: true,
    filters: {
      label: [`OrchestratorName=${OrchestratorName}`],
    },
  });

  return existingNetworks.reduce(
    (obj: ExistingNetworks, network: NetworkInspectInfo) => {
      obj[network.Name] = docker.getNetwork(network.Id);
      return obj;
    },
    {},
  );
}

async function createNetwork(docker: Docker, name: string): Promise<Network> {
  logger.info({ name }, "Creating docker network");
  return await docker.createNetwork({
    Name: name,
    CheckDuplicate: true,
    Labels: {
      OrchestratorName,
    },
  });
}

async function deleteNetwork(_: Docker, network: Network) {
  logger.info({ id: network.id }, "Removing network");
  await network.remove({
    force: true,
  });
}

export interface PodNetworks {
  readonly primary: Network;
}

function getNetworkName(podName: string): string {
  return `Raftainer-${podName}`;
}

export async function launchPodNetworks(
  docker: Docker,
  podEntry: ConsulPodEntry,
): Promise<PodNetworks> {
  const networkName = getNetworkName(podEntry.pod.name);
  const existingNetworks = await getExistingNetworks(docker);
  if (existingNetworks[networkName]) {
    //TODO: update network settings as needed
    return { primary: existingNetworks[networkName] };
  }

  return {
    primary: await createNetwork(docker, networkName),
  };
}

export async function stopOrphanedNetworks(
  docker: Docker,
  activePodNames: Set<string>,
) {
  const expectedNetworkNames: Set<string> = new Set(
    Array.from(activePodNames).map((podName) => getNetworkName(podName)),
  );
  const existingNetworks = await getExistingNetworks(docker);
  for (const [name, network] of Object.entries(existingNetworks)) {
    if (!expectedNetworkNames.has(name)) {
      try {
        await deleteNetwork(docker, network);
      } catch (error) {
        logger.warn({ name, error }, "Unable to delete orphaned network");
      }
    }
  }
  logger.info("Removed orphaned networks");
}
