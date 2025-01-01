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
