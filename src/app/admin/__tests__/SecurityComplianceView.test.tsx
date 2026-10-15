/** @vitest-environment jsdom */
import React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultPolicyAssignments } from '@/lib/securityCompliance/policies';

vi.mock('@/components/help/UnifiedHelpDrawer', () => ({
  UnifiedHelpDrawer: ({ open, currentContext }: { open: boolean; currentContext: string }) =>
    open ? <div>Policy Help: {currentContext}</div> : null,
}));
vi.mock('../SecurityPolicyEvidenceView', () => ({ default: () => null }));
import SecurityComplianceView from '../SecurityComplianceView';

const fetchMock = vi.fn();
const state = (revision = 0, lead = 'Marek Mamrot') => ({
  assignments: { ...createDefaultPolicyAssignments(), incidentLead: lead },
  revision, updatedAt: revision ? '2026-10-15T00:00:00.000Z' : null, updatedBy: revision ? 42 : null,
});
const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockResolvedValue(response({ success: true, state: state() }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('Security & Compliance workspace', () => {
  it('shows editable default names and draft summaries above detailed procedures', async () => {
    render(<SecurityComplianceView />);
    await screen.findByText('Default values - not yet saved');
    expect(screen.getAllByDisplayValue('Marek Mamrot')).toHaveLength(11);
    expect(screen.getByRole('heading', { name: 'Quick summary' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Detailed policy' })).toBeTruthy();
    expect(screen.getByText('Documented policies - controls are not certified')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Save responsibilities' }).matches(':disabled')).toBe(false);
  });

  it('saves edited names with the current revision and restores persisted values on reload', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(response({ success: true, state: state(3) }));
    fetchMock.mockResolvedValueOnce(response({ success: true, state: state(4, 'Casey Example') }));
    fetchMock.mockResolvedValueOnce(response({ success: true, state: state(4, 'Casey Example') }));
    render(<SecurityComplianceView />);
    await screen.findByText(/Saved revision 3/);
    const lead = screen.getByRole('textbox', { name: 'Incident response lead' });
    await user.clear(lead); await user.type(lead, 'Casey Example');
    expect(screen.queryByText('Casey Example')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Save responsibilities' }));
    await screen.findByText(/Responsibilities saved/);
    const options = fetchMock.mock.calls[1][1];
    expect(options.method).toBe('PUT');
    expect(JSON.parse(options.body)).toMatchObject({ expectedRevision: 3, assignments: { incidentLead: 'Casey Example' } });
    await user.click(screen.getByRole('button', { name: 'Reload saved values' }));
    await screen.findByText(/Saved revision 4/);
    expect((screen.getByRole('textbox', { name: 'Incident response lead' }) as HTMLInputElement).value).toBe('Casey Example');
  });

  it('blocks saves when loading fails instead of persisting displayed defaults', async () => {
    fetchMock.mockResolvedValueOnce(response({ error: 'Database unavailable' }, 500));
    render(<SecurityComplianceView />);
    await screen.findByRole('alert');
    expect(screen.getByRole('button', { name: 'Save responsibilities' }).matches(':disabled')).toBe(true);
    expect(screen.getByRole('textbox', { name: 'Incident response lead' }).matches(':disabled')).toBe(true);
  });

  it('retains edits and requires reload after a stale save', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(response({ success: true, state: state(3) }));
    fetchMock.mockResolvedValueOnce(response({ error: 'Responsibilities changed in another session.' }, 409));
    render(<SecurityComplianceView />);
    await screen.findByText(/Saved revision 3/);
    await user.clear(screen.getByRole('textbox', { name: 'Incident response lead' }));
    await user.type(screen.getByRole('textbox', { name: 'Incident response lead' }), 'Casey');
    await user.click(screen.getByRole('button', { name: 'Save responsibilities' }));
    await screen.findByRole('alert');
    expect(screen.getByRole('button', { name: 'Save responsibilities' }).matches(':disabled')).toBe(true);
    expect((screen.getByRole('textbox', { name: 'Incident response lead' }) as HTMLInputElement).value).toBe('Casey');
  });

  it('shows the PII removal policy and mapped Help without claiming deletion is implemented', async () => {
    const user = userEvent.setup();
    render(<SecurityComplianceView />);
    await screen.findByText('Default values - not yet saved');
    await user.click(screen.getByRole('button', { name: 'Data Classification, Privacy and Retention' }));
    expect(screen.getByRole('heading', { name: 'Data Classification, Privacy and Retention' })).toBeTruthy();
    expect(screen.getByText(/Delete or irreversibly remove Amazon buyer PII no later than 30 days after delivery/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Help' }));
    await waitFor(() => expect(screen.getByText('Policy Help: security-compliance')).toBeTruthy());
  });
});
