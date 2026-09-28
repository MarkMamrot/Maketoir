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
- Research owners, founders, directors, managers, and buyers only from public professional sources. Do not collect personal mobile numbers, private email addresses, credentials, gated content, or raw page payloads.
- Prefer official shopping-centre directories and retailer websites for durable evidence.
- Google Maps/Places, Serper, Tavily, and Playwright are optional research methods. Choose only what the case needs and follow provider terms.
- A published address needs the exact public source URL. An inferred address is a hypothesis, never a verified fact or the lead's primary email.
- An MX record proves only that the domain accepts mail. It does not prove that a mailbox exists. Do not use SMTP recipient probing or send test messages. Mark `provider_valid` only from an approved verification provider response.
- Never write to a tenant other than the exact `Solvantis` business.
- Never import before the user approves the displayed candidates and then approves commit after dry-run.

## Procedure

1. Confirm the starting street, centre, suburb, or city and ask about category exclusions only when unclear.
2. Create a stable batch ID such as `<place-slug>-YYYY-MM-DD`.
3. Find the authoritative centre or precinct directory. Enumerate retailers before enriching them.
4. For each retailer, verify the official website and gather public business email, phone, and postal address where available. A candidate needs its name plus at least one of email, phone, official website, or postal address.
5. Build a basic payload and run `npm run leads:preflight` before time-consuming contact enrichment. Report `existing` and `ambiguous` matches; never create a duplicate to work around an ambiguous result.
6. Research decision-makers using official About, Team, Contact, franchise, and media pages first, then public business registries and public professional/company profiles. Keep the source URL that identifies each person's business role.
7. Search each identified person's name with the brand, role, and official domain. Store an email or phone as `published` only when a public source displays it.
8. When no published email exists, optionally generate a small set of hypotheses from the public name and official domain: `first.last`, `firstlast`, `flast`, `f.last`, and `first`. Generic `info`, `hello`, `contact`, `sales`, and `admin` mailboxes may be business-level hypotheses. Do not infer addresses on personal or unrelated domains.
9. Pipe official domains to `npm run leads:check-domains`. An MX result may set `domain_accepts_mail`; no mail route may set `domain_no_mail`. Keep individual mailboxes unverified. A reputable verification API may set `provider_valid`, `provider_invalid`, or `provider_unknown`; preserve catch-all/unknown results and never turn them into valid claims.
10. Keep the exact URL supporting each published fact. Mark confidence only when useful; do not present inference as verified fact.
11. Deduplicate candidates by normalized email, phone, official website domain, then business name and address. Deduplicate people and contact hypotheses within each candidate.
12. Present a concise chat table containing selection number, retailer, CRM match, public business channels/address, decision-maker and role, contact evidence status, source links, and notes. Keep inferred addresses visually separate. Ask which rows and hypotheses to retain.
13. Build JSON matching [the approved lead schema](./assets/approved-leads.schema.json). Candidate and person keys must remain stable when retrying the same batch.
14. Pipe only approved rows to `npm run leads:preflight`. Do not use a durable staging file unless the user requests one.
15. Summarize `create`, `existing`, `ambiguous`, and `error` results. Existing contacts receive source evidence and approved enrichment only; their maintained fields and qualification are not overwritten. Ambiguous rows must remain uncommitted.
16. Ask for explicit approval of the final non-ambiguous set.
17. Pipe that set to `npm run leads:commit`. Report created contact IDs, evidence-only matches, decision-makers, published contacts, retained hypotheses, ambiguities, and errors.

New contacts are created as `lead` with `cold` qualification. Published business email may populate the ordinary lead email only when supplied as the candidate's `email`. Inferred addresses belong only in `businessContacts` or a person's `contacts`. Replaying the same batch and stable keys must not duplicate contacts or evidence.