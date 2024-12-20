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

  private async login() {
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
          //@ts-ignore
          this.vc.token = undefined;
        },(result.auth.lease_duration - 10) * 1_000);
        resolve();
        this.loggingIn = undefined;
      });
    } 
    await this.loggingIn;

  }

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
}
