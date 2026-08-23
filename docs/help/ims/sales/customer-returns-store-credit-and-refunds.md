---
{"id":"ims-customer-returns-refunds","title":"Customer Returns, Store Credit, and Refunds","audiences":["ims"],"capability":"orders","screen":"Sales > Customer Credit Notes","product":"ims","format":"task","parentId":"ims-customer-orders","relatedTopics":["ims-sales-orders-fulfilment","ims-online-shop"],"contexts":["credit-notes"],"contextSections":{"credit-notes":"Step-by-step"},"order":33,"summary":"Record customer returns once, restore sellable stock correctly, and return value through store credit, the original native payment, or the source channel.","lastReviewed":"2026-08-23","owner":"sales"}
---
# Customer Returns, Store Credit, and Refunds

Use the credit note linked to the original sale to keep returned goods and customer value together without counting either twice.

## Main operations

- Create a manual IMS credit note for an in-person or account return handled in IMS.
- Review POS-created return records without entering the stock return again.
- Refund a native online order to its original mix of store credit and card payment.
- Mark goods as awaiting product when value should not be completed yet.
- Reverse a mistaken completed manual credit note through its offered action.

## At a glance

| Return source | Where staff start | Linked credit note | What adds stock back once | How customer value is returned | What must not be repeated |
|---|---|---|---|---|---|
| Manual IMS return | Sales Order **Return / Credit**, or **Customer Credit Notes** | A Manual Draft credit note | Completing the credit note, for lines with **Restock** selected | Completed manual notes issue customer store credit | Do not also make a positive stock adjustment or edit the customer's balance |
| POS return or exchange | The original sale in POS | POS creates and completes an internal credit note | The linked credit note for returned lines | The register's selected store-credit or refund outcome | Do not restock the POS sale and the credit note separately |
| Native online return | The native Sales Order **Return / Credit** action | A linked credit note with **Original payment refund** | The linked credit note after payment settlement succeeds | Original store credit is restored first; any remainder goes back through Stripe | Do not issue a separate manual store credit, card refund, or stock adjustment |
| Shopify return | Shopify's refund workflow | An externally settled Shopify credit note appears in IMS | The imported credit note when Shopify marks the line for restock | Shopify returns the customer value | Do not refund or restock the same line again in IMS |

## Before you begin

- [ ] Find the original sale or Sales Order and confirm how much was fulfilled and not already returned.
- [ ] Confirm the customer, return location, products, quantities, prices, and tax treatment.
- [ ] Select **Restock** only for goods that are physically returned and sellable.
- [ ] For goods not yet received, keep the note Draft or mark it **Awaiting Product**.
- [ ] For a native refund, confirm the original payment connection is available before completion.

> **Warning:** Complete one linked credit note for the return. Do not also adjust stock, add store credit manually, or send another payment refund for the same goods.

## Step-by-step

### Complete a manual IMS return

1. Open the original Sales Order and choose **Return / Credit**, or open **Sales > Customer Credit Notes** and select **New Credit Note**.
2. Confirm the customer, original order reference, location, returned items, quantities, and values.
3. Leave **Restock** selected only for sellable goods physically received. Clear it for damaged goods or a value-only credit.
4. Create the Draft. If goods are still coming back, choose **Mark Awaiting Product** and complete it after arrival.
5. Choose **Complete** when all details are correct. The credit note adds selected goods back once and issues the customer store credit.

### Review a POS return

1. Start the return from the original sale in POS and complete the register prompts.
2. In IMS, open **Customer Credit Notes**, change **Record Type** to **POS Returns / Exchanges**, and find the POS-linked note.
3. Review its items, settlement, and original sale reference. The returned lines have already been handled by this credit note.
4. Do not create a second credit note or stock adjustment.

### Refund a native mixed payment

1. Open the native online Sales Order and choose **Return / Credit**.
2. Review the returned lines and keep **Original payment refund** as the settlement.
3. Complete the credit note. Solvantis first sends any card portion back through Stripe.
4. After that succeeds, the same completion restores the original store-credit portion, applies the selected restock lines, and completes the note.
5. Review the completed note before communicating the final breakdown to the customer.

### Recover from a failed native refund

1. Read the displayed refund error and check the original payment connection or payment status.
2. Leave the same linked credit note in place. A failed payment refund does not complete its stock return or restore customer value.
3. Fix the payment issue, then retry completion on that same note.
4. Confirm the note is Complete before making any separate correction.

## Troubleshooting

| Symptom | Likely reason | What to do |
|---|---|---|
| Complete is unavailable | The note is cancelled, already complete, or read-only | Review status and available actions |
| Return quantity is rejected | It exceeds the fulfilled quantity still available to return | Check earlier linked returns and reduce the quantity |
| Stock did not return | **Restock** was cleared, the item was not linked to a stock variant, or completion failed | Review the line and note status before correcting anything |
| Native refund failed | Stripe could not verify or settle the original card payment | Fix the shown issue and retry the same credit note |
| Xero failed after a manual return completed | The operational return succeeded but accounting did not | Retry the note's Xero action; do not repeat the return |

## Worked examples

### Manual IMS return for store credit

The customer returns 2 tops at $55 each, $110 including GST. Both are sellable, so **Restock** stays selected. Completing the Manual credit note adds 2 tops to that location and increases the customer's store credit by $110. No separate stock or customer-balance entry is needed.

### POS exchange

A customer returns 2 keyrings at $13.95 each and buys two planters totalling $30.90. POS records the exchange and creates a linked credit note for the 2 returned keyrings. That note adds the keyrings back; the new planter lines reduce stock through the POS sale. Do not add the keyrings again in IMS.

### Native mixed-payment refund

A $120 native order was paid with $35 store credit and $85 by card. A $70 return restores $35 to store credit first and refunds the remaining $35 through Stripe. If the credit note has one sellable returned unit selected for restock, that unit returns only after the payment refund succeeds.

### Failed native refund

A $48 card refund fails because the original payment cannot be verified. The linked credit note remains unfinished, stock is not added back, and no customer value is restored. After the payment issue is fixed, retry the same note; do not create another $48 refund.