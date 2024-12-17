import vault from 'node-vault';

export class Vault {
  private readonly vc;

  constructor() {
    this.vc = vault({
      apiVersion: 'v1', // default
      endpoint: 'http://vault.service.consul:8200', // default
    });
  }

  private async login() {
    if(this.vc.token) {
      console.log('Using cached credentials');
      return;
    }
    console.log('Generating new token');
    const result = await this.vc.approleLogin({
      role_id: process.env.VAULT_ROLE_ID,
      secret_id: process.env.VAULT_SECRET_ID,
    });
    this.vc.token = result.auth.client_token;
    setTimeout(() => {
      //@ts-ignore
      this.vc.token = undefined;
    },result.auth.lease_duration * 1_000);

  }

  async kvRead(path: string): Promise<Record<string, string>> {
    const fullPath = `kv/data/${path}`;
    await this.login();
    try {
      const { data: { data } } = await this.vc.read(fullPath);
      console.log("Loaded secret from path", fullPath);
      return data;
    } catch (error) {
      if(String(error).includes('404')) {
        return {};
      }
      throw error;
    }
  }
}
