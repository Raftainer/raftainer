# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Raftainer is a modular Docker orchestrator built on Consul and Vault. It allows for the deployment, management, and orchestration of Docker containers across a cluster of nodes with support for service registration, event handling, and network management.

## Development Commands

```bash
# Install dependencies
npm install

# Build the project
npm run build

# Start the service
npm run start

# Start the service with auto-restart on file changes
npm run start:watch

# Lint and fix code
npm run lint

# Format code
npx prettier -w src
```

## Architecture Overview

Raftainer follows a distributed architecture with these major components:

1. **Consul Integration**
   - Central registry for pod configurations and service discovery
   - Distributed locking mechanism for pod ownership
   - Session-based locks with TTL

2. **Docker Management**
   - Container orchestration with Docker API
   - Network creation and management
   - Container lifecycle management

3. **Vault Integration**
   - Secret management for sensitive information
   - Dynamic secret generation

4. **Constraint Matching**
   - Hardware constraint evaluation for pod scheduling

## Core Processes

### Pod Lifecycle Management

1. **Pod Discovery and Locking**
   - Pods defined in Consul KV store
   - Distributed locks ensure each pod runs on only one host
   - Lock keys follow pattern `raftainer/pods/locks/{podName}/{index}.lock`
   - Failed pods tracked in TTL cache to prevent immediate rescheduling

2. **Container Orchestration**
   - Containers within a pod share a Docker network
   - MD5 hashing for consistent naming
   - Automatic cleanup of orphaned containers

3. **Network Management**
   - Isolated Docker network per pod
   - Orphaned network detection and cleanup

4. **Service Registration**
   - Pods registered as services in Consul
   - TTL-based health checks

## Code Organization

The codebase is organized into focused TypeScript modules:

- `src/index.ts` - Main application entry point and orchestration logic
- `src/config.ts` - Configuration loading from environment variables
- `src/consul.ts` - Consul interaction for locks and service registration
- `src/containers.ts` - Docker container management
- `src/networks.ts` - Docker network management
- `src/vault.ts` - Secret management with Vault
- `src/constraint-matcher.ts` - Hardware constraint evaluation
- `src/ttlCache.ts` - Time-based caching for failed operations
- `src/logger.ts` - Centralized logging system

## Development Conventions

1. **TypeScript Best Practices**
   - Use interfaces over types for object definitions
   - Use explicit return types for functions
   - Use readonly for immutable properties
   - Use async/await for asynchronous operations

2. **Logging**
   - Use the logger from `./logger` for all logging
   - Include relevant context objects in log messages
   - Use appropriate log levels (trace, debug, info, warn, error)

3. **Error Handling**
   - Catch and log errors with detailed context
   - Include error message and stack trace in error logs
   - Use TTL caches for tracking failed operations

4. **Code Quality**
   - Format code with Prettier before committing
   - Run ESLint with fixes to ensure consistent style

## Configuration

Raftainer uses environment variables for configuration:

- `HOSTNAME` - The name of the host
- `RAFTAINER_REGION` - The region the host is in
- `RAFTAINER_SECURE_IP` - The secure IP of the host (optional)
- `RAFTAINER_INTERNAL_IP` - The internal IP of the host
- `RAFTAINER_CONSUL_HOST` - The Consul host
- `RAFTAINER_CONSUL_PORT` - The Consul port (default: 8500)
- `RAFTAINER_FAST_STARTUP` - Whether to enable fast startup mode (default: false)