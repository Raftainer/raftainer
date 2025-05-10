# Consul Docker Cluster

## Overview

Raftainer is a moddable Docker orchestrator built on Consul and Vault. It allows for the deployment, management, and orchestration of Docker containers across a cluster of nodes with support for various features such as service registration, event handling, and network management.

## How It Works

Raftainer uses Docker for container management, Consul for service discovery and configuration, and Vault for secret management. The orchestrator handles the following key tasks:

* Network Management:
  * Creates and manages Docker networks for pods.
  * Reuses existing networks where possible.
  * Cleans up orphaned networks.

* Container Management:
  * Launches containers with specified configurations.
  * Manages container lifecycle, including creation, startup, and removal.
  * Handles port bindings and volume mounts.

* Service Registration:
  * Registers services with Consul for discovery.
  * Updates service configurations dynamically.

* Secret Management:
  * Integrates with Vault to securely manage and distribute secrets to containers.

## Architecture

Raftainer follows a distributed architecture with the following major components:

### Core Components

1. **Consul Integration**
   * Acts as the central registry for pod configurations and service discovery
   * Provides distributed locking mechanism to prevent multiple hosts from running the same pod
   * Maintains session-based locks for pod ownership
   * Stores pod definitions and metadata in the KV store

2. **Docker Management**
   * Interfaces with Docker API to create, manage, and monitor containers
   * Handles container networking, volume mounts, and port bindings
   * Manages container lifecycle based on pod specifications

3. **Vault Integration**
   * Secures sensitive information like database credentials and API keys
   * Provides dynamic secrets with automatic rotation
   * Uses AppRole authentication for secure token generation
   * Supports KV secret storage for configuration data

4. **Constraint Matching**
   * Evaluates hardware constraints (e.g., GPU requirements) before scheduling pods
   * Ensures pods are only scheduled on hosts that meet their resource requirements

### Implementation Details

#### Pod Lifecycle Management

1. **Pod Discovery and Locking**
   * Pods are defined in Consul's KV store
   * Each host establishes a Consul session with a TTL
   * The distributed lock mechanism ensures each pod runs on only one host
   * Lock keys follow the pattern `raftainer/pods/locks/{podName}/{index}.lock`
   * Failed pods are tracked in a TTL cache to prevent immediate rescheduling

2. **Container Orchestration**
   * Containers within a pod share a common Docker network
   * Container configurations include restart policies based on their type (long-running vs. startup)
   * MD5 hashing is used to generate consistent container names
   * Orphaned containers are automatically cleaned up

3. **Network Management**
   * Each pod gets its own isolated Docker network
   * Networks are named using a consistent pattern: `Raftainer-{podName}`
   * Orphaned networks are detected and removed during cleanup cycles

4. **Service Registration**
   * Launched pods are registered as services in Consul
   * Services include tags for filtering and identification
   * TTL-based health checks ensure service health monitoring
   * Orphaned services are automatically deregistered

#### Security Model

1. **Vault Secret Management**
   * Secrets are retrieved just-in-time during container launch
   * Database credentials can be dynamically generated with automatic expiration
   * Vault tokens are refreshed automatically when needed
   * Failed secret retrievals are handled gracefully

2. **Distributed Locking**
   * Lock acquisition uses Consul's atomic CAS operations
   * Lock release is tied to the host's Consul session
   * Failed pods are tracked to prevent continuous restart loops
   * Lock keys include pod name and index for uniqueness

#### Locking Flow Details

1. **Session Establishment**
   * Each host creates a Consul session with a 90-second TTL
   * Sessions are renewed every 5 seconds to maintain locks
   * Sessions include a 10-second lock delay to prevent immediate reacquisition
   * On host shutdown, sessions are explicitly destroyed to release locks

2. **Pod Lock Acquisition Process**
   * The system first checks if a pod already has a lock key in the local cache
   * If a cached lock exists, it attempts to reacquire that specific lock
   * If no cached lock exists or reacquisition fails, it tries each index from 0 to maxInstances-1
   * Lock keys follow the pattern `raftainer/pods/locks/{podName}/{index}.lock`
   * Lock values contain host metadata including hostname, region, and timestamp

3. **Lock Contention Handling**
   * Hardware constraints are evaluated before attempting to acquire locks
   * Failed pod deployments are tracked in a TTL cache (5 minutes by default)
   * Pods in the failure cache are skipped during lock acquisition
   * When a pod fails to deploy, its lock is explicitly released with error information

4. **Synchronization Cycle**
   * A mutex ensures only one synchronization process runs at a time
   * Synchronization occurs on a fixed interval (10 seconds) and on Consul KV changes
   * During synchronization, the system:
     * Retrieves all pod definitions from Consul
     * Attempts to acquire locks for unlocked pods
     * Launches networks and containers for successfully locked pods
     * Registers successful pods as services in Consul
     * Releases locks for failed pod deployments
     * Cleans up orphaned containers and networks

#### Error Handling and Resilience

1. **Failure Management**
   * Failed pods are tracked in a TTL-based cache to prevent immediate rescheduling
   * Container and network errors are logged and handled gracefully
   * Orphaned resources are automatically cleaned up during sync cycles
   * Service deregistration ensures clean state management
