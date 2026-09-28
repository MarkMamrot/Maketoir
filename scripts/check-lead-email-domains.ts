import { resolveMx } from 'node:dns/promises';

import { classifyMxRecords, normalizeLeadDomain } from '../src/lib/ims/leadContactEnrichment';

async function readStdin() {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  const text = Buffer.concat(chunks).toString('utf8').trim();
  if (!text) throw new Error('Provide JSON with a domains array on stdin.');
  return JSON.parse(text) as { domains?: unknown[] };
}

async function main() {
  const input = await readStdin();
  if (!Array.isArray(input.domains) || input.domains.length === 0 || input.domains.length > 250) {
    throw new Error('Provide between 1 and 250 domains.');
  }
  const domains = [...new Set(input.domains.map(normalizeLeadDomain).filter((domain): domain is string => Boolean(domain)))];
  if (!domains.length) throw new Error('No valid domains were provided.');
  const results = [];
  for (const domain of domains) {
    try {
      const records = await resolveMx(domain);
      results.push({
        domain,
        verificationStatus: classifyMxRecords(records),
        mailExchangers: records.sort((left, right) => left.priority - right.priority).map(record => record.exchange).filter(Boolean),
      });
    } catch (error: any) {
      if (error?.code === 'ENODATA' || error?.code === 'ENOTFOUND') {
        results.push({ domain, verificationStatus: 'domain_no_mail', mailExchangers: [] });
      } else {
        results.push({ domain, verificationStatus: 'not_checked', mailExchangers: [], error: 'DNS lookup failed.' });
      }
    }
  }
  console.log(JSON.stringify({ results }, null, 2));
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});