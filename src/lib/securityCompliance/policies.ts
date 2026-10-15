export const DEFAULT_POLICY_RESPONSIBLE_PERSON = 'Marek Mamrot';

export const POLICY_ROLES = [
  { id: 'policyOwner', label: 'Policy owner', description: 'Maintains policies, review dates, and implementation evidence.' },
  { id: 'incidentLead', label: 'Incident response lead', description: 'Coordinates containment, investigation, and recovery.' },
  { id: 'incidentBackup', label: 'Incident response backup', description: 'Takes over when the lead is unavailable.' },
  { id: 'amazonNotificationOwner', label: 'Amazon notification owner', description: 'Reports incidents involving Amazon Information within 24 hours of detection.' },
  { id: 'accessOwner', label: 'Access and credentials owner', description: 'Reviews user/service access and credential lifecycle.' },
  { id: 'privacyOwner', label: 'Privacy and data handling owner', description: 'Maintains processing records and oversees PII disposal.' },
  { id: 'keyCustodian', label: 'Encryption key custodian', description: 'Controls key permissions, rotation, and recovery.' },
  { id: 'logReviewer', label: 'Security log reviewer', description: 'Reviews security logs at least every 14 days.' },
  { id: 'changeOwner', label: 'Change implementer', description: 'Prepares changes, tests, and rollback plans.' },
  { id: 'changeApprover', label: 'Change reviewer and approver', description: 'Independently verifies changes before release.' },
  { id: 'deviceOwner', label: 'Developer device and test-data owner', description: 'Maintains approved devices and safe testing practices.' },
] as const;

export type PolicyRoleId = typeof POLICY_ROLES[number]['id'];
export type PolicyAssignments = Record<PolicyRoleId, string>;

export interface SecurityPolicy {
  id: string;
  title: string;
  version: string;
  reviewCadence: string;
  roles: readonly PolicyRoleId[];
  summary: readonly string[];
  sections: ReadonlyArray<{ heading: string; paragraphs: readonly string[] }>;
}

