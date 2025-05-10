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
  try {
    logger.info({ id: network.id }, 'Removing network');
    await network.remove({
      force: true,
    });
    logger.debug({ id: network.id }, 'Successfully removed network');
  } catch (error) {
    logger.error({ 
      id: network.id, 
      error: error,
      message: error.message,
      stack: error.stack
    }, 'Failed to remove network');
    throw error; // Re-throw to allow caller to handle
  }
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
  try {
    const expectedNetworkNames: Set<string> = new Set(
      Array.from(activePodNames).map((podName) => getNetworkName(podName)),
    );
    logger.debug({ 
      expectedNetworkNames: Array.from(expectedNetworkNames),
      activePodCount: activePodNames.size
    }, 'Checking for orphaned networks');
    
    const existingNetworks = await getExistingNetworks(docker);
    logger.debug({ 
      existingNetworkCount: Object.keys(existingNetworks).length,
      existingNetworks: Object.keys(existingNetworks)
    }, 'Found existing networks');
    
    const deletedNetworks: string[] = [];
    const failedDeletions: {name: string, error: any}[] = [];
    
    for (const [name, network] of Object.entries(existingNetworks)) {
      if (!expectedNetworkNames.has(name)) {
        try {
          logger.debug({ name, id: network.id }, 'Attempting to delete orphaned network');
          await deleteNetwork(docker, network);
          deletedNetworks.push(name);
        } catch (error) {
          failedDeletions.push({ name, error });
          logger.warn({ 
            name, 
            id: network.id,
            error: error,
            message: error.message,
            stack: error.stack
          }, 'Unable to delete orphaned network');
        }
      }
    }
    
    if(deletedNetworks.length > 0) {
      logger.info({ 
        deletedNetworks, 
        count: deletedNetworks.length 
      }, 'Removed orphaned networks');
    }
    
    if(failedDeletions.length > 0) {
      logger.warn({ 
        failedDeletions: failedDeletions.map(f => f.name),
        count: failedDeletions.length
      }, 'Some networks could not be deleted');
    }
    
    return deletedNetworks;
  } catch (error) {
    logger.error({ 
      error: error,
      message: error.message,
      stack: error.stack
    }, 'Error stopping orphaned networks');
    return [];
  }
}
