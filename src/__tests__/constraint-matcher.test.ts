import { ConstraintMatcher } from '../constraint-matcher';
import si from 'systeminformation';
import { logger } from '../logger';

// Mock dependencies
jest.mock('systeminformation');
jest.mock('../logger', () => ({
  logger: {
    debug: jest.fn(),
    error: jest.fn(),
  },
}));

describe('ConstraintMatcher', () => {
  let constraintMatcher: ConstraintMatcher;
  
  beforeEach(() => {
    constraintMatcher = new ConstraintMatcher();
    jest.clearAllMocks();
  });

  describe('meetsConstraints', () => {
    it('should return true when pod has no GPU constraints', async () => {
      // Arrange
      const mockPod = createMockPod({
        containers: [{ hardwareConstraints: { gpus: [] } }],
      });
      mockGraphicsData([]);

      // Act
      const result = await constraintMatcher.meetsConstraints(mockPod);

      // Assert
      expect(result).toBe(true);
      expect(si.graphics).toHaveBeenCalled();
    });

    it('should return true when GPU constraints are met', async () => {
      // Arrange
      const mockPod = createMockPod({
        containers: [
          {
            hardwareConstraints: {
              gpus: [{ gpuCount: 1, vramBytes: 4000000000 }],
            },
          },
        ],
      });
      mockGraphicsData([{ model: 'NVIDIA GeForce RTX 3080', vram: 10000000000 }]);

      // Act
      const result = await constraintMatcher.meetsConstraints(mockPod);

      // Assert
      expect(result).toBe(true);
    });

    it('should return false when GPU count constraint is not met', async () => {
      // Arrange
      const mockPod = createMockPod({
        containers: [
          {
            hardwareConstraints: {
              gpus: [{ gpuCount: 2, vramBytes: 4000000000 }],
            },
          },
        ],
      });
      mockGraphicsData([{ model: 'NVIDIA GeForce RTX 3080', vram: 10000000000 }]);

      // Act
      const result = await constraintMatcher.meetsConstraints(mockPod);

      // Assert
      expect(result).toBe(false);
      expect(logger.debug).toHaveBeenCalledWith(
        expect.objectContaining({
          requiredCount: 2,
          availableCount: 1,
        }),
        'GPU count constraint not met'
      );
    });

    it('should return false when VRAM constraint is not met', async () => {
      // Arrange
      const mockPod = createMockPod({
        containers: [
          {
            hardwareConstraints: {
              gpus: [{ gpuCount: 1, vramBytes: 20000000000 }],
            },
          },
        ],
      });
      mockGraphicsData([{ model: 'NVIDIA GeForce RTX 3080', vram: 10000000000 }]);

      // Act
      const result = await constraintMatcher.meetsConstraints(mockPod);

      // Assert
      expect(result).toBe(false);
      expect(logger.debug).toHaveBeenCalledWith(
        expect.objectContaining({
          requiredVram: 20000000000,
          availableVram: [10000000000],
        }),
        'GPU VRAM constraint not met'
      );
    });

    it('should handle constraints from multiple containers', async () => {
      // Arrange
      const mockPod = createMockPod({
        containers: [
          {
            hardwareConstraints: {
              gpus: [{ gpuCount: 1, vramBytes: 4000000000 }],
            },
          },
          {
            hardwareConstraints: {
              gpus: [{ gpuCount: 1, vramBytes: 6000000000 }],
            },
          },
        ],
      });
      mockGraphicsData([{ model: 'NVIDIA GeForce RTX 3080', vram: 10000000000 }]);

      // Act
      const result = await constraintMatcher.meetsConstraints(mockPod);

      // Assert
      expect(result).toBe(true);
    });

    it('should return false when si.graphics throws an error', async () => {
      // Arrange
      const mockPod = createMockPod({
        containers: [
          {
            hardwareConstraints: {
              gpus: [{ gpuCount: 1 }],
            },
          },
        ],
      });
      const error = new Error('Graphics information unavailable');
      (si.graphics as jest.Mock).mockRejectedValue(error);

      // Act
      const result = await constraintMatcher.meetsConstraints(mockPod);

      // Assert
      expect(result).toBe(false);
      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          error,
          message: error.message,
        }),
        'Error checking GPU constraints'
      );
    });

    it('should handle containers without hardware constraints', async () => {
      // Arrange
      const mockPod = createMockPod({
        containers: [{ hardwareConstraints: undefined }],
      });
      mockGraphicsData([{ model: 'NVIDIA GeForce RTX 3080', vram: 10000000000 }]);

      // Act
      const result = await constraintMatcher.meetsConstraints(mockPod);

      // Assert
      expect(result).toBe(true);
    });

    it('should handle undefined vramBytes in constraints', async () => {
      // Arrange
      const mockPod = createMockPod({
        containers: [
          {
            hardwareConstraints: {
              gpus: [{ gpuCount: 1, vramBytes: undefined }],
            },
          },
        ],
      });
      mockGraphicsData([{ model: 'NVIDIA GeForce RTX 3080', vram: 10000000000 }]);

      // Act
      const result = await constraintMatcher.meetsConstraints(mockPod);

      // Assert
      expect(result).toBe(true);
    });

    it('should handle undefined vram in GPU data', async () => {
      // Arrange
      const mockPod = createMockPod({
        containers: [
          {
            hardwareConstraints: {
              gpus: [{ gpuCount: 1, vramBytes: 4000000000 }],
            },
          },
        ],
      });
      mockGraphicsData([{ model: 'NVIDIA GeForce RTX 3080', vram: undefined }]);

      // Act
      const result = await constraintMatcher.meetsConstraints(mockPod);

      // Assert
      expect(result).toBe(false);
    });

    it('should handle errors in meetsConstraints method', async () => {
      // Arrange
      const mockPod = createMockPod({
        containers: [
          {
            hardwareConstraints: {
              gpus: [{ gpuCount: 1 }],
            },
          },
        ],
      });
      
      // Mock implementation to throw error in meetsConstraints
      const error = new Error('Constraint check failed');
      jest.spyOn(constraintMatcher as any, 'meetsGpuConstraints').mockImplementation(() => {
        throw error;
      });

      // Act
      const result = await constraintMatcher.meetsConstraints(mockPod);

      // Assert
      expect(result).toBe(false);
      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          error,
          message: error.message,
        }),
        'Error checking hardware constraints'
      );
    });

    it('should handle the case where GPU has vram but constraint.vramBytes is undefined', async () => {
      // Arrange
      const mockPod = createMockPod({
        containers: [
          {
            hardwareConstraints: {
              gpus: [{ gpuCount: 1, vramBytes: undefined }],
            },
          },
        ],
      });
      mockGraphicsData([{ model: 'NVIDIA GeForce RTX 3080', vram: 10000000000 }]);

      // Act
      const result = await constraintMatcher.meetsConstraints(mockPod);

      // Assert
      expect(result).toBe(true);
    });

    it('should evaluate the constraint.vramBytes && !gpus.some(...) condition correctly', async () => {
      // This test specifically targets line 46 to cover that branch
      // We want constraint.vramBytes to be truthy and the gpus.some() to return false
      const mockPod = createMockPod({
        containers: [
          {
            hardwareConstraints: {
              gpus: [{ gpuCount: 1, vramBytes: 10000000000 }],
            },
          },
        ],
      });
      // Mock with a GPU that has insufficient VRAM to trigger the condition
      mockGraphicsData([{ model: 'NVIDIA GeForce RTX 3060', vram: 6000000000 }]);

      // Act
      const result = await constraintMatcher.meetsConstraints(mockPod);

      // Assert
      expect(result).toBe(false);
      expect(logger.debug).toHaveBeenCalledWith(
        expect.objectContaining({
          requiredVram: 10000000000,
          availableVram: [6000000000],
        }),
        'GPU VRAM constraint not met'
      );
    });
  });
});

// Helper functions
function createMockPod(overrides: any = {}) {
  return {
    key: 'test/pod/key',
    pod: {
      name: 'test-pod',
      containers: [],
      maxInstances: 1,
      ...overrides,
    },
  };
}

function mockGraphicsData(controllers: any[]) {
  (si.graphics as jest.Mock).mockResolvedValue({
    controllers,
  });
}