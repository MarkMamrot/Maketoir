---
name: solvantis-lead-finder
description: 'Find Australian retail leads for Solvantis from a street, shopping centre, suburb, or city. Use when researching retailer directories, Google or Maps results, public business contact details, and importing approved Cold leads into Solvantis CRM.'
argument-hint: 'Starting place and optional retailer categories or exclusions'
user-invocable: true
---

# Solvantis Lead Finder

Research each location adaptively, show evidence in chat, and import only explicitly approved retailers.

## Safety and scope

- Limit the workflow to Australian retailers and public business contact details.
- Do not collect personal mobile numbers, private email addresses, credentials, gated content, or raw page payloads.
- Prefer official shopping-centre directories and retailer websites for durable evidence.
- Google Maps/Places, Serper, Tavily, and Playwright are optional research methods. Choose only what the case needs and follow provider terms.
- Never write to a tenant other than the exact `Solvantis` business.
- Never import before the user approves the displayed candidates and then approves commit after dry-run.

## Procedure

1. Confirm the starting street, centre, suburb, or city and ask about category exclusions only when unclear.
2. Create a stable batch ID such as `<place-slug>-YYYY-MM-DD`.
3. Find the authoritative centre or precinct directory. Enumerate retailers before enriching them.
4. For each retailer, verify the official website and gather public business email, phone, and postal address where available. A candidate needs its name plus at least one of email, phone, official website, or postal address.
5. Keep the exact URL supporting each candidate. Mark confidence between 0 and 1 only when useful; do not present inference as verified fact.
6. Deduplicate candidates by normalized email, phone, official website domain, then business name and address.
7. Present a concise chat table containing selection number, retailer, useful channels/address, source links, confidence, and notes. Ask which rows to approve.
8. Build JSON matching [the approved lead schema](./assets/approved-leads.schema.json). Candidate keys must remain stable when retrying the same batch.
9. Pipe only approved rows to `npm run leads:preflight`. Do not use a durable staging file unless the user requests one.
10. Summarize `create`, `existing`, `ambiguous`, and `error` results. Existing contacts receive source evidence only; they are not overwritten or reclassified. Ambiguous rows must remain uncommitted.
11. Ask for explicit approval of the final non-ambiguous set.
12. Pipe that set to `npm run leads:commit`. Report created contact IDs, evidence-only matches, ambiguities, and errors.

New contacts are created as `lead` with `cold` qualification. Replaying the same batch and candidate keys must not duplicate contacts or evidence.