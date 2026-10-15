---
{"id":"ims-settings-advanced","title":"Advanced Settings Tools","audiences":["ims"],"capability":"navigation","screen":"IMS Settings > Advanced","product":"ims","format":"overview","parentId":"ims-settings-navigation","relatedTopics":["ims-settings-navigation","setup-runtime-issues"],"contexts":["settings-utilities","settings-data-reset","settings-api-tools","settings-sales-cache"],"contextSections":{"settings-utilities":"Data repair","settings-data-reset":"Data reset","settings-api-tools":"API tools and diagnostics","settings-sales-cache":"Sales cache maintenance"},"requiredTier":"SuperAdmin","order":99,"summary":"Locate SuperAdmin repair, reset, API and cache tools without mixing them with everyday configuration.","lastReviewed":"2026-10-15","owner":"setup","quickSections":["Main operations"],"navigation":{"category":"platform","label":"Use advanced settings tools"}}
---
# Advanced Settings Tools

Advanced appears only for SuperAdmins. These tools are operational actions, not ordinary preference edits.

## Main operations

- Check the intended business and review the operation's scope before running a tool.
- Read any confirmation or warning; opening a page does not approve a repair or reset.
- Use ordinary settings and integration pages for configuration.
- Keep diagnostic details and connection secrets out of customer-facing messages.

## Data repair

Existing one-off data repair tools are grouped here. Review the stated source and records affected before starting an operation.

## Data reset

The existing reset workflow remains separate from opening-stock imports. Review its checks and confirmation carefully; cancelling an ordinary settings draft does not undo a completed reset.

## API tools and diagnostics

API instruction and schema generation are technical maintenance actions. They are no longer mixed into ordinary provider connection forms. Saved provider configuration remains with its owning integration or store.

## Sales cache maintenance

Use the existing maintenance workflow when the reported sales view needs its calculated information rebuilt. This is separate from editing a provider's availability.

## Worked examples

A staff member connecting Meta uses **Integrations > Meta Ads**. A SuperAdmin generating technical API instructions uses **Advanced > API tools & diagnostics** instead. Neither task requires deleting or replacing the business's saved connection configuration.
