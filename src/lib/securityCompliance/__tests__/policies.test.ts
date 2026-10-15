import { describe, expect, it } from 'vitest';
import { createDefaultPolicyAssignments, POLICY_ROLES, SECURITY_POLICIES, validatePolicyAssignments } from '../policies';

describe('security policy definitions and responsibilities', () => {
  it('defaults every editable responsibility to Marek Mamrot without sharing mutable defaults', () => {
    const defaults = createDefaultPolicyAssignments();
    expect(Object.keys(defaults)).toEqual(POLICY_ROLES.map(role => role.id));
    expect(Object.values(defaults).every(name => name === 'Marek Mamrot')).toBe(true);
    defaults.incidentLead = 'New lead';
    expect(createDefaultPolicyAssignments().incidentLead).toBe('Marek Mamrot');
  });

  it('accepts plain text names and trims them', () => {
    const values = { ...createDefaultPolicyAssignments(), incidentLead: '  Casey Example  ' };
    expect(validatePolicyAssignments(values).incidentLead).toBe('Casey Example');
  });

  it.each([null, [], {}, { ...createDefaultPolicyAssignments(), unknown: 'person' }])('rejects invalid field shapes', value => {
    expect(() => validatePolicyAssignments(value)).toThrow();
  });

  it.each(['', '   ', 'a'.repeat(121), 'a\nb', 'a\u0000b', 42])('rejects invalid names (%s)', name => {
    expect(() => validatePolicyAssignments({ ...createDefaultPolicyAssignments(), incidentLead: name })).toThrow('Incident response lead');
  });

  it('defines seven uniquely identified versioned policies with summaries and detailed procedures', () => {
    expect(SECURITY_POLICIES).toHaveLength(7);
    expect(new Set(SECURITY_POLICIES.map(policy => policy.id)).size).toBe(7);
    for (const policy of SECURITY_POLICIES) {
      expect(policy.version).toBe(['identity-access', 'logging-monitoring'].includes(policy.id) ? '1.1' : '1.0');
      expect(policy.summary.length).toBeGreaterThanOrEqual(3);
      expect(policy.sections.length).toBeGreaterThanOrEqual(3);
      expect(policy.roles.every(id => POLICY_ROLES.some(role => role.id === id))).toBe(true);
    }
  });

  it('includes the exact notification, password, logging, and PII disposal requirements', () => {
    const text = (id: string) => JSON.stringify(SECURITY_POLICIES.find(policy => policy.id === id));
    expect(text('incident-response')).toContain('security@amazon.com');
    expect(text('incident-response')).toContain('24 hours after detection');
    expect(text('incident-response')).toContain('every six months');
    expect(text('identity-access')).toContain('12 characters');
    expect(text('identity-access')).toContain('365 days');
    expect(text('identity-access')).toContain('last 10 passwords');
    expect(text('logging-monitoring')).toContain('minimum of 12 months');
    expect(text('logging-monitoring')).toContain('every 14 days');
    expect(text('data-handling')).toContain('30 days after delivery');
    expect(text('data-handling')).toContain('Amazon Customer');
    expect(text('data-handling')).toContain('must not be a reversible pseudonym');
  });
});
