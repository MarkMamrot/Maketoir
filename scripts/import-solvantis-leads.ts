import 'dotenv/config';

import { runImsForBusiness } from '../src/lib/db/BusinessRegistry';
import {
  importApprovedLeadCandidate,
  LeadDiscoveryValidationError,
  preflightLeadCandidate,
  SOLVANTIS_LEAD_BUSINESS_ID,
  type ApprovedLeadCandidate,
} from '../src/lib/ims/leadDiscoveryService';
import { reportRuntimeIssue } from '../src/lib/runtimeIssues';
import { getIMSPool } from '../src/services/IMSMySQLService';

const commit = process.argv.includes('--commit');
const confirmation = process.argv.find(argument => argument.startsWith('--confirm='))?.slice('--confirm='.length);
if (commit && confirmation !== 'IMPORT-SOLVANTIS-LEADS') {
  throw new Error('Commit mode requires --confirm=IMPORT-SOLVANTIS-LEADS.');
}

async function readStdin() {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  const text = Buffer.concat(chunks).toString('utf8').trim();
  if (!text) throw new LeadDiscoveryValidationError('Provide the approved lead payload as JSON on stdin.');
  return JSON.parse(text) as { candidates?: ApprovedLeadCandidate[] };
}

async function main() {
  const payload = await readStdin();
  if (!Array.isArray(payload.candidates) || payload.candidates.length === 0) {
    throw new LeadDiscoveryValidationError('The payload must contain at least one candidate.');
  }
  if (payload.candidates.length > 250) throw new LeadDiscoveryValidationError('A batch cannot exceed 250 candidates.');

  await runImsForBusiness(SOLVANTIS_LEAD_BUSINESS_ID, async () => {
    const results: unknown[] = [];
    if (!commit) {
      const connection = await getIMSPool().getConnection();
      try {
        for (const candidate of payload.candidates!) {
          try {
            results.push(await preflightLeadCandidate(connection, candidate));
          } catch (error) {
            if (!(error instanceof LeadDiscoveryValidationError)) throw error;
            results.push({ outcome: 'error', candidateKey: candidate?.candidateKey ?? null, error: error.message });
          }
        }
      } finally {
        connection.release();
      }
    } else {
      for (const candidate of payload.candidates) {
        try {
          results.push(await importApprovedLeadCandidate(candidate));
        } catch (error) {
          if (!(error instanceof LeadDiscoveryValidationError)) {
            await reportRuntimeIssue({
              businessId: SOLVANTIS_LEAD_BUSINESS_ID,
              source: 'ims_crm',
              operation: 'import_discovered_lead',
              title: 'Approved lead import failed',
              error,
              context: { batchId: candidate?.batchId, candidateKey: candidate?.candidateKey },
              reference: { type: 'lead_search_batch', id: candidate?.batchId },
            });
          }
          results.push({ outcome: 'error', candidateKey: candidate?.candidateKey ?? null, error: error instanceof Error ? error.message : 'Import failed.' });
        }
      }
    }
    console.log(JSON.stringify({ mode: commit ? 'commit' : 'dry-run', businessId: SOLVANTIS_LEAD_BUSINESS_ID, results }, null, 2));
  });
}

main().catch(async error => {
  if (!(error instanceof LeadDiscoveryValidationError) && !(error instanceof SyntaxError)) {
    await reportRuntimeIssue({
      businessId: SOLVANTIS_LEAD_BUSINESS_ID,
      source: 'ims_crm',
      operation: 'import_discovered_leads',
      title: 'Lead import command failed',
      error,
    });
  }
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});