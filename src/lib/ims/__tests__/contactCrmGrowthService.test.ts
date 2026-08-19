import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockContactGet, mockImsQuery, mockImsExecute } = vi.hoisted(() => ({
  mockContactGet: vi.fn(),
  mockImsQuery: vi.fn(),
  mockImsExecute: vi.fn(),
}));

vi.mock('@/lib/ims/ImsRepository', () => ({ ImsContactsRepo: { get: mockContactGet } }));
vi.mock('@/services/IMSMySQLService', () => ({ imsQuery: mockImsQuery, imsExecute: mockImsExecute }));

import { ContactCrmValidationError } from '../contactCrmService';
import {
  createContactCrmOpportunity,
  getContactCrmSegmentMembers,
  moveContactCrmOpportunity,
  normalizeContactCrmSegmentRules,
} from '../contactCrmGrowthService';

describe('CRM growth service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockContactGet.mockResolvedValue({ id: 42, business_id: 'business-1', type: 'lead', name: 'Prospect' });
    mockImsQuery.mockResolvedValue([]);
    mockImsExecute.mockResolvedValue({ insertId: 7, affectedRows: 1 });
  });

  it('normalizes live segment rules to customer-safe bounded values', () => {
    expect(normalizeContactCrmSegmentRules({
      contactTypes: ['retail_customer', 'supplier', 'retail_customer'],
      tagIds: [3, '3', 4, -1],
      revenueSource: 'pos',
      minimumRevenue: '100',
      loyaltyStatus: 'member',
    })).toEqual({
      contactTypes: ['retail_customer'], tagIds: [3, 4], revenueSource: 'pos',
      minimumRevenue: 100, maximumRevenue: null, activeWithinDays: null,
      inactiveForDays: null, locationIds: [], loyaltyStatus: 'member',
    });
  });

  it('rejects contradictory activity and revenue rules', () => {
    expect(() => normalizeContactCrmSegmentRules({ minimumRevenue: 200, maximumRevenue: 100 }))
      .toThrow(ContactCrmValidationError);
    expect(() => normalizeContactCrmSegmentRules({ activeWithinDays: 30, inactiveForDays: 90 }))
      .toThrow(ContactCrmValidationError);
  });

  it('builds a tenant-fenced customer-only segment query', async () => {
    mockImsQuery
      .mockResolvedValueOnce([{ id: 9, business_id: 'business-1', rules_json: JSON.stringify({ tagIds: [3] }) }])
      .mockResolvedValueOnce([{ id: 42, name: 'Customer' }]);

    const result = await getContactCrmSegmentMembers('business-1', 9);

    expect(result.members).toHaveLength(1);
    expect(mockImsQuery.mock.calls[1][0]).toContain("c.type IN ('retail_customer','b2b_customer','both')");
    expect(mockImsQuery.mock.calls[1][0]).toContain('ct.business_id = c.business_id');
    expect(mockImsQuery.mock.calls[1][1].filter((value: unknown) => value === 'business-1')).toHaveLength(4);
  });

  it('creates forecast-only opportunities for tenant-owned leads', async () => {
    mockImsQuery.mockResolvedValueOnce([{ id: 2, business_id: 'business-1', category: 'open', default_probability: 25 }]);

    await createContactCrmOpportunity('business-1', {
      contactId: 42, stageId: 2, title: 'Spring range', expectedValue: '1100.50', ownerUserId: 8, ownerName: 'Sam',
    }, { id: 9, name: 'Alex' });

    expect(mockContactGet).toHaveBeenCalledWith(42, 'business-1');
    expect(mockImsExecute).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO ims_crm_opportunities'), [
      'business-1', 42, 2, 'Spring range', null, 1100.5, 25, 8, 'Sam', null, 9, 'Alex', 'open',
    ]);
  });

  it('requires an explicit customer type and fences lead conversion by business', async () => {
    mockImsQuery.mockImplementation((sql: string) => Promise.resolve(sql.includes('ims_crm_pipeline_stages')
      ? [{ id: 6, business_id: 'business-1', category: 'won', default_probability: 100 }]
      : [{ id: 11, contact_id: 42, contact_type: 'lead' }]));

    await expect(moveContactCrmOpportunity('business-1', 11, { stageId: 6 }))
      .rejects.toBeInstanceOf(ContactCrmValidationError);
    expect(mockImsExecute).not.toHaveBeenCalled();

    await moveContactCrmOpportunity('business-1', 11, { stageId: 6, conversionType: 'b2b_customer' });
    expect(mockImsExecute.mock.calls[0]).toEqual([
      expect.stringContaining('WHERE id = ? AND business_id = ? AND type = ?'),
      ['b2b_customer', 42, 'business-1', 'lead'],
    ]);
  });
});
