// src/services/GoogleAnalyticsService.ts
import { BetaAnalyticsDataClient } from '@google-analytics/data';

export class GoogleAnalyticsService {
  private analyticsDataClient: BetaAnalyticsDataClient;
  private propertyId: string;

  constructor(propertyId: string) {
    this.propertyId = propertyId;

    let authOptions: any = {};

    // Prioritize direct environment variables for easy hosting management
    if (process.env.GOOGLE_CLIENT_EMAIL && process.env.GOOGLE_PRIVATE_KEY) {
      authOptions.credentials = {
        client_email: process.env.GOOGLE_CLIENT_EMAIL,
        private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      };
    } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON) {
      authOptions.credentials = JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON);
    } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS_BASE64) {
      const credentials = JSON.parse(
        Buffer.from(process.env.GOOGLE_APPLICATION_CREDENTIALS_BASE64, 'base64').toString('ascii')
      );
      authOptions.credentials = credentials;
    }

    this.analyticsDataClient = new BetaAnalyticsDataClient(authOptions);
  }

  /**
   * Fetch recent basic performance (Sessions, Conversions, Revenue)
   * This forms part of the Phase 3 (Intelligent Budgeting) data foundation.
   */
  async getRecentPerformance() {
    try {
      const [response] = await this.analyticsDataClient.runReport({
        property: `properties/${this.propertyId}`,
        dateRanges: [
          {
            startDate: '7daysAgo',
            endDate: 'today',
          },
        ],
        dimensions: [
          {
            name: 'date',
          },
        ],
        metrics: [
          {
            name: 'sessions',
          },
          {
            name: 'conversions',
          },
          {
            name: 'totalRevenue',
          }
        ],
      });

      return response.rows?.map(row => ({
        date: row.dimensionValues?.[0].value,
        sessions: parseInt(row.metricValues?.[0].value || '0', 10),
        conversions: parseFloat(row.metricValues?.[1].value || '0'),
        revenue: parseFloat(row.metricValues?.[2].value || '0')
      })) || [];
      
    } catch (error: any) {
      console.error("Error fetching GA4 data:", error.message);
      throw error;
    }
  }

  async runReport(dimensions: string[], metrics: string[], startDate: string, endDate: string): Promise<string[][]> {
    const [res] = await this.analyticsDataClient.runReport({
      property: `properties/${this.propertyId}`,
      dateRanges: [{ startDate, endDate }],
      dimensions: dimensions.map(name => ({ name })),
      metrics: metrics.map(name => ({ name })),
      limit: 100000,
    });
    if (!res.rows?.length) return [];
    const headers = [...dimensions, ...metrics];
    const rows: string[][] = [headers];
    for (const row of res.rows) {
      rows.push([
        ...(row.dimensionValues ?? []).map((v: any) => v.value ?? ''),
        ...(row.metricValues ?? []).map((v: any) => v.value ?? ''),
      ]);
    }
    return rows;
  }
}
