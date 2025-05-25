import { launchPodNetworks, stopOrphanedNetworks } from "../networks";
import { logger } from "../logger";
import { OrchestratorName } from "@raftainer/models";

// Mock dependencies
jest.mock("../logger", () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
  },
}));

describe("networks", () => {
  let mockDocker: any;
  let mockPodEntry: any;

  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();

    // Create mock Docker client
    mockDocker = {
      listNetworks: jest.fn(),
      getNetwork: jest.fn(),
      createNetwork: jest.fn(),
    };

    // Create mock pod entry
    mockPodEntry = {
      key: "raftainer/pods/configs/test-pod",
      pod: {
        name: "test-pod",
        containers: [],
        maxInstances: 1,
      },
    };
  });

  describe("launchPodNetworks", () => {
    it("should create a new network if none exists", async () => {
      // Arrange
      mockDocker.listNetworks.mockResolvedValue([]);

      const mockNetwork = {
        id: "network-123",
        remove: jest.fn().mockResolvedValue({}),
      };
      mockDocker.createNetwork.mockResolvedValue(mockNetwork);

      // Act
      const result = await launchPodNetworks(mockDocker, mockPodEntry);

      // Assert
      expect(result).toEqual({
        primary: mockNetwork,
      });
      expect(mockDocker.listNetworks).toHaveBeenCalledWith({
        all: true,
        filters: {
          label: [`OrchestratorName=${OrchestratorName}`],
        },
      });
      expect(mockDocker.createNetwork).toHaveBeenCalledWith({
        Name: "Raftainer-test-pod",
        CheckDuplicate: true,
        Labels: {
          OrchestratorName,
        },
      });
      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({ networkName: "Raftainer-test-pod" }),
        "Existing networks",
      );
    });

    it("should reuse existing network if one exists", async () => {
      // Arrange
      const networkId = "network-123";
      const networkName = "Raftainer-test-pod";

      const mockNetwork = {
        id: networkId,
        remove: jest.fn().mockResolvedValue({}),
      };

      mockDocker.listNetworks.mockResolvedValue([
        {
          Id: networkId,
          Name: networkName,
        },
      ]);
      mockDocker.getNetwork.mockReturnValue(mockNetwork);

      // Act
      const result = await launchPodNetworks(mockDocker, mockPodEntry);

      // Assert
      expect(result).toEqual({
        primary: mockNetwork,
      });
      expect(mockDocker.createNetwork).not.toHaveBeenCalled();
      expect(mockDocker.getNetwork).toHaveBeenCalledWith(networkId);
      expect(logger.debug).toHaveBeenCalledWith(
        { networkName },
        "Re-using existing network",
      );
    });
  });

  describe("stopOrphanedNetworks", () => {
    it("should remove networks not associated with active pods", async () => {
      // Arrange
      const activePodNames = new Set(["active-pod"]);
      const activeNetworkName = "Raftainer-active-pod";
      const orphanedNetworkName = "Raftainer-orphaned-pod";

      const mockActiveNetwork = {
        id: "active-network-id",
        remove: jest.fn().mockResolvedValue({}),
      };

      const mockOrphanedNetwork = {
        id: "orphaned-network-id",
        remove: jest.fn().mockResolvedValue({}),
      };

      mockDocker.listNetworks.mockResolvedValue([
        {
          Id: "active-network-id",
          Name: activeNetworkName,
        },
        {
          Id: "orphaned-network-id",
          Name: orphanedNetworkName,
        },
      ]);

      mockDocker.getNetwork
        .mockReturnValueOnce(mockActiveNetwork)
        .mockReturnValueOnce(mockOrphanedNetwork);

      // Act
      const result = await stopOrphanedNetworks(mockDocker, activePodNames);

      // Assert
      expect(result).toEqual([orphanedNetworkName]);
      expect(mockOrphanedNetwork.remove).toHaveBeenCalledWith({
        force: true,
      });
      expect(mockActiveNetwork.remove).not.toHaveBeenCalled();
      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          deletedNetworks: [orphanedNetworkName],
          count: 1,
        }),
        "Removed orphaned networks",
      );
    });

    it("should handle failure to delete network", async () => {
      // Arrange
      const activePodNames = new Set(["active-pod"]);
      const orphanedNetworkName = "Raftainer-orphaned-pod";

      const removeError = new Error("Network in use");
      const mockOrphanedNetwork = {
        id: "orphaned-network-id",
        remove: jest.fn().mockRejectedValue(removeError),
      };

      mockDocker.listNetworks.mockResolvedValue([
        {
          Id: "orphaned-network-id",
          Name: orphanedNetworkName,
        },
      ]);

      mockDocker.getNetwork.mockReturnValue(mockOrphanedNetwork);

      // Act
      const result = await stopOrphanedNetworks(mockDocker, activePodNames);

      // Assert
      expect(result).toEqual([]);
      expect(mockOrphanedNetwork.remove).toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          name: orphanedNetworkName,
          id: mockOrphanedNetwork.id,
          error: removeError,
        }),
        "Unable to delete orphaned network",
      );
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          failedDeletions: [orphanedNetworkName],
          count: 1,
        }),
        "Some networks could not be deleted",
      );
    });

    it("should handle errors when listing networks", async () => {
      // Arrange
      const activePodNames = new Set(["active-pod"]);
      const listError = new Error("Failed to list networks");

      mockDocker.listNetworks.mockRejectedValue(listError);

      // Act
      const result = await stopOrphanedNetworks(mockDocker, activePodNames);

      // Assert
      expect(result).toEqual([]);
      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          error: listError,
          message: listError.message,
        }),
        "Error stopping orphaned networks",
      );
    });

    it("should do nothing if there are no orphaned networks", async () => {
      // Arrange
      const activePodNames = new Set(["active-pod"]);
      const activeNetworkName = "Raftainer-active-pod";

      const mockActiveNetwork = {
        id: "active-network-id",
        remove: jest.fn().mockResolvedValue({}),
      };

      mockDocker.listNetworks.mockResolvedValue([
        {
          Id: "active-network-id",
          Name: activeNetworkName,
        },
      ]);

      mockDocker.getNetwork.mockReturnValue(mockActiveNetwork);

      // Act
      const result = await stopOrphanedNetworks(mockDocker, activePodNames);

      // Assert
      expect(result).toEqual([]);
      expect(mockActiveNetwork.remove).not.toHaveBeenCalled();
      expect(logger.info).not.toHaveBeenCalledWith(
        expect.anything(),
        "Removed orphaned networks",
      );
    });
  });
});
