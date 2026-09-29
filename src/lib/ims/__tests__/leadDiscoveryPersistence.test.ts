import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getConnection } = vi.hoisted(() => ({ getConnection: vi.fn() }));

vi.mock('@/services/IMSMySQLService', () => ({
  getIMSPool: () => ({ getConnection }),
}));

import {
  importApprovedLeadCandidate,
  preflightLeadCandidate,
  SOLVANTIS_LEAD_BUSINESS_ID,
} from '../leadDiscoveryService';

const candidate = {
  candidateKey: 'example-retailer',
  batchId: 'sydney-2026-09-28',
  sourceQuery: 'Sydney retailers',
  name: 'Example Retailer',
  email: 'sales@example.com',
  discoveredAt: '2026-09-28T10:00:00Z',
  sources: [{ url: 'https://example-centre.test/stores/example', kind: 'centre_directory' as const }],
};

function connectionWithResults(results: unknown[]) {
  const execute = vi.fn();
  for (const result of results) execute.mockResolvedValueOnce([result, []]);
  return {
    beginTransaction: vi.fn(),
    commit: vi.fn(),
    execute,
    release: vi.fn(),
    rollback: vi.fn(),
  };
}

describe('lead discovery persistence', () => {
  beforeEach(() => vi.clearAllMocks());

  it('is locked to the registered Solvantis business ID', () => {
    expect(SOLVANTIS_LEAD_BUSINESS_ID).toBe('1dNtvCAmSU8_QXNpdMsONfzRqNe1UXAzG7j2lKyqdJOQ');
  });

  it('fences replay and contact matching to the Solvantis business', async () => {
    const connection = connectionWithResults([[], []]);

    await expect(preflightLeadCandidate(connection as any, candidate)).resolves.toMatchObject({ outcome: 'create' });

    expect(connection.execute).toHaveBeenCalledTimes(2);
    expect(connection.execute.mock.calls[0][1][0]).toBe(SOLVANTIS_LEAD_BUSINESS_ID);
    expect(connection.execute.mock.calls[1][1]).toEqual([SOLVANTIS_LEAD_BUSINESS_ID]);
  });

  it('attaches evidence without overwriting or reclassifying an existing contact', async () => {
    const existing = { id: 42, type: 'lead', name: 'Example Retailer', email: 'sales@example.com', lead_temperature: 'hot' };
    const connection = connectionWithResults([[], [existing], { affectedRows: 1 }]);
    getConnection.mockResolvedValue(connection);

    await expect(importApprovedLeadCandidate(candidate)).resolves.toMatchObject({
      outcome: 'existing',
      contact: { id: 42 },
      evidenceAttached: true,
    });

    const sql = connection.execute.mock.calls.map(call => String(call[0]));
    expect(sql.some(statement => statement.includes('INSERT IGNORE INTO ims_crm_lead_discoveries'))).toBe(true);
    expect(sql.some(statement => statement.includes('UPDATE ims_contacts'))).toBe(false);
    expect(sql.some(statement => statement.includes('INSERT INTO ims_contacts'))).toBe(false);
    expect(connection.commit).toHaveBeenCalledOnce();
    expect(connection.rollback).not.toHaveBeenCalled();
  });

  it('stores owner and business email hypotheses only in enrichment tables', async () => {
    const existing = { id: 42, type: 'lead', name: 'Example Retailer', email: 'sales@example.com' };
    const connection = connectionWithResults([[], [existing], { affectedRows: 1 }, { insertId: 7 }, { affectedRows: 1 }, { affectedRows: 1 }]);
    getConnection.mockResolvedValue(connection);

    await importApprovedLeadCandidate({
      ...candidate,
      website_url: 'https://example.com',
      people: [{
        personKey: 'jane-smith-owner', fullName: 'Jane Smith', role: 'owner', sourceUrl: 'https://example.com/about',
        contacts: [{ type: 'email', value: 'jane.smith@example.com', evidence: 'inferred' }],
      }],
      businessContacts: [{ type: 'email', value: 'info@example.com', evidence: 'inferred' }],
    });

    const sql = connection.execute.mock.calls.map(call => String(call[0]));
    expect(sql.some(statement => statement.includes('INSERT INTO ims_crm_lead_people'))).toBe(true);
    expect(sql.filter(statement => statement.includes('INSERT IGNORE INTO ims_crm_lead_contact_points'))).toHaveLength(2);
    expect(sql.some(statement => statement.includes('UPDATE ims_contacts'))).toBe(false);
    expect(sql.some(statement => statement.includes('INSERT INTO ims_contacts'))).toBe(false);
  });
});