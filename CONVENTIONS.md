# Coding Conventions

## General

- Run `npm run build` to test changes
- Run `npx prettier -w src` to format code
- Make sure that code is tested and formatted before committing
- Group similar commits together

## TypeScript Conventions

- Use TypeScript for type safety
- Prefer interfaces over types for object definitions
- Use readonly for immutable properties
- Use explicit return types for functions
- Use async/await for asynchronous operations
- Use try/catch blocks for error handling

## Logging

- Use the logger from './logger' for all logging
- Include relevant context objects in log messages
- Use appropriate log levels:
  - trace: Very detailed debugging information
  - debug: Debugging information
  - info: Normal operation information
  - warn: Warning conditions
  - error: Error conditions

## Error Handling

- Catch and log errors with detailed context
- Include error message and stack trace in error logs
- Use TTL caches for tracking failed operations

## Documentation

- Use JSDoc comments for functions and classes
- Document parameters and return values
- Provide brief descriptions of what functions do

## Naming Conventions

- Use camelCase for variables and function names
- Use PascalCase for class and interface names
- Use descriptive names that indicate purpose
- Prefix interfaces with 'I' when appropriate

## File Organization

- Group related functionality in separate files
- Export interfaces and types from model files
- Keep files focused on a single responsibility

## Docker/Container Management

- Use consistent naming patterns for resources
- Use labels to track container ownership
- Use hashing for configuration tracking
- Clean up orphaned resources
