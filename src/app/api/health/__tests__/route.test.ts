import { afterEach, describe, expect, it } from 'vitest';

import { GET } from '../route';

describe('GET /api/health', () => {
  const originalDeploymentId = process.env.RAILWAY_DEPLOYMENT_ID;

  afterEach(() => {
    if (originalDeploymentId === undefined) delete process.env.RAILWAY_DEPLOYMENT_ID;
    else process.env.RAILWAY_DEPLOYMENT_ID = originalDeploymentId;
  });

  it('reports process readiness without checking a database', async () => {
    process.env.RAILWAY_DEPLOYMENT_ID = 'deployment-123';

    const response = await GET();

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    await expect(response.json()).resolves.toEqual({
      status: 'ok',
      deploymentId: 'deployment-123',
    });
  });
});