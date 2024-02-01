# Consul Docker Cluster

Basic Requirements:
* Docker Image 
* Environment Variables
* Volumes
    * Local Mount Points (e.g. for cache, persistent state, copied configs)
    * Remote Mount Points (e.g. for settings)
* Ports
    * Protocol
    * Bind IP (should be interpolated with env vars/configs)
    * Description
* Restart Policy

Additional Features:
* Pod
    * Pod Name
    * Connected Containers
    * Allowed Nodes
    * Allowed regions (JFK, IAD)
    * Max Instances
    * IP Range?
* Consul Service Registration (register at pod level)
* Local HTTP Gateway
* Cloudflare HTTP Gateway
* Auth
* Event Bus (kafka)
    * Register ephemeral containers to event types (e.g. different AI containers for different AI requests)
    * Perhaps this could be managed within a pod, one event bus per pod?


Steps: 
1. Deployment only: spin up a docker container using the provided config(s)
2. Semaphores: use consul semaphores to enforce max hosts
3. Registration: register containers/ports as K/V instances
4. K/V Configuration: load the container settings from Consul K/V
    1. Create new
    2. Remove old

