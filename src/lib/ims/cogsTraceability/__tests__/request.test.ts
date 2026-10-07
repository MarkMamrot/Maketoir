import { describe, expect, it } from 'vitest';
import { parseRequest } from '../request';

describe('traceability request validation', () => {
  it('defaults to a movement range with an exclusive upper bound', () => {
    expect(parseRequest(new URLSearchParams(), '2026-10-07')).toMatchObject({ basis: 'movement', from: '2026-09-08', to: '2026-10-07', toExclusive: '2026-10-08' });
  });
  it.each(['from=2026-02-30', 'basis=unsafe', 'sort=sql', 'groups=channel,channel', 'page=-1', 'pageSize=500', 'filters={}'])('rejects invalid request %s', query => {
    expect(() => parseRequest(new URLSearchParams(query), '2026-10-07')).toThrow();
  });
  it('accepts allowlisted grouping, numeric and missing filters', () => {
    const params = new URLSearchParams({ groups: 'channel,warehouse', filters: JSON.stringify([{ field: 'cogs', operator: 'gte', value: '20' }, { field: 'invoiceDate', operator: 'missing', value: '' }]) });
    expect(parseRequest(params).filters).toHaveLength(2);
  });
});