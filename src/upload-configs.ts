import Consul from 'consul';
import { logger } from './logger';
import { ContainerType, Pod } from '@raftainer/models';

const pods: Pod[] = [
  {
    name: 'hello-world',
    containers: [
      {
        name: 'hello-world',
        image: 'hello-world',
        environment: { FOO: 'BAR' },
        localVolumes: [
          { containerPath: '/container-tmp', hostPath: '/tmp', mode: 'ro' }
        ],
        containerType: ContainerType.PodStartup,
        ports: [{
          name: 'test',
          protocol: 'HTTP',
          containerPort: 80,
          portType: 'Internal'
        }]
      },
      {
        name: 'hello-world-2',
        image: 'hello-world',
        environment: { BIZ: 'BAZ' },
        localVolumes: [],
        containerType: ContainerType.PodStartup,
        ports: []
      }
    ],
    maxInstances: 2
  }
];

(async function main () {
  logger.debug('Initializing consul connection');
  const consul: Consul.Consul = new Consul();
  logger.info('Uploading Pod configs');
  for (const pod of pods) {
    await consul.kv.set({
      key: `raftainer/pods/${pod.name}`,
      value: JSON.stringify(pod)
    });
  }
  logger.info('Finished');
})();
