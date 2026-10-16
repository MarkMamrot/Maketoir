---
{"id":"ims-settings-navigation","title":"Finding and Saving Settings","audiences":["ims"],"capability":"navigation","screen":"IMS Settings","product":"ims","format":"overview","parentId":"ims-workspaces","relatedTopics":["ims-business-operations-pos-settings","ims-settings-ai-models","ims-settings-account-ai-credits","ims-loyalty-customer-rewards","ims-shipping-settings","ims-sales-channels","setup-connections","setup-integration-readiness-troubleshooting"],"contexts":["settings-business-profile","settings-general","settings-tax","settings-users","settings-advisor-access","settings-products","settings-locations","settings-online-pick","settings-builds","settings-inventory-costing","settings-initial-import","settings-purchase-orders","settings-purchase-pdf","settings-purchase-payments","settings-currencies","settings-sales-orders","settings-sales-pdf","settings-sales-payments","settings-payment-discounts","settings-shipping","settings-loyalty","settings-loyalty-rewards","settings-loyalty-portal","settings-wholesale","settings-wholesale-branding","settings-wholesale-notifications","settings-wholesale-preview","settings-sales-channels","settings-pos-payments","settings-pos-layby","settings-pos-display","settings-pos-receipts","settings-pos-access","settings-pos-terminals","settings-connections","settings-xero","settings-connection-cin7","settings-sync","settings-connection-google","settings-connection-meta","settings-connection-klaviyo","settings-connection-gmail","settings-shopify","settings-ai-models","settings-ai-account"],"contextSections":{"settings-business-profile":"Business and team","settings-general":"Business and team","settings-tax":"Business and team","settings-users":"Business and team","settings-advisor-access":"Business and team","settings-products":"Inventory and locations","settings-locations":"Inventory and locations","settings-online-pick":"Inventory and locations","settings-builds":"Inventory and locations","settings-inventory-costing":"Inventory and locations","settings-initial-import":"Inventory and locations","settings-purchase-orders":"Purchasing and sales documents","settings-purchase-pdf":"Purchasing and sales documents","settings-purchase-payments":"Purchasing and sales documents","settings-currencies":"Purchasing and sales documents","settings-sales-orders":"Purchasing and sales documents","settings-sales-pdf":"Purchasing and sales documents","settings-sales-payments":"Purchasing and sales documents","settings-payment-discounts":"Purchasing and sales documents","settings-shipping":"Sales and customers","settings-loyalty":"Sales and customers","settings-loyalty-rewards":"Sales and customers","settings-loyalty-portal":"Sales and customers","settings-wholesale":"Sales and customers","settings-wholesale-branding":"Sales and customers","settings-wholesale-notifications":"Sales and customers","settings-wholesale-preview":"Sales and customers","settings-sales-channels":"Sales and customers","settings-pos-payments":"Point of Sale","settings-pos-layby":"Point of Sale","settings-pos-display":"Point of Sale","settings-pos-receipts":"Point of Sale","settings-pos-access":"Point of Sale","settings-pos-terminals":"Point of Sale","settings-connections":"Enable an integration before connecting","settings-xero":"Enable an integration before connecting","settings-connection-cin7":"Enable an integration before connecting","settings-sync":"Enable an integration before connecting","settings-connection-google":"Enable an integration before connecting","settings-connection-meta":"Enable an integration before connecting","settings-connection-klaviyo":"Enable an integration before connecting","settings-connection-gmail":"Enable an integration before connecting","settings-shopify":"Online stores have their own configuration","settings-ai-models":"AI and account","settings-ai-account":"AI and account"},"order":1,"summary":"Navigate the grouped settings menu, save or cancel drafts, and enable integrations before entering connection details.","lastReviewed":"2026-10-15","owner":"setup","quickSections":["Main operations","Settings groups"],"navigation":{"category":"settings","label":"Find and save settings"}}
---
# Finding and Saving Settings

Settings opens over the IMS workspace for the selected business. Expand a group, then select a page. The header shows the current page and its group; Help opens guidance for that page. On a narrow screen, use **Settings navigation** to open the menu.

The menu uses flat rows like the IMS sidebar. The selected page has a highlighted background and a coloured left edge.

## Main operations

- Check the business name before changing anything.
- Expand the relevant group instead of searching a flat list.
- Change values, then use that form's **Save** action. Use **Cancel** to restore saved values.
- If a warning appears when leaving an edited page, choose **Keep editing** or explicitly **Discard changes**.
- Treat connection tests, authorisation, disconnect, imports, repairs and other operational actions separately from saving configuration.
- Review warnings before actions that affect stock, costing, accounting or existing connections.

## Settings groups

| Group | What belongs here |
|---|---|
| Business & Team | Business profile, operational capabilities, tax labels and rates, users, Advisor permissions and bookkeeping email |
| Inventory & Locations | Product fields, default location, online picking priority, build policies, inventory costing and opening stock imports |
| Purchasing | Purchase order email and PDF settings, purchase payment methods and foreign currencies |
| Sales & Customers | Sales order email and PDF settings, sales payment methods, early-payment discounts, shipping, loyalty, wholesale and sales-channel availability |
| Point of Sale | Registers, payment types and opening float, layby cancellation fees, product display, receipts, access rules and card terminals |
| Integrations | Integration overview and individual provider connections; Cin7 connection and import controls are separate pages |
| AI & Account | AI model choices, account and AI credits |

Technical repair, reset, API and cache-maintenance tools are in **Advanced**, which is available only to SuperAdmins.

## Business and team

Use **Business profile** for identity, addresses and the document logo. **Business operations** controls the workflows the business uses, while **Tax rates & labels** owns tax defaults. Prices remain tax-inclusive.

**Users** manages business access. **Advisor permissions** controls selected inventory and accounting actions separately from POS rules. **Bookkeeping email** maintains shared accounting recipients.

## Inventory and locations

**Product fields** controls optional catalogue fields and opening-stock inputs. **Location defaults** chooses the default warehouse. **Online picking priority** owns the existing business-wide location order; per-store routing remains with its sales channel.

**Build policies** appears only while Builds is enabled. Business and location policies control reviewed build offers; they do not build silently.

**Inventory costing** uses a controlled prospective switch rather than an ordinary settings save. **Opening stock imports** remains an operational workflow: review its warnings and scope before applying an import.

## Purchasing and sales documents

Purchase and sales documents each have separate **Email template** and **PDF** pages. Saving one does not save the other's fields.

Payment methods are separate pages for purchasing and sales. **Foreign currencies** belongs to Purchasing. **Early-payment discounts** remains shared across the supported supplier, customer and order workflows.

## Sales and customers

Use **Shipping** for carrier accounts, package presets and delivery tracking. Shipping configuration does not itself dispatch or poll an order.

Under **Loyalty**, use **Program & earning**, **Rewards**, and **Customer portal** for their separate tasks. Unavailable future loyalty options are not shown; removing those placeholders does not change earning or redemption.

Under **Wholesale portal**, use **Catalogue & ordering**, **Branding**, **Notifications**, and **Staff preview**. The preview links to its existing workspace instead of duplicating it.

## Point of Sale

**Registers** manages tills at each location; location identity stays in Locations.

In **Payment types & float**, add or remove names in the draft, then select **Save payment types**. Opening float has its own save and cancel actions.

**Layby cancellation fees** remains branch-specific and does not rewrite existing layby terms. **Product display** chooses the business fallback; location overrides still take precedence.

**Receipts & gift receipts** owns receipt text and the receipt logo. **POS access rules** owns the supported POS permission choices. **Card terminals** saves each register's configuration separately; saving one terminal does not save another terminal's draft.

## Enable an integration before connecting

1. Open **Integrations > Overview** and review the required service.
2. Open that provider's page and turn on **Use this integration**.
3. For Xero, the toggle saves immediately and connection setup appears when saving succeeds. For other providers, select **Save availability** first.
4. Enter connection details or authorise the external account.
5. Save the details, then deliberately test access and review downstream policy.

Enabled means the integration is allowed to run. Configuration saved means connection details exist. Neither status by itself proves current access or downstream readiness.

Saved secrets are not prefilled. Leave a saved secret blank to retain it. Cancel restores the saved configuration without contacting the provider.

Turning a provider off pauses new dependent activity and hides its credential form. Saved configuration and history remain available for re-enabling. Disconnect is a separate action that removes the relevant authorisation. Existing configured integrations are retained when these controls are introduced.

Klaviyo's customer and commerce master switch and individual source selections remain separate from provider availability. Turning Gmail off does not stop unrelated transactional or bookkeeping email. Xero mappings and accounting policies remain in Finances.

## Online stores have their own configuration

Shopify and the native online store retain their existing channel availability and activation controls. Configure the exact store in **Sales > Sales Channels**, or use the native Online Shop workspace. Integration settings provides a link rather than a second credential form.

Do not treat provider enablement as storefront activation. Existing order, payment, webhook and stock ownership rules still apply.

## AI and account

Choose per-function AI models in **AI & Account > AI models**. Account and credit management is a separate page. Connections no longer duplicates the model editor.

## Worked examples

To prepare Cin7 without starting an import, open **Integrations > Cin7 Omni > Connection**, enable it and save availability. Enter the account ID and API key, save, then test access. Review **Sync & import** separately before starting any import. Turning Cin7 off later retains the configuration and imported history while pausing new dependent work.
