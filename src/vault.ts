import vault from 'node-vault';
import { logger } from './logger';

export class Vault {
  private loggingIn?: Promise<void>;
  private readonly vc;

  constructor() {
    this.vc = vault({
      apiVersion: 'v1', // default
      endpoint: 'http://vault.service.consul:8200', // default
    });
  }

  /**
   * Authenticates with Vault using AppRole credentials
   * Caches the token and handles automatic token refresh
   */
  async login() {
    if(this.vc.token) {
      logger.debug('Using cached vault credentials');
      return;
    }
    if(!this.loggingIn) {
      this.loggingIn = new Promise(async (resolve) => {
        logger.debug('Generating new vault token');
        const result = await this.vc.approleLogin({
          role_id: process.env.VAULT_ROLE_ID,
          secret_id: process.env.VAULT_SECRET_ID,
        });
        this.vc.token = result.auth.client_token;
        setTimeout(() => {
          // @ts-expect-error
          this.vc.token = undefined;
        },(result.auth.lease_duration - 10) * 1_000);
        resolve();
        this.loggingIn = undefined;
      });
    } 
    await this.loggingIn;

  }

  /**
   * Reads secrets from Vault's KV store
   * @param path Path to the secret in Vault (without kv/data/ prefix)
   * @returns Object containing key-value pairs of secrets
   */
  async kvRead(path: string): Promise<Record<string, string>> {
    const fullPath = `kv/data/${path}`;
    await this.login();
    try {
      const { data: { data } } = await this.vc.read(fullPath);
      logger.info({ fullPath }, 'Loaded secret from path');
      return data;
    } catch (error) {
      if(String(error).includes('404')) {
        return {};
      }
      throw error;
    }
  }

  /**
   * Generates dynamic database credentials from Vault
   * @param role Database role to generate credentials for
   * @returns Object containing username, password and TTL in seconds
   */
  async getDbCredentials(role: string): Promise<{username: string, password: string, ttl: number}> {
    const { lease_duration: ttl, data: { username, password } } = await this.vc.read(`database/creds/${role}`);
    return { ttl, username, password };
  }
}
