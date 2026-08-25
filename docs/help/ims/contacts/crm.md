---
{"id":"ims-contacts-crm","title":"Contacts and CRM","audiences":["ims"],"capability":"navigation","screen":"Contacts","product":"ims","format":"overview","parentId":"ims-contacts","contexts":["contacts","contact-profile"],"contextSections":{"contacts":"Choose the right contact area","contact-profile":"Customer profiles"},"relatedTopics":["ims-crm-workflows","ims-customer-orders"],"order":40,"summary":"Maintain contact details and use CRM profiles without replacing source transactions.","lastReviewed":"2026-08-25","owner":"customer"}
---
# Contacts and CRM

Contacts holds maintained customer, supplier, and lead details. CRM adds relationship work and a combined view of customer activity.

## Main operations

- Search before creating a contact so one person or company is not duplicated.
- Maintain names, contact details, company details, and contact type in Contacts.
- Let Display Name use Company when supplied, otherwise First Name and Last Name, or replace it with a preferred display name.
- Keep essential conversation context in **Before every interaction** at the top of each CRM profile.
- Open a customer profile to review activity and follow its source links.
- Use CRM tasks, segments, and pipeline for follow-up and sales development.

## Choose the right contact area

| Need | Use | What happens |
|---|---|---|
| Add or correct contact details | **Contacts** | The maintained contact record changes |
| Review purchases, credits, loyalty, or follow-ups | **CRM > Contacts** | A combined profile and timeline opens |
| Organise follow-up work | **CRM > Tasks** | Tasks can be assigned, completed, or cancelled |
| Group customers from current data | **CRM > Segments** | Membership recalculates when viewed or refreshed |
| Track a possible sale | **CRM > Pipeline** | The opportunity moves through open, won, or lost stages |

When adding a contact, **Display Name** fills from Company first. If Company is blank, it uses First Name and Last Name. You can type a different display name; clearing that override resumes the automatic value. Select **Save** to create the contact. After saving a lead or retail customer, Contacts switches to that contact type so the new record is visible. The form closes without saving only when you choose **Cancel** or press Escape.

## Customer profiles

A profile combines contact details with supported POS sales, Sales Orders, credit notes, store-credit activity, loyalty activity, interactions, and tasks. Filters change what is shown; they do not change the source records.

The **Before every interaction** note stays at the top of the profile so staff see it before reviewing activity or starting a conversation. Use **Edit**, record only durable context that should guide every interaction, then select **Save**. Examples include a preferred contact time, communication preference, accessibility requirement, or a standing instruction that must be confirmed. Clearing and saving removes the note. Advisor accounts can read the note but cannot change it.

Use a dated CRM interaction for what happened in one call, meeting, or message. Do not turn the interaction brief into a running activity log.

| Information | Where it comes from | Where to correct it |
|---|---|---|
| Name, company, email, phone, address, contact type | Contact record | **Contacts** |
| POS purchase or return | Completed POS transaction | POS return or linked customer credit note workflow |
| Customer order and fulfilment | Sales Order | The linked Sales Order |
| Return or customer credit | Customer credit note and its balance activity | The linked Customer Credit Note |
| Loyalty points | Loyalty activity | The supported loyalty or return workflow |
| Call, meeting, note, or other contact | Manual CRM interaction | The customer profile |
| Standing context to remember before every contact | **Before every interaction** note | The customer profile |
| Follow-up commitment | CRM task | The task queue or customer profile |
| Potential sale and forecast value | CRM opportunity | The Pipeline |

> **Note:** CRM summaries bring information together. Correct a sale, order, return, credit, or loyalty event at its source so every view stays consistent.

## Troubleshooting

| Symptom | Likely cause | What to do |
|---|---|---|
| A customer appears twice | Separate contacts were created | Check both records and use the supported data-quality merge action if appropriate |
| Profile activity looks incomplete | A category or date filter is active | Clear filters, then open the source workspace |
| A balance cannot be typed over | It changes through transactions | Open the relevant credit, return, payment, or loyalty activity |
| A supplier has no retail CRM history | CRM activity is limited to eligible customer and lead types | Confirm the contact type before changing it |

## Worked examples

### Correct a customer's email

Open **Contacts**, search for the customer, edit the maintained email address, and save. Do not add a CRM interaction as a substitute for correcting the contact.

### Investigate store credit

Open the customer profile and review the store-credit activity. Follow the linked credit note or payment source when available, then use that workflow for any correction rather than entering a replacement balance.
