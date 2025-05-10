import Docker, { Network, NetworkInspectInfo, NetworkListOptions } from 'dockerode';
import { logger } from './logger';
import { ConsulPodEntry, OrchestratorName } from '@raftainer/models';

type ExistingNetworks = { [name: string]: Network };

/**
 * Retrieves all Docker networks created by Raftainer
 * @param docker Docker client instance
 * @returns Object mapping network names to their Network objects
 */
async function getExistingNetworks(docker: Docker): Promise<ExistingNetworks> {
  const existingNetworks: NetworkInspectInfo[] = await docker.listNetworks({
    all: true,
    filters: {
      label: [`OrchestratorName=${OrchestratorName}`],
    },
  } as NetworkListOptions);

  return existingNetworks.reduce(
    (obj: ExistingNetworks, network: NetworkInspectInfo) => {
      obj[network.Name] = docker.getNetwork(network.Id);
      return obj;
    },
    {},
  );
}

/**
 * Creates a new Docker network for a pod
 * @param docker Docker client instance
 * @param name Name for the new network
 * @returns Created Network object
 */
async function createNetwork(docker: Docker, name: string): Promise<Network> {
  logger.info({ name }, 'Creating docker network');
  return await docker.createNetwork({
    Name: name,
    CheckDuplicate: true,
    Labels: {
      OrchestratorName,
    },
  });
}

/**
 * Removes a Docker network
 * @param _ Docker client instance (unused)
 * @param network Network object to remove
 */
async function deleteNetwork(_: Docker, network: Network) {
  logger.info({ id: network.id }, 'Removing network');
  await network.remove({
    force: true,
  });
}

export interface PodNetworks {
  readonly primary: Network;
}

/**
 * Generates a standardized network name for a pod
 * @param podName Name of the pod
 * @returns Formatted network name
 */
function getNetworkName(podName: string): string {
  return `Raftainer-${podName}`;
}

export async function launchPodNetworks(
  docker: Docker,
  podEntry: ConsulPodEntry,
): Promise<PodNetworks> {
  const networkName = getNetworkName(podEntry.pod.name);
  const existingNetworks = await getExistingNetworks(docker);
  logger.info({ networkName, existingNetworks: Object.keys(existingNetworks) }, 'Existing networks');
  if (existingNetworks[networkName]) {
    logger.debug({ networkName }, 'Re-using existing network');
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
  const deletedNetworks: string[] = [];
  for (const [name, network] of Object.entries(existingNetworks)) {
    if (!expectedNetworkNames.has(name)) {
      try {
        await deleteNetwork(docker, network);
        deletedNetworks.push(name);
      } catch (error) {
        logger.warn({ name, error }, 'Unable to delete orphaned network');
      }
    }
  }
  if(deletedNetworks.length > 0) {
    logger.info({ deletedNetworks }, 'Removed orphaned networks');
  }
  return deletedNetworks;

}
