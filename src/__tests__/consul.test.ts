import {
  configureHostSession,
  getPods,
  tryLockPod,
  releasePod,
  deregisterServices,
  PodLock,
  ConsulPodEntryWithLock,
} from "../consul";
import { logger } from "../logger";
import { config } from "../config";
import { ConsulPodEntry } from "@raftainer/models";

// Mock dependencies
jest.mock("../logger", () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    trace: jest.fn(),
  },
}));

jest.mock("../config", () => ({
  config: {
    name: "test-host",
    region: "test-region",
    internalIp: "192.168.1.1",
    consul: {
      host: "consul.example.com",
      port: 8500,
    },
    fastStartup: false,
  },
}));

describe("consul", () => {
  let mockConsul: any;
  let mockSession: string;

  beforeEach(() => {
    jest.useFakeTimers();
    mockSession = "test-session-id";

    // Create mock Consul client
    mockConsul = {
      session: {
        create: jest.fn().mockResolvedValue({ ID: mockSession }),
        node: jest.fn().mockResolvedValue([]),
        renew: jest
          .fn()
          .mockResolvedValue([{ CreateIndex: 1, ModifyIndex: 2 }]),
        destroy: jest.fn().mockResolvedValue({}),
      },
      kv: {
        keys: jest.fn().mockResolvedValue([]),
        get: jest.fn().mockResolvedValue({ Value: "{}" }),
        set: jest.fn().mockResolvedValue(true),
      },
      agent: {
        service: {
          list: jest.fn().mockResolvedValue({}),
          deregister: jest.fn().mockResolvedValue({}),
        },
      },
    };

    // Clear all mocks
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe("configureHostSession", () => {
    it("should create a new session", async () => {
      // Act
      const result = await configureHostSession(mockConsul);

      // Assert
      expect(result).toBe(mockSession);
      expect(mockConsul.session.create).toHaveBeenCalledWith({
        name: "Raftainer Host",
        node: "test-host",
        ttl: "90s",
        lockdelay: "10s",
      });
      expect(logger.debug).toHaveBeenCalledWith(
        expect.stringContaining(mockSession),
      );
    });

    it("should warn and wait if there is an existing session lock", async () => {
      // Arrange
      // Mock implementation of configureHostSession that skips the waiting
      const originalConsulSessionNode = mockConsul.session.node;
      mockConsul.session.node = jest.fn().mockResolvedValue([]);

      // Instead of mocking setTimeout directly, spy on it and manipulate its behavior
      const setTimeoutSpy = jest.spyOn(global, "setTimeout");
      setTimeoutSpy.mockImplementation((cb: any) => {
        // Call the callback immediately instead of waiting
        cb();
        return 123 as any; // Return a timeout ID
      });

      // First, create a standard session
      await configureHostSession(mockConsul);

      // Now test with an existing session
      // Reset the mocks
      jest.clearAllMocks();

      // Mock the session.node to return an existing session once, then return no sessions
      mockConsul.session.node = jest
        .fn()
        .mockResolvedValueOnce([{ Name: "Raftainer Host" }])
        .mockResolvedValueOnce([]);

      // Act
      await configureHostSession(mockConsul);

      // Assert
      expect(mockConsul.session.node).toHaveBeenCalledTimes(2);
      expect(logger.warn).toHaveBeenCalledWith(
        "Node already has a Raftainer lock. Waiting for lock to expire...",
      );
      expect(setTimeoutSpy).toHaveBeenCalled();

      // Restore the original setTimeout
      setTimeoutSpy.mockRestore();
    });

    it("should set up a session renewal interval", async () => {
      // Act
      await configureHostSession(mockConsul);

      // Advance timers to trigger the interval
      jest.advanceTimersByTime(6000);

      // Wait for any promises to resolve
      await Promise.resolve();

      // Assert
      expect(mockConsul.session.renew).toHaveBeenCalledWith(mockSession);
      expect(logger.trace).toHaveBeenCalledWith(
        `Renewed consul session: ${mockSession}: 1, 2`,
      );
    });

    it("should register an exit handler to destroy the session", async () => {
      // Arrange
      const processOnSpy = jest.spyOn(process, "on");

      // Act
      await configureHostSession(mockConsul);

      // Assert
      expect(processOnSpy).toHaveBeenCalledWith("exit", expect.any(Function));

      // Restore the spy
      processOnSpy.mockRestore();
    });

    it("should skip waiting when fastStartup is true", async () => {
      // Arrange
      (config as any).fastStartup = true;

      // Even though there's an existing session, it should skip waiting
      mockConsul.session.node.mockResolvedValueOnce([
        { Name: "Raftainer Host" },
      ]);

      // Act
      const result = await configureHostSession(mockConsul);

      // Assert
      expect(result).toBe(mockSession);
      expect(mockConsul.session.node).not.toHaveBeenCalled();
      expect(logger.warn).not.toHaveBeenCalled();

      // Reset fastStartup for other tests
      (config as any).fastStartup = false;
    });
  });

  describe("getPods", () => {
    it("should return empty array when no pods exist", async () => {
      // Arrange
      mockConsul.kv.keys.mockResolvedValue([]);

      // Act
      const result = await getPods(mockConsul);

      // Assert
      expect(result).toEqual([]);
      expect(logger.debug).toHaveBeenCalledWith(
        { keys: [] },
        expect.any(String),
      );
    });

    it("should fetch and parse pod entries", async () => {
      // Arrange
      const podKeys = [
        "raftainer/pods/configs/pod1",
        "raftainer/pods/configs/pod2",
      ];
      mockConsul.kv.keys.mockResolvedValue(podKeys);

      const pod1Data = { name: "pod1", containers: [], maxInstances: 1 };
      const pod2Data = { name: "pod2", containers: [], maxInstances: 2 };

      mockConsul.kv.get
        .mockResolvedValueOnce({ Value: JSON.stringify(pod1Data) })
        .mockResolvedValueOnce({ Value: JSON.stringify(pod2Data) });

      // Act
      const result = await getPods(mockConsul);

      // Assert
      expect(result).toEqual([
        { key: podKeys[0], pod: pod1Data },
        { key: podKeys[1], pod: pod2Data },
      ]);
      expect(mockConsul.kv.get).toHaveBeenCalledTimes(2);
      expect(mockConsul.kv.get).toHaveBeenCalledWith(podKeys[0]);
      expect(mockConsul.kv.get).toHaveBeenCalledWith(podKeys[1]);
    });
  });

  describe("tryLockPod", () => {
    let mockPod: ConsulPodEntry;
    let podLocks: PodLock;

    beforeEach(() => {
      mockPod = {
        key: "raftainer/pods/configs/test-pod",
        pod: {
          name: "test-pod",
          containers: [],
          maxInstances: 2,
        },
      };

      podLocks = {};
    });

    it("should return null if unable to lock any instance", async () => {
      // Arrange
      mockConsul.kv.set.mockResolvedValue(false);

      // Act
      const result = await tryLockPod(
        mockConsul,
        mockSession,
        podLocks,
        mockPod,
      );

      // Assert
      expect(result).toBeNull();
      expect(mockConsul.kv.set).toHaveBeenCalledTimes(2); // Tried twice (maxInstances = 2)
    });

    it("should try to use existing lock key if available", async () => {
      // Arrange
      const existingLockKey = "raftainer/pods/locks/test-pod/0.lock";
      podLocks = { "test-pod": existingLockKey };
      mockConsul.kv.set.mockResolvedValue(true);

      // Act
      const result = await tryLockPod(
        mockConsul,
        mockSession,
        podLocks,
        mockPod,
      );

      // Assert
      expect(result).toEqual({
        ...mockPod,
        lockKey: existingLockKey,
      });
      expect(mockConsul.kv.set).toHaveBeenCalledTimes(1);
      expect(mockConsul.kv.set).toHaveBeenCalledWith({
        key: existingLockKey,
        value: expect.any(String),
        acquire: mockSession,
      });
    });

    it("should reuse lock key when maxInstances has two digits", async () => {
      // Arrange
      const existingLockKey = "raftainer/pods/locks/test-pod/9.lock";
      podLocks = { "test-pod": existingLockKey };
      const largePod: ConsulPodEntry = {
        ...mockPod,
        pod: { ...mockPod.pod, maxInstances: 10 },
      };
      mockConsul.kv.set.mockResolvedValue(true);

      // Act
      const result = await tryLockPod(
        mockConsul,
        mockSession,
        podLocks,
        largePod,
      );

      // Assert
      expect(result).toEqual({
        ...largePod,
        lockKey: existingLockKey,
      });
      expect(mockConsul.kv.set).toHaveBeenCalledTimes(1);
      expect(mockConsul.kv.set).toHaveBeenCalledWith({
        key: existingLockKey,
        value: expect.any(String),
        acquire: mockSession,
      });
    });

    it("should try all possible lock keys up to maxInstances", async () => {
      // Arrange
      mockConsul.kv.set
        .mockResolvedValueOnce(false) // First attempt fails
        .mockResolvedValueOnce(true); // Second attempt succeeds

      // Act
      const result = await tryLockPod(
        mockConsul,
        mockSession,
        podLocks,
        mockPod,
      );

      // Assert
      expect(result).toEqual({
        ...mockPod,
        lockKey: "raftainer/pods/locks/test-pod/1.lock",
      });
      expect(mockConsul.kv.set).toHaveBeenCalledTimes(2);
    });

    it("should skip existing lock key if it would violate maxInstances", async () => {
      // Arrange
      const invalidLockKey = "raftainer/pods/locks/test-pod/5.lock"; // Beyond maxInstances (2)
      podLocks = { "test-pod": invalidLockKey };

      mockConsul.kv.set.mockResolvedValueOnce(true); // First regular attempt succeeds

      // Act
      const result = await tryLockPod(
        mockConsul,
        mockSession,
        podLocks,
        mockPod,
      );

      // Assert
      expect(result).toEqual({
        ...mockPod,
        lockKey: "raftainer/pods/locks/test-pod/0.lock",
      });
      // Should not try the invalid lock key, only the regular sequence
      expect(mockConsul.kv.set).toHaveBeenCalledTimes(1);
      expect(mockConsul.kv.set).not.toHaveBeenCalledWith({
        key: invalidLockKey,
        value: expect.any(String),
        acquire: mockSession,
      });
    });
  });

  describe("releasePod", () => {
    let mockPod: ConsulPodEntryWithLock;

    beforeEach(() => {
      mockPod = {
        key: "raftainer/pods/configs/test-pod",
        pod: {
          name: "test-pod",
          containers: [],
          maxInstances: 1,
        },
        lockKey: "raftainer/pods/locks/test-pod/0.lock",
      };

      // Mock Date.now to return a fixed timestamp
      const originalDateNow = Date.now;
      Date.now = jest.fn(() => 1612345678900);
    });

    afterEach(() => {
      // Restore original Date.now
      jest.restoreAllMocks();
    });

    it("should release the pod lock with error information", async () => {
      // Arrange
      const error = new Error("Test error");

      // Act
      await releasePod(mockConsul, mockSession, mockPod, error);

      // Assert
      expect(mockConsul.kv.set).toHaveBeenCalledWith({
        key: mockPod.lockKey,
        value: expect.any(String),
        release: mockSession,
      });
      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          podName: mockPod.pod.name,
          lockKey: mockPod.lockKey,
        }),
        "Successfully released pod lock",
      );
    });

    it("should handle non-object errors", async () => {
      // Arrange
      const error = "String error";

      // Act
      await releasePod(mockConsul, mockSession, mockPod, error);

      // Assert
      expect(mockConsul.kv.set).toHaveBeenCalledWith({
        key: mockPod.lockKey,
        value: expect.stringContaining("String error"),
        release: mockSession,
      });
    });

    it("should log error if release fails", async () => {
      // Arrange
      const error = new Error("Test error");
      const releaseError = new Error("Release failed");
      mockConsul.kv.set.mockRejectedValue(releaseError);

      // Act
      await releasePod(mockConsul, mockSession, mockPod, error);

      // Assert
      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          podName: mockPod.pod.name,
          lockKey: mockPod.lockKey,
          error: releaseError,
        }),
        "Failed to release pod lock",
      );
    });
  });

  describe("deregisterServices", () => {
    it("should deregister services not in activeServiceIds", async () => {
      // Arrange
      const activeServiceIds = ["service1", "service3"];
      const allServices = {
        service1: { Tags: ["raftainer"] },
        service2: { Tags: ["raftainer"] },
        service3: { Tags: ["raftainer"] },
        service4: { Tags: ["other-tag"] },
      };

      mockConsul.agent.service.list.mockResolvedValue(allServices);

      // Act
      await deregisterServices(mockConsul, activeServiceIds);

      // Assert
      expect(mockConsul.agent.service.deregister).toHaveBeenCalledTimes(1);
      expect(mockConsul.agent.service.deregister).toHaveBeenCalledWith(
        "service2",
      );
      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          servicesToDeregister: expect.any(Set),
          activeCount: 2,
        }),
        "Deregistering services",
      );
    });

    it("should handle empty service list", async () => {
      // Arrange
      mockConsul.agent.service.list.mockResolvedValue({});

      // Act
      await deregisterServices(mockConsul, []);

      // Assert
      expect(mockConsul.agent.service.deregister).not.toHaveBeenCalled();
    });

    it("should handle errors during service deregistration", async () => {
      // Arrange
      const activeServiceIds: string[] = [];
      const allServices = {
        service1: { Tags: ["raftainer"] },
        service2: { Tags: ["raftainer"] },
      };

      mockConsul.agent.service.list.mockResolvedValue(allServices);
      const deregisterError = new Error("Deregister failed");

      mockConsul.agent.service.deregister
        .mockImplementationOnce(() => Promise.resolve({})) // service1 succeeds
        .mockImplementationOnce(() => Promise.reject(deregisterError)); // service2 fails

      // Act
      await deregisterServices(mockConsul, activeServiceIds);

      // Assert
      expect(mockConsul.agent.service.deregister).toHaveBeenCalledTimes(2);
      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "service2",
          error: deregisterError,
        }),
        "Failed to deregister service",
      );
      // Check if error was logged
      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "service2",
          error: deregisterError,
        }),
        "Failed to deregister service",
      );
    });

    it("should handle errors when listing services", async () => {
      // Arrange
      const listError = new Error("Failed to list services");
      mockConsul.agent.service.list.mockRejectedValue(listError);

      // Act
      await deregisterServices(mockConsul, []);

      // Assert
      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          error: listError,
          message: listError.message,
        }),
        "Error listing or deregistering services",
      );
      expect(mockConsul.agent.service.deregister).not.toHaveBeenCalled();
    });
  });
});
