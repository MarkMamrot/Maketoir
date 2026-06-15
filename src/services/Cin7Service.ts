import axios from 'axios';

export class Cin7Service {
  private apiId: string;
  private apiKey: string;
  private baseUrl: string = 'https://api.cin7.com/api/v1';

  /**
   * @param accountId Per-business Cin7 account ID (from DB connections table).
   * @param apiKey    Per-business Cin7 API key (decrypted, from DB connections table).
   *
   * Do NOT pass process.env values here — ENV vars are a system-level fallback only.
   * All production use should supply per-business credentials fetched from the DB.
   */
  constructor(accountId: string, apiKey: string) {
    this.apiId  = accountId;
    this.apiKey = apiKey;
  }

  async testConnection() {
    if (!this.apiId || !this.apiKey) {
      throw new Error('Cin7 Account ID and API Key are required.');
    }

    const auth = Buffer.from(`${this.apiId}:${this.apiKey}`).toString('base64');

    // Test by pulling a single product
    const response = await axios.get(`${this.baseUrl}/Products?rows=1`, {
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/json',
      },
    });

    return response.data;
  }
}
