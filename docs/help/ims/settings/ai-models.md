---
{"id":"ims-settings-ai-models","title":"AI Model Settings","audiences":["ims"],"capability":"navigation","screen":"IMS Settings > AI Models","product":"ims","format":"task","parentId":"ims-settings-business-operations-pos","contexts":["ims-settings-ai-models","ai-models"],"contextSections":{"ims-settings-ai-models":"Step-by-step","ai-models":"Choose models by function"},"relatedTopics":["ims-settings-account-ai-credits","ims-purchase-orders","foresight-business-intelligence","foresight-content-production-customer-service"],"order":3,"summary":"Choose the Gemini text model used for document extraction, catalogue matching, business intelligence, and customer service work.","lastReviewed":"2026-08-30","owner":"ims"}
---
# AI Model Settings

Use AI Models to choose the Gemini text model used for different types of Solvantis work.

## Main operations

- Choose a capable model for invoice and customer-order document extraction.
- Choose a faster model for catalogue matching when exact codes do most of the work.
- Set the model used for business intelligence, analysis, and content assistance.
- Set the fallback model used by customer service AI.
- Review model availability and save changes for future requests.

## At a glance

| Function | Typical work | Recommended starting point | Main trade-off |
| --- | --- | --- | --- |
| Document extraction | Supplier invoices and customer order documents | Gemini 2.5 Pro | Better handling of difficult scans and tables, with higher latency and cost |
| Catalogue matching | Match extracted lines to products | Gemini 2.5 Flash | Faster and lower cost for code and name matching |
| Business intelligence and content | Analysis, audits, estimates, schemas, and business AI requests | Gemini 2.5 Flash | Increase capability when the work needs deeper reasoning |
| Customer service | Enquiry classification and assisted replies | Gemini 2.5 Flash | Dedicated Customer Service choices can override this fallback |

## Before you begin

- Confirm the intended business is selected.
- Consider accuracy, response time, and usage cost for each function.
- Keep human review in place for financial documents and customer-facing text.
- Confirm a model remains available in the displayed list before changing a working configuration.
- Review **Account & AI Credits** to understand the current available AI usage value before choosing a higher-cost model.

> **Important:** A more capable model can reduce difficult extraction errors, but it does not guarantee correct quantities, prices, tax, discounts, freight, product matches, or customer-facing statements.

## Step-by-step

1. Open **IMS Settings**.
2. Select **AI Models**.
3. Review the current model for each function.
4. Choose a model from the available list.
5. Select **Save AI Models**.
6. Run a representative document or AI task.
7. Review the result before saving an order, changing stock, or sending customer-facing content.

## Choose models by function

Use **Document extraction** for the first pass that reads invoice and customer-order PDFs or images. Pro is the recommended default because dense tables, low-quality scans, backorders, tax, freight, and discount layouts require stronger document reasoning.

Use **Catalogue matching** for the later pass that maps extracted lines to existing SKUs, barcodes, and product names. Flash is the recommended default because exact identifiers handle much of this work. Low-confidence matches still require review.

Use **Business intelligence and content** for brand analysis, campaign audits, marketing missions, estimates, schemas, and general business AI requests.

Use **Customer service** as the general fallback for customer enquiry and reply work. Customer Service also has dedicated light-classification and capable-reply choices in its own Settings area. Those dedicated choices remain authoritative where shown.

Website content and Product Creative retain their own model controls. Changing this page does not replace those dedicated selections.

Different models can have different input, output, image, and video prices. A model change can therefore alter how quickly prepaid credit or an account limit is consumed, even when staff run the same number of tasks.

## Troubleshooting

| Symptom | Likely cause | Safe action |
| --- | --- | --- |
| A saved model is no longer listed | Google has renamed, retired, or restricted the model | Choose a current model from the list and save again |
| Invoice lines or totals are wrong | The document is difficult or the extraction model misread its layout | Correct the draft, try Document extraction with a more capable model, and verify totals before saving |
| Product matches are uncertain | Codes are absent or catalogue descriptions differ | Review low-confidence lines manually; do not create or select a product based only on the suggestion |
| Responses are slow | The selected model prioritises capability over speed | Use Flash for lower-risk work where its output is consistently adequate |
| Saving fails twice | Model availability or settings storage is unavailable | Stop retrying and keep the current configuration until the displayed error is resolved |

## Worked examples

### Improve a difficult invoice import

A multi-page supplier invoice contains small type, freight discounts, and a separate backorder table. Keep **Document extraction** on Gemini 2.5 Pro and **Catalogue matching** on Gemini 2.5 Flash. Upload the invoice, compare every supplied quantity and line total with the source, exclude backorders, and confirm the invoice total before saving the purchase order.

### Reduce latency for routine matching

Most supplier invoices are clean PDFs with exact IMS SKUs. Keep extraction on Pro for the financial reading step and matching on Flash. Review unmatched and low-confidence rows manually; existing saved orders are not changed when the model setting changes.