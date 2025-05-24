import { Vault } from '../vault';
import { logger } from '../logger';

// Mock dependencies
jest.mock('../logger', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    error: jest.fn(),
  }
}));

// Mock node-vault
jest.mock('node-vault', () => {
  return jest.fn().mockImplementation(() => ({
    approleLogin: jest.fn(),
    read: jest.fn(),
    token: null
  }));
});

describe('Vault', () => {
  let vault: Vault;
  let mockVc: any;
  
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    
    // Save original environment
    process.env.VAULT_ROLE_ID = 'test-role-id';
    process.env.VAULT_SECRET_ID = 'test-secret-id';
    
    // Create a new Vault instance
    vault = new Vault();
    
    // Get access to the internal vault client
    mockVc = (vault as any).vc;
  });
  
  afterEach(() => {
    jest.useRealTimers();
  });
  
  describe('login', () => {
    it('should authenticate with Vault using AppRole credentials', async () => {
      // Arrange
      mockVc.approleLogin.mockResolvedValue({
        auth: {
          client_token: 'test-token',
          lease_duration: 3600
        }
      });
      
      // Act
      await vault.login();
      
      // Assert
      expect(mockVc.approleLogin).toHaveBeenCalledWith({
        role_id: 'test-role-id',
        secret_id: 'test-secret-id'
      });
      expect(mockVc.token).toBe('test-token');
      expect(logger.debug).toHaveBeenCalledWith('Generating new vault token');
    });
    
    it('should use cached token if already authenticated', async () => {
      // Arrange
      mockVc.token = 'existing-token';
      
      // Act
      await vault.login();
      
      // Assert
      expect(mockVc.approleLogin).not.toHaveBeenCalled();
      expect(logger.debug).toHaveBeenCalledWith('Using cached vault credentials');
    });
    
    it('should clear token before lease expires', async () => {
      // Arrange
      mockVc.approleLogin.mockResolvedValue({
        auth: {
          client_token: 'test-token',
          lease_duration: 100 // 100 seconds
        }
      });
      
      // Act
      await vault.login();
      
      // Fast-forward time to just before token expiration
      jest.advanceTimersByTime(89 * 1000);
      
      // Token should still be valid
      expect(mockVc.token).toBe('test-token');
      
      // Fast-forward past expiration
      jest.advanceTimersByTime(2 * 1000);
      
      // Token should be cleared
      expect(mockVc.token).toBeUndefined();
    });
    
    it('should not create multiple login promises', async () => {
      // Arrange
      mockVc.approleLogin.mockResolvedValue({
        auth: {
          client_token: 'test-token',
          lease_duration: 3600
        }
      });
      
      // Act - call login twice simultaneously
      const promise1 = vault.login();
      const promise2 = vault.login();
      
      // Wait for both to complete
      await Promise.all([promise1, promise2]);
      
      // Assert - approleLogin should only be called once
      expect(mockVc.approleLogin).toHaveBeenCalledTimes(1);
    });
  });
  
  describe('kvRead', () => {
    it('should read secrets from Vault KV store', async () => {
      // Arrange
      mockVc.approleLogin.mockResolvedValue({
        auth: {
          client_token: 'test-token',
          lease_duration: 3600
        }
      });
      
      const secretData = { key1: 'value1', key2: 'value2' };
      mockVc.read.mockResolvedValue({
        data: { data: secretData }
      });
      
      // Act
      const result = await vault.kvRead('test/path');
      
      // Assert
      expect(result).toEqual(secretData);
      expect(mockVc.read).toHaveBeenCalledWith('kv/data/test/path');
      expect(logger.info).toHaveBeenCalledWith(
        { fullPath: 'kv/data/test/path' },
        'Loaded secret from path'
      );
    });
    
    it('should return empty object when secret not found (404)', async () => {
      // Arrange
      mockVc.approleLogin.mockResolvedValue({
        auth: {
          client_token: 'test-token',
          lease_duration: 3600
        }
      });
      
      const error = new Error('Not found');
      error.toString = () => '404 Not Found';
      mockVc.read.mockRejectedValue(error);
      
      // Act
      const result = await vault.kvRead('test/path');
      
      // Assert
      expect(result).toEqual({});
      expect(logger.debug).toHaveBeenCalledWith(
        { fullPath: 'kv/data/test/path' },
        'Secret not found (404)'
      );
    });
    
    it('should handle errors when reading secrets', async () => {
      // Arrange
      mockVc.approleLogin.mockResolvedValue({
        auth: {
          client_token: 'test-token',
          lease_duration: 3600
        }
      });
      
      const error = new Error('Permission denied');
      mockVc.read.mockRejectedValue(error);
      
      // Act & Assert
      await expect(vault.kvRead('test/path')).rejects.toThrow('Permission denied');
      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          fullPath: 'kv/data/test/path',
          error
        }),
        'Error reading secret from Vault'
      );
    });
    
    it('should log errors when login fails', async () => {
      // Skip this test if it's timing out
      // This would normally test the login error case in kvRead
      const mockLogin = jest.spyOn(vault as any, 'login');
      const loginError = new Error('Login failed');
      mockLogin.mockRejectedValue(loginError);
      
      // Act & Assert
      await expect(vault.kvRead('test/path')).rejects.toThrow('Login failed');
      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          fullPath: 'kv/data/test/path',
          error: loginError
        }),
        'Failed to login to Vault before reading secret'
      );
      
      // Restore the original login method
      mockLogin.mockRestore();
    });
  });
  
  describe('getDbCredentials', () => {
    it('should retrieve database credentials from Vault', async () => {
      // Arrange
      mockVc.approleLogin.mockResolvedValue({
        auth: {
          client_token: 'test-token',
          lease_duration: 3600
        }
      });
      
      mockVc.read.mockResolvedValue({
        lease_duration: 3600,
        data: {
          username: 'db-user',
          password: 'db-password'
        }
      });
      
      // Act
      const result = await vault.getDbCredentials('db-role');
      
      // Assert
      expect(result).toEqual({
        ttl: 3600,
        username: 'db-user',
        password: 'db-password'
      });
      expect(mockVc.read).toHaveBeenCalledWith('database/creds/db-role');
      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          role: 'db-role',
          username: 'db-user',
          ttl: 3600,
          passwordLength: 11
        }),
        'Successfully retrieved database credentials'
      );
    });
    
    it('should handle errors when retrieving database credentials', async () => {
      // Arrange
      mockVc.approleLogin.mockResolvedValue({
        auth: {
          client_token: 'test-token',
          lease_duration: 3600
        }
      });
      
      const error = new Error('Role not found');
      mockVc.read.mockRejectedValue(error);
      
      // Act & Assert
      await expect(vault.getDbCredentials('invalid-role')).rejects.toThrow('Role not found');
      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          role: 'invalid-role',
          error
        }),
        'Failed to get database credentials from Vault'
      );
    });
  });
});