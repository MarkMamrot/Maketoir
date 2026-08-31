---
{"id":"pos-customers","title":"Customers at POS","audiences":["pos","ims"],"capability":"pos","screen":"POS > Customer","product":"pos","format":"task","parentId":"pos-workspaces","relatedTopics":["pos-selling-payments-manager-approval","pos-loyalty-rewards","pos-store-credit"],"contexts":["customer-search"],"contextSections":{"customer-search":"Step-by-step"},"order":12,"summary":"Find, create, reactivate, link, or remove the correct customer from a POS sale.","lastReviewed":"2026-08-31","owner":"retail"}
---
# Customers at POS

Link the correct customer before using account-bound value or recording customer details against a sale.

## Main operations

- Search active customers by name, phone number, or email address.
- Show and reactivate an inactive matching customer.
- Create and link a customer who does not already exist.
- Record loyalty enrolment only with the customer's agreement.
- Remove an incorrectly linked customer before checkout.

## At a glance

| Need | POS action | Connection required? |
|---|---|---|
| Find an active customer | Enter at least two characters in **Customer** | Yes |
| Include inactive matches | Choose **Show** when inactive matches are reported | Yes |
| Create a customer | Choose **New**, then **Create & link** | Yes |
| Use loyalty or store credit | Link the named customer first | Yes |
| Remove the customer | Choose the remove button beside the linked name | No new lookup until another customer is needed |

## Before you begin

- [ ] Confirm the customer has provided enough detail to identify the correct record.
- [ ] Ask before enrolling a new customer in loyalty.
- [ ] Check that POS is online before searching or creating.
- [ ] Avoid creating a second record for a customer who may be inactive.

> **Important:** Loyalty enrolment is separate from marketing consent. Select the loyalty option only after the customer agrees to join under the terms shown in POS.

## Step-by-step

1. Open **Customer** above the cart.
2. Enter at least two characters from the customer's name, phone number, or email address.
3. Select the matching active customer to link them to the sale.
4. If POS reports inactive matches, choose **Show** and select the correct customer marked **Inactive**. POS reactivates and links that existing record, preserving its details and customer value.
5. If no record exists, choose **New**.
6. Enter the first name and at least an email address or phone number. The last name is optional.
7. Select loyalty enrolment only when the customer agrees, then choose **Create & link**.
8. Confirm the linked name and any displayed store-credit or loyalty details before charging.
9. If the wrong person was selected, remove them and search again before taking payment.

## Troubleshooting

| Symptom | Likely cause | What to do |
|---|---|---|
| No matches appear | The search is too short, the details differ, or the customer is inactive | Enter at least two accurate characters and choose **Show** for inactive matches |
| **New** is unavailable | POS is offline | Reconnect before creating the customer |
| Creation reports an existing email or phone | An active or inactive record already owns that detail | Search for that detail and link or reactivate the existing record |
| Loyalty details do not load | Customer services cannot be reached | Check the connection and retry; the sale can continue without a reward |
| Store Credit is missing at payment | The customer is not linked or has no available balance | Reopen **Customer** and verify the correct linked account and balance |

## Worked examples

### Reactivate instead of duplicating

Jordan's phone number finds no active customer, but POS reports one inactive match. Staff choose **Show**, confirm Jordan's existing details, and select the inactive record. POS reactivates and links it, keeping Jordan's existing loyalty and store-credit history.