export const SECURITY_POLICIES: readonly SecurityPolicy[] = [
  {
    id: 'incident-response',
    title: 'Incident Response and Amazon Notification',
    version: '1.0',
    reviewCadence: 'Every six months, and after an incident or material change',
    roles: ['policyOwner', 'incidentLead', 'incidentBackup', 'amazonNotificationOwner'],
    summary: [
      'Preserve evidence, contain the incident, investigate, and verify recovery.',
      'Notify security@amazon.com within 24 hours of detecting a security incident involving Amazon Information; do not wait for a completed investigation.',
      'Keep an emergency runbook outside Solvantis and review the plan every six months.',
    ],
    sections: [
      { heading: 'Scope and responsibility', paragraphs: [
        'This procedure covers database compromise, unauthorized access, leaked information or credentials, and suspected compromise of systems handling Amazon Information. The incident lead coordinates the response; the backup takes over if the lead is unavailable. The notification owner is responsible for Amazon reporting.',
        'Named responsibilities are operational assignments, not account permissions. When one person holds several roles, record that concentration and establish a reachable backup before relying on the plan for live incidents.',
      ] },
      { heading: 'Detection, containment, and investigation', paragraphs: [
        'Record the detection time in UTC, detection source, affected accounts and systems, whether Amazon Information is involved, and the incident owner. Preserve relevant logs and evidence in restricted storage without copying unnecessary buyer PII.',
        'Revoke compromised sessions and credentials, restrict database or service access, and isolate affected devices or services as appropriate. Investigate the entry point, activity, affected data, and likely impact. Do not destroy evidence or restore normal access before the cause is addressed.',
      ] },
      { heading: 'Notification and recovery', paragraphs: [
        'Notify security@amazon.com no later than 24 hours after detection of an incident involving Amazon Information. Send the available facts even if investigation is continuing, and follow up as facts are confirmed. Retain notification time and delivery evidence; a draft or failed send does not satisfy notification.',
        'Escalate early to the backup if the notification owner is unavailable. Maintain an offline copy of emergency contacts and reporting instructions so an application outage cannot prevent notification. Notify affected customers and authorities when required.',
        'Verify remediation and secure operation before restoring access. Document decisions, containment, recovery, notifications, and corrective actions. Review this policy every six months, perform a recorded response exercise, and review lessons after each incident.',
      ] },
    ],
  },
  {
    id: 'identity-access',
    title: 'Identity, Passwords and Access Management',
    version: '1.1',
    reviewCadence: 'Quarterly access reviews; annual policy review',
    roles: ['policyOwner', 'accessOwner'],
    summary: [
      'Use individually identified platform accounts, MFA, and least-privilege access across all businesses, not a separate Amazon login system.',
      'Require passwords of at least 12 characters with mixed case, numbers, and special characters; renew within 365 days.',
      'Review access quarterly and revoke departed or changed-role access within 24 hours.',
    ],
    sections: [
      { heading: 'Account identification and authorization', paragraphs: [
        'Every named Solvantis platform user, including SuperAdmins, Admins, staff and Advisors, must use an individual account with MFA. These platform controls apply across businesses, not only Amazon-connected accounts. Shared user accounts and shared passwords are prohibited. Cashier PINs, customer wholesale access and native-shop customer sign-ins remain separate workflows and must not be represented as covered by the named-platform password controls.',
        'Maintain a record of account owner, approved access, purpose, approver, and review date across Solvantis, hosting, databases, source control, and device management. Review personnel and service access quarterly. Remove or adjust access within 24 hours of termination or role change.',
      ] },
      { heading: 'Password and MFA requirements', paragraphs: [
        'Enforce a minimum of 12 characters, uppercase and lowercase letters, numbers, and non-whitespace special characters. Passwords must not contain name components, username or sign-in email. The supported maximum is 72 UTF-8 bytes so password hashing does not silently truncate input. Reject reuse of the last 10 passwords; retain only secure hashes for history. Require a minimum password age of one day and a maximum age of 365 days. Initial setup and renewal of legacy credentials with an unknown age establish the first recorded change date.',
        'Apply validation to all creation, invitation, reset, and change routes on the server. Unknown-age, expired or noncompliant credentials must be renewed before the next platform sign-in. Password changes revoke pending MFA sessions and remembered-browser access and clear the current browser session; other already-issued signed sessions retain their existing maximum eight-hour lifetime. New sessions are also capped at the recorded password-expiry deadline. There is no per-request account-state lookup or immediate per-user revocation of existing signed sessions.',
        'For suspected compromise, do not wait for a routine password-change interval: invoke incident response, contain access, revoke affected service credentials and use authorized emergency platform-wide session invalidation where needed. A routine password-reset request must not be used as an undocumented bypass of the one-day minimum or password history.',
        'Keep the existing platform MFA enrollment/challenge, one-time recovery codes and rotating remembered-browser controls. Platform password and MFA failure limits are account-wide across source IPs: five failed attempts trigger a 30-minute lockout, which is stricter than a ten-attempt maximum. Existing MFA preauthentication attempt limits remain in force. Document and resolve any external service that cannot meet the required MFA and credential controls.',
      ] },
      { heading: 'Support access and enforcement', paragraphs: [
        'Developer access to customer information must be tied to a recorded authorized task and limited to the minimum data and time needed. Do not browse customer records without a business reason.',
        'Assignments on this page do not create accounts or grant permissions. Application enforcement and provider-account configuration must be verified separately before this policy is treated as an operational control.',
      ] },
    ],
  },
  {
    id: 'credentials-keys',
    title: 'Credentials and Encryption Key Management',
    version: '1.0',
    reviewCadence: 'Quarterly access review; annual credential and key rotation',
    roles: ['policyOwner', 'accessOwner', 'keyCustodian'],
    summary: [
      'Keep secrets out of repositories, client code, logs, tickets, and test artifacts.',
      'Use managed key control and least-privilege access for PII encryption.',
      'Inventory and rotate secrets and encryption keys annually and after suspected exposure.',
    ],
    sections: [
      { heading: 'Secret storage and exposure prevention', paragraphs: [
        'Store passwords as secure hashes and service secrets in approved protected secret storage. Never hard-code production credentials, commit them to public or private repositories, or include them in browser code, logs, screenshots, tickets, or test data. Use approved password management for human credentials.',
        'Maintain an inventory showing secret purpose, owner, system, access permissions, rotation date, and next rotation deadline without recording secret values. Scan changes for exposed secrets and investigate detections. Revoke and replace exposed credentials; removing a secret from the latest source file alone is insufficient.',
      ] },
      { heading: 'PII encryption and managed keys', paragraphs: [
        'Protect PII at rest with AES-128 or stronger, with AES-256 preferred, and use a managed key management service with controlled key use, audit records, and rotation. Separate master keys from application data and grant only required encrypt/decrypt permissions.',
        'Use envelope encryption and recorded key versions when implementing application-level PII encryption. Protect all retained copies, including shipment data, labels, exports, and backups. Do not treat an environment-variable encryption key or HTTPS as proof of a managed KMS.',
      ] },
      { heading: 'Rotation, outages, and recovery', paragraphs: [
        'Rotate Amazon API credentials and encryption keys at least annually and promptly after suspected compromise. Test rotation and decryption of permitted historical data before retiring a key. Do not destroy keys until retention and recovery obligations for encrypted records are resolved.',
        'Test key recovery and KMS outage handling. A key-service failure must not cause plaintext storage or unrestricted access. Verify secure network transport for all service connections and third-party transfers.',
      ] },
    ],
  },
  {
    id: 'data-handling',
    title: 'Data Classification, Privacy and Retention',
    version: '1.0',
    reviewCadence: 'Quarterly processing inventory review; annual policy review',
    roles: ['policyOwner', 'privacyOwner', 'keyCustodian'],
    summary: [
      'Classify Amazon buyer PII as restricted and maintain processing records.',
      'Remove buyer PII no later than 30 days after order delivery, including retained copies.',
      'Show Amazon Customer after disposal and retain only necessary non-PII order references; do not keep a hidden lookup to deleted buyer details.',
    ],
    sections: [
      { heading: 'Classification and processing records', paragraphs: [
        'Classify information as public, internal, confidential, or restricted. Amazon buyer names, addresses, phone numbers, and other identifying details are restricted PII. Credentials are restricted secrets. Access to restricted data requires an authorized purpose and appropriate controls.',
        'Maintain processing records covering source, fields, purpose, storage, authorized access, third-party recipients, retention trigger, disposal, and owner. Obtain Amazon Information directly through authorized SP-API workflows. Record sharing with Australia Post for requested fulfilment and hosting/security processors where they actually handle information.',
      ] },
      { heading: 'Retention and generic order identity', paragraphs: [
        'Delete or irreversibly remove Amazon buyer PII no later than 30 days after delivery. Retain only necessary non-PII order and financial history with a documented purpose. Use the generic display name Amazon Customer after disposal.',
        'An Amazon order reference can remain for operational reconciliation and locating the original order in authorized Seller Central, subject to its classification and justified retention. It must not be a reversible pseudonym or local lookup that preserves deleted buyer PII. Replacing a name alone does not remove an address or other identifying information.',
        'Use verified delivery evidence to determine the deadline. Missing delivery evidence must be flagged and resolved through a documented conservative retention process, not an indefinite extension. Encrypting PII does not replace the requirement to dispose of it.',
        'For split shipments, retain per-parcel original-delivery evidence and flag the order for review from its earliest verified original delivery. Later parcels and late polling do not restart earlier copies\' retention windows. Review shared identifying information and outstanding fulfilment needs before approving irreversible disposal; collecting evidence does not itself remove PII.',
      ] },
      { heading: 'Copies, restoration, and privacy requests', paragraphs: [
        'Disposal must cover orders, shipment recipient snapshots, generated labels and documents, exports, caches, test artifacts, and unnecessary diagnostic data. Prevent later provider synchronization from reintroducing expired PII.',
        'Define backup expiry and restricted restoration handling. Reapply disposal rules before restored information becomes accessible. Keep disposal evidence free of buyer PII and verify completion.',
        'Handle privacy requests through an authenticated account-owner process. Keep public notices accurate about operating controls and service providers. Do not claim automated disposal is operating until the process has been implemented and tested.',
      ] },
    ],
  },
  {
    id: 'logging-monitoring',
    title: 'Security Logging and Monitoring',
    version: '1.1',
    reviewCadence: 'Security log review at least every 14 days',
    roles: ['policyOwner', 'logReviewer', 'incidentLead'],
    summary: [
      'Keep security audit logs for at least 12 months in access-restricted, alteration-protected storage.',
      'Review logs at least every 14 days and investigate suspicious activity promptly.',
      'Runtime Issues supplies operational signals; it is not a substitute for security audit logging.',
    ],
    sections: [
      { heading: 'Events and protection', paragraphs: [
        'Record sign-in successes and failures, lockouts, MFA events, access changes, privileged business-context changes, PII access and exports, key operations, security configuration changes, approvals, and deployments. Capture actor, timestamp, action, outcome, and safe reference without raw buyer data or secret values.',
        'Retain security logs for a minimum of 12 months. Restrict read access, protect logs against unauthorized modification and deletion, and monitor logging and archive failures. An application history view with a shorter retention period does not replace the security archive.',
        'Reuse the existing platform authentication activity store for successful and failed sign-ins, lockouts, required password renewal, MFA failures/enrollment/recovery/remembered-browser use, password reset requests and password changes. Keep these events for at least 12 calendar months; do not silently purge them after 90 days or allow account deletion to cascade into retained audit entries. Database write guards reject audit-entry edits and deletion inside the retention window. This does not recover activity already deleted under an earlier retention setting.',
        'The platform authentication trail is not a complete audit of every PII access, export, key operation, provider event or deployment. Review and retain the corresponding hosting, source-control, key-service and other restricted logs separately. Do not certify complete security-event coverage or immutable external archives merely because application authentication logging is enabled.',
      ] },
      { heading: 'Review and alerting', paragraphs: [
        'The log reviewer must complete and record a review at least every 14 days, including review period, findings, investigator, follow-up actions, and evidence. Track overdue reviews and escalate them to the policy owner.',
        'Record completed reviews in Security & Compliance with the reviewed UTC period, safe findings/action summary and restricted evidence reference. The signed-in approver, current policy fingerprint and saved responsibility revision are recorded automatically. Backdated coverage does not extend the review deadline. Records are append-only; correct mistakes with an additional entry. Due dates are displayed, but review work and reminder emails are not performed automatically.',
        'Configure alerts for repeated failed sign-ins, unusual privileged access, unexpected access changes, suspicious exports, key misuse, and endpoint security events. Respond promptly rather than waiting for the next scheduled review.',
      ] },
      { heading: 'Investigation and operational issues', paragraphs: [
        'Link suspicious activity to a restricted incident record and follow the incident-response policy. Preserve evidence with minimal personal information.',
        'Review Admin Runtime Issues for application and integration failures that may reveal security symptoms. Do not claim operational exception records alone detect unauthorized access or establish compliant audit retention.',
      ] },
    ],
  },
  {
    id: 'change-management',
    title: 'Change Management and Secure Development',
    version: '1.0',
    reviewCadence: 'Every production change; annual policy review',
    roles: ['policyOwner', 'changeOwner', 'changeApprover'],
    summary: [
      'Record impact, test results, rollback instructions, and approval for production changes.',
      'Require independent review and passing release checks; restrict merge and deployment access.',
      'Track and retest vulnerabilities: critical within seven days, high within 30 days.',
    ],
    sections: [
      { heading: 'Preparing and approving changes', paragraphs: [
        'The implementer records purpose, affected systems, security and privacy impact, tests, migration requirements, and rollback plan. Use synthetic test data and protect tenant boundaries.',
        'The approver independently reviews the change and its test evidence before release. The author cannot act as their own independent approver. Current role-name defaults may identify the same person; appoint a distinct authorized reviewer before claiming independent approval.',
        'Restrict who may approve, merge, deploy, or alter production settings. Require passing automated tests, appropriate type and lint checks, and a verified build. Record provider configuration changes as well as source changes.',
      ] },
      { heading: 'Release and emergency changes', paragraphs: [
        'Record the approved commit or configuration revision, reviewer, tests, deployment time, and post-release verification. For changes affecting money, stock, or PII, verify the intended effect without unauthorized live writes.',
        'Emergency changes must record the reason, authorization, risk, validation, and rollback actions, followed by independent retrospective review as soon as practicable. Emergency access does not waive security incident reporting.',
      ] },
      { heading: 'Vulnerability management', paragraphs: [
        'Perform vulnerability scans monthly and penetration testing and formal third-party security assessments annually. Assign findings an owner, severity, deadline, remediation plan, and verification evidence.',
        'Resolve critical vulnerabilities within seven days and high-risk vulnerabilities within 30 days of discovery. Review progress weekly, escalate overdue findings, and verify fixes with targeted tests or rescans before closure. Treat evidence of exploitation or information exposure as an incident.',
      ] },
    ],
  },
  {
    id: 'devices-testing',
    title: 'Developer Devices, Test Data and Recovery',
    version: '1.0',
    reviewCadence: 'Quarterly device inventory and recovery tests; annual training',
    roles: ['policyOwner', 'deviceOwner', 'accessOwner', 'incidentLead'],
    summary: [
      'Use approved encrypted devices, MFA, current security updates, and endpoint protection.',
      'Use synthetic or Amazon sandbox data in development; do not copy buyer PII to personal devices or USB storage.',
      'Test recovery quarterly and complete security-awareness training annually.',
    ],
    sections: [
      { heading: 'Approved devices and network access', paragraphs: [
        'Maintain an approved device inventory and review it quarterly. Require full-disk encryption, unique device credentials, automatic screen lock, supported software, timely updates, and endpoint anti-malware protection. Update anti-malware tools at least monthly.',
        'Restrict production access to approved devices and individually identified accounts with MFA. Prohibit personal phones and unapproved devices for production customer information. Configure device-compliance and removable-storage controls and alerts; a written prohibition alone is not technical prevention.',
        'Keep databases and file services private where possible, restrict network exposure and administrative access, and verify Cloudflare and hosting protections. Do not assume the provider name proves firewall, IDS/IPS, or endpoint coverage.',
      ] },
      { heading: 'Testing and support investigations', paragraphs: [
        'Use synthetic or Amazon sandbox fixtures. Do not copy production buyer PII into development databases, screenshots, test output, logs, or support examples. Never put credentials in test artifacts.',
        'If a specific support investigation requires production information, record authorization, purpose, scope, and time limit. Use approved restricted systems and delete any necessary temporary extract when the task ends. Handle accidental exposure through incident response.',
      ] },
      { heading: 'Recovery and training', paragraphs: [
        'Test backup and recovery procedures quarterly, including restoration access restrictions and disposal of expired PII before restored data is exposed. Retain test evidence and corrective actions.',
        'Complete and record security-awareness training annually for approved users. Report lost devices, malware detections, suspicious sign-ins, or suspected information leakage promptly to the incident lead.',
      ] },
    ],
  },
];

