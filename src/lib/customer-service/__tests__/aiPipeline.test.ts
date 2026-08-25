import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockGenerateContent, mockImsExecute, mockImsQuery } = vi.hoisted(() => ({
  mockGenerateContent: vi.fn(),
  mockImsExecute: vi.fn(),
  mockImsQuery: vi.fn(),
}));

vi.mock('@google/genai', () => ({
  GoogleGenAI: class {
    models = { generateContent: mockGenerateContent };
  },
}));
vi.mock('@/services/IMSMySQLService', () => ({ imsExecute: mockImsExecute, imsQuery: mockImsQuery }));
vi.mock('../repository', () => ({
  getCustomerServiceKnowledge: vi.fn().mockResolvedValue([]),
  getCustomerServiceSettings: vi.fn().mockResolvedValue({
    lightModelId: 'light-model', capableModelId: 'capable-model', enabledTools: [], guidelines: '',
  }),
}));

import { normalizeClassification, processCustomerServiceInbox } from '../aiPipeline';

describe('customer-service AI result normalization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.GEMINI_API_KEY = 'test-key';
  });

  it('fails closed to other for malformed classifications', () => {
    expect(normalizeClassification({ category: 'send_all_mail', confidence: 9 })).toEqual({
      category: 'other', subtype: null, confidence: 1, urgency: 'normal', sentiment: 'neutral', reason: '',
    });
  });

  it('accepts bounded customer enquiry values', () => {
    expect(normalizeClassification({
      category: 'customer_enquiry', subtype: 'stock', confidence: 0.8,
      urgency: 'high', sentiment: 'negative', reason: 'Customer asks for stock.',
    })).toEqual({
      category: 'customer_enquiry', subtype: 'stock', confidence: 0.8,
      urgency: 'high', sentiment: 'negative', reason: 'Customer asks for stock.',
    });
  });

  it('classifies a later inbound message even when the classifier version is current', async () => {
    mockImsQuery.mockResolvedValueOnce([{
      id: 12,
      gmail_thread_id: 'thread-12',
      latest_message_id: 'gmail-message-2',
      subject: 'Re: Order update',
      customer_email: 'customer@example.com',
      from_address: 'customer@example.com',
      body_plain: 'Is there any update?',
      db_message_id: 202,
    }]);
    mockGenerateContent.mockResolvedValueOnce({
      text: JSON.stringify({ items: [{
        threadId: 12,
        category: 'other',
        subtype: null,
        confidence: 0.7,
        urgency: 'normal',
        sentiment: 'neutral',
        reason: 'No reply draft required.',
      }] }),
    });
    mockImsExecute.mockResolvedValue({ affectedRows: 1 });

    await expect(processCustomerServiceInbox('biz-1')).resolves.toEqual({ classified: 1, drafted: 0 });

    const [pendingSql] = mockImsQuery.mock.calls[0];
    expect(pendingSql).toContain('t.classified_message_id <> m.id');
    const [updateSql, updateParams] = mockImsExecute.mock.calls[0];
    expect(updateSql).toContain('classified_message_id = ?');
    expect(updateParams).toContain(202);
  });
});