---
{"id":"setup-connections","title":"Connections and Setup","audiences":["ims"],"capability":"integrations","screen":"Setup > Connections","product":"setup","format":"overview","contexts":["setup","connections","pos","shopify","xero","cin7","meta","google","klaviyo"],"contextSections":{"setup":"Choose a Setup area","connections":"Connection readiness","pos":"POS setup","shopify":"Connection readiness","xero":"Connection readiness","cin7":"Connection readiness","meta":"Connection readiness","google":"Connection readiness","klaviyo":"Connection readiness"},"relatedTopics":["setup-business-brand-appearance","setup-team-access-security","setup-integration-readiness-troubleshooting"],"order":1,"summary":"Choose the right Setup area and understand when a connection is ready for real work.","lastReviewed":"2026-08-23","owner":"integrations"}
---
# Connections and Setup

Use Setup to maintain business information, team access, POS payment options, data sources, and supported external connections.

## Main operations

- Confirm the selected business before saving anything.
- Connect the intended external account and check its displayed identity.
- Test access, then complete the product-specific mappings or settings.
- Add only the POS payment methods the business accepts.
- Reconnect expired access before repeating dependent work.

## Choose a Setup area

| Need | Open | Result |
| --- | --- | --- |
| Update business facts, brand details, or interface appearance | Business, Brand Profile, or Appearance | Reviewed information or a saved visual preference |
| Invite a colleague or choose a role | Team | An invitation for User or Admin access |
| Add or rename POS payment options | POS Settings | Payment methods shown at checkout |
| Choose where product, stock, and sales information comes from | Data Source | Selected inventory source |
| Connect Shopify, Xero, Cin7, Meta, Google, or Klaviyo | Connections | Saved connection and displayed status |

> **Warning:** Enter passwords, access details, and recovery codes only in the protected fields intended for them. Never place them in Help, Ask Solvantis, notes, or support messages.

## Connection readiness

| Connection | Purpose | Connected means | Still check before real work |
| --- | --- | --- | --- |
| Shopify | Product, order, customer, and stock workflows | The intended store can be reached | Product mapping, stock ownership, webhooks, and sync result |
| Xero | Supported accounting workflows | The intended organisation is authorised | Accounts, tax, tracking, payment routing, and workflow policy |
| Cin7 | Product, stock, sales, and purchasing information | The intended account can be reached | Data Source selection, ownership, and first sync result |
| Meta | Advertising information and supported actions | The intended advertising account is selected | Permissions, live campaign state, and any action preview |
| Google | Google Ads and Analytics information | The intended Ads account and Analytics property are selected | Both status results, dates, and downstream settings |
| Klaviyo | Supported marketing information and workflows | Access test succeeds | Audience, consent, campaign, and flow choices |

A green or successful connection status confirms access at that moment. It does not prove every dependent workflow is mapped, configured, or ready to post.

## POS setup

POS Settings controls the payment-method names shown on the POS payment screen.

1. Review the current list.
2. Add, rename, or remove a method.
3. Select **Save Methods**.
4. Open POS and confirm the expected choices before taking a sale.

| Change | Effect | External change |
| --- | --- | --- |
| Save payment methods | Updates payment choices shown in POS | No external service is changed |

## Safe connection sequence

1. Select the intended business.
2. Start the connection or enter details only in its protected fields.
3. Confirm the external organisation, store, account, or property.
4. Save and use the available status or test action.
5. Complete downstream mappings and settings in the owning product area.
6. Run one controlled sync or test and review its result.

## Troubleshooting

| Symptom | Likely cause | Safe action |
| --- | --- | --- |
| Connected to the wrong account | The wrong organisation or account was selected during sign-in | Disconnect and reconnect the intended account |
| Connected but a workflow is unavailable | Required mapping, permission, or product setup is incomplete | Open Integration Readiness and complete the shown dependency |
| Access expired | The external service no longer accepts the saved authorisation | Reconnect through the normal connection flow |
| A test fails twice | Account access or setup still needs attention | Stop retries and read the specific status or error |

## Worked examples

### Prepare Xero for POS accounting

Connect the intended Xero organisation, confirm its name, then open IMS Xero Setup to complete the required revenue and payment mappings. Run one controlled end-of-day sync and review the Xero result before relying on automation.

### Add a POS payment method

Open POS Settings, add "Afterpay", save the list, and open POS to confirm it appears. This changes the available POS label; it does not create or configure an Afterpay account.