export function createDefaultPolicyAssignments(): PolicyAssignments {
  return {
    policyOwner: DEFAULT_POLICY_RESPONSIBLE_PERSON,
    incidentLead: DEFAULT_POLICY_RESPONSIBLE_PERSON,
    incidentBackup: DEFAULT_POLICY_RESPONSIBLE_PERSON,
    amazonNotificationOwner: DEFAULT_POLICY_RESPONSIBLE_PERSON,
    accessOwner: DEFAULT_POLICY_RESPONSIBLE_PERSON,
    privacyOwner: DEFAULT_POLICY_RESPONSIBLE_PERSON,
    keyCustodian: DEFAULT_POLICY_RESPONSIBLE_PERSON,
    logReviewer: DEFAULT_POLICY_RESPONSIBLE_PERSON,
    changeOwner: DEFAULT_POLICY_RESPONSIBLE_PERSON,
    changeApprover: DEFAULT_POLICY_RESPONSIBLE_PERSON,
    deviceOwner: DEFAULT_POLICY_RESPONSIBLE_PERSON,
  };
}

export class PolicyAssignmentValidationError extends Error {}

export function validatePolicyAssignments(value: unknown): PolicyAssignments {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new PolicyAssignmentValidationError('Provide all policy responsibility fields.');
  }
  const values: Record<string, unknown> = value as Record<string, unknown>;
  if (Object.keys(values).some(key => !POLICY_ROLES.some(role => role.id === key))) {
    throw new PolicyAssignmentValidationError('Unknown policy responsibility field.');
  }
  const assignments = createDefaultPolicyAssignments();
  for (const role of POLICY_ROLES) {
    const name = values[role.id];
    if (typeof name !== 'string' || !name.trim() || name.trim().length > 120 || /[\u0000-\u001f\u007f]/.test(name)) {
      throw new PolicyAssignmentValidationError(`${role.label} must be text of 1 to 120 characters without control characters.`);
    }
    assignments[role.id] = name.trim();
  }
  return assignments;
}

export interface PolicyAssignmentState {
  assignments: PolicyAssignments;
  revision: number;
  updatedAt: string | null;
  updatedBy: number | null;
}
