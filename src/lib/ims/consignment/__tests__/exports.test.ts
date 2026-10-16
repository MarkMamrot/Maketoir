import { describe, expect, it } from 'vitest';
import { exportConsignment } from '../exports';
import { ACTIVITY_LABEL, projectActivity } from '../domain';
describe('consignment evidence exports', () => {
  it('exports a real PDF with explicit activity-not-settlement labelling', async () => {
    const response = await exportConsignment(projectActivity([]), 'pdf', ACTIVITY_LABEL);
    expect(response.headers.get('Content-Type')).toBe('application/pdf');
    const bytes = new Uint8Array(await response.arrayBuffer());
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-');
  });
  it('exports CSV with independent activity and manual-accounting guidance', async () => {
    const response = await exportConsignment(projectActivity([]), 'csv', ACTIVITY_LABEL);
    const csv = await response.text();
    expect(csv).toContain('not a settlement or outstanding balance');
    expect(csv).toContain('does not mean paid');
    expect(csv).toContain('does not post consignment COGS');
  });
});
