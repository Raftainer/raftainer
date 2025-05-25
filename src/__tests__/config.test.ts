describe("config", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    // Save original environment and create a clean one for testing
    jest.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    // Restore original environment
    process.env = originalEnv;
  });

  it("should load configuration from environment variables", () => {
    // Arrange - set environment variables
    process.env.HOSTNAME = "test-host";
    process.env.RAFTAINER_REGION = "test-region";
    process.env.RAFTAINER_SECURE_IP = "10.0.0.1";
    process.env.RAFTAINER_INTERNAL_IP = "192.168.1.1";
    process.env.RAFTAINER_CONSUL_HOST = "consul.example.com";
    process.env.RAFTAINER_CONSUL_PORT = "8600";
    process.env.RAFTAINER_FAST_STARTUP = "true";

    // Act - import the config
    const { config } = require("../config");

    // Assert
    expect(config).toEqual({
      name: "test-host",
      region: "test-region",
      secureIp: "10.0.0.1",
      internalIp: "192.168.1.1",
      consul: {
        host: "consul.example.com",
        port: 8600,
      },
      fastStartup: true,
    });
  });

  it("should use default values when environment variables are not set", () => {
    // Arrange - set only required environment variables
    process.env.HOSTNAME = "test-host";
    process.env.RAFTAINER_REGION = "test-region";
    process.env.RAFTAINER_INTERNAL_IP = "192.168.1.1";
    process.env.RAFTAINER_CONSUL_HOST = "consul.example.com";
    // PORT and FAST_STARTUP are not set to test defaults

    // Act - import the config
    const { config } = require("../config");

    // Assert
    expect(config).toEqual({
      name: "test-host",
      region: "test-region",
      secureIp: undefined,
      internalIp: "192.168.1.1",
      consul: {
        host: "consul.example.com",
        port: 8500, // Default port
      },
      fastStartup: false, // Default value
    });
  });

  it("should parse RAFTAINER_FAST_STARTUP correctly", () => {
    // Arrange
    process.env.HOSTNAME = "test-host";
    process.env.RAFTAINER_REGION = "test-region";
    process.env.RAFTAINER_INTERNAL_IP = "192.168.1.1";
    process.env.RAFTAINER_CONSUL_HOST = "consul.example.com";
    process.env.RAFTAINER_FAST_STARTUP = "true";

    // Act
    const { config: configWithTrueValue } = require("../config");

    // Reset for the next test
    jest.resetModules();
    process.env.RAFTAINER_FAST_STARTUP = "false";

    // Import again with the new environment value
    const { config: configWithFalseValue } = require("../config");

    // Assert
    expect(configWithTrueValue.fastStartup).toBe(true);
    expect(configWithFalseValue.fastStartup).toBe(false);
  });
});
