import axios from 'axios';

export class Cin7Service {
  private apiId: string;
  private apiKey: string;
  private baseUrl: string = 'https://api.cin7.com/api/v1';

  constructor() {
    this.apiId = process.env.CIN7_ACCOUNT_ID || '';
    this.apiKey = process.env.CIN7_API_KEY || '';
  }

  async testConnection() {
    if (!this.apiId || !this.apiKey) {
      throw new Error('CIN7_ACCOUNT_ID and CIN7_API_KEY (Cin7 Omni) must be configured in .env');
    }

    const auth = Buffer.from(`${this.apiId}:${this.apiKey}`).toString('base64');
    
    // Test by pulling a single product
    const response = await axios.get(`${this.baseUrl}/Products?rows=1`, {
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/json'
      }
    });

    return response.data;
  }
}
