export const PROSPECT_LEAD_STATUSES = ['new', 'contacting', 'qualified', 'demo_booked', 'won', 'lost', 'spam'] as const;

export interface ProspectLeadCapabilities {
  assignment: boolean;
  notes: boolean;
  lossReason: boolean;
}

export function validateDateParameter(value: string, label: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return `${label} must use YYYY-MM-DD.`;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value
    ? `${label} must be a valid date.`
    : null;
}

export function getLeadCapabilities(columns: Iterable<string>): ProspectLeadCapabilities {
  const available = new Set(columns);
  return {
    assignment: available.has('assigned_to'),
    notes: available.has('notes'),
    lossReason: available.has('loss_reason'),
  };
}