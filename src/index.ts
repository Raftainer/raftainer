import Docker from 'dockerode';
import Consul from 'consul';
import { logger } from './logger';
import { configureHostSession, getPods } from './consul';
import { launchPodContainers } from './containers';
import { ConsulPodEntry } from '@raftainer/models';
import { config } from './config';

(async function main () {
    logger.info('Starting service');

    logger.debug('Initializing consul connection');
    const consul: Consul.Consul = new Consul({
        host: config.consul.host,
        port: String(config.consul.port),
    });

    logger.debug('Initializing docker connection');
    const docker = new Docker();

    await docker.pruneVolumes({});
    await docker.pruneImages({});
    await docker.pruneNetworks({});

    const session: string = await configureHostSession(consul);

    const podEntries: ConsulPodEntry[] = await getPods(consul);
    // TODO: get and lock pods for this machine
    await Promise.all(podEntries.map(async podEntry => {
    // TODO: check if pod is already full
    // TODO: lock pod
        const { launchedContainers } = await launchPodContainers(docker, podEntry);
        // TODO: fire event for pod update
        return { podEntry, launchedContainers };
    }));
    // TODO: prune out extra containers
})().catch(err => {
    logger.error(`Service crashed: ${err}`);
});
