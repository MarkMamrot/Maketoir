---
{"id":"ims-contacts-crm","title":"Contacts and CRM","audiences":["ims"],"capability":"navigation","screen":"Contacts","product":"ims","parentId":"ims-contacts","contexts":["contacts","crm","contact-profile"],"contextSections":{"contacts":"Contacts","crm":"CRM workspace","contact-profile":"Customer profiles"},"order":40,"summary":"Maintain commercial contacts and coordinate customer relationships without overwriting transaction-owned records.","lastReviewed":"2026-08-23","owner":"customer"}
---
# Contacts and CRM

## Main operations

- Search for an existing contact before creating a customer, supplier, or lead.
- Maintain identity, company, contact, and applicable commercial details on the owning contact.
- Use CRM profiles, interactions, tasks, tags, segments, pipeline stages, and opportunities for relationship work.
- Treat POS, orders, credits, loyalty, and store-credit records as authoritative transaction history.

## Contacts

Contacts contains customers, suppliers, leads, and related commercial details. Confirm the intended contact type and company relationship before saving. Generic contact edits must not overwrite balances owned by a ledger or transaction workflow.

## CRM workspace

CRM combines derived activity with manually recorded relationship work. Use tasks for follow-up, interactions for relevant notes, tags and live segments for grouping, and pipeline stages or opportunities for active commercial work. Keep notes factual and appropriate for shared business records.

## Customer profiles

A profile brings together maintained details and supported activity history. Use source links to inspect an order, sale, credit, loyalty entry, or store-credit transaction. Correct the source transaction through its owning workflow rather than rewriting the CRM summary.

## Troubleshooting

- If history appears incomplete, check date filters and the source workspace before adding a duplicate manual interaction.
- If a balance cannot be edited, use the owning credit, loyalty, payment, or return workflow.
- If a segment membership looks unexpected, inspect its live criteria and current contact values.

## Worked examples

### Follow up a wholesale lead

Find or create the contact with the correct company relationship, record the relevant interaction, create a dated task, and place the opportunity in the appropriate stage. Update each item as the conversation progresses.

### Investigate customer store credit

Open the customer profile and follow the store-credit history to its source transactions. Use the linked credit-note or payment workflow for corrections; do not type a replacement balance into the contact.