---
{"id":"setup-connections","title":"Connections and Setup","audiences":["ims"],"capability":"integrations","screen":"Setup > Connections","product":"setup","contexts":["setup","connections","business","profile","appearance","pos","data-source","team","shopify","xero","cin7","meta","google","klaviyo"],"contextSections":{"connections":"Connections","business":"Business information","profile":"Brand profile","appearance":"Appearance","pos":"POS setup","data-source":"Data source","team":"Team","shopify":"Shopify","xero":"Xero","cin7":"Cin7","meta":"Meta","google":"Google","klaviyo":"Klaviyo"},"order":1,"summary":"Connect supported services, test access, and recover expired or incomplete connections.","lastReviewed":"2026-08-23","owner":"integrations"}
---
# Connections and Setup

Setup establishes the business and supported external connections used by Solvantis. Connection controls can contain sensitive values; never paste credentials into Help or Ask Solvantis.

## Main operations

- Enter connection details only in the labelled protected fields.
- Use OAuth connection flows where offered and confirm the intended external organisation or account.
- Test or sync after saving to verify access.
- Reconnect when authorization expires or required scopes change.
- Review dependent mappings and automation settings after a connection succeeds.

## Connections

Connections contains the supported external services for the selected business. Confirm the business selector before saving or testing a connection.

## Business information

Business information stores the maintained identity and operating context used by reports, generated content, and supported workflows. Keep customer-facing facts current and avoid placing secrets in descriptive fields.

## Brand profile

Brand Profile captures reviewed brand context used by AI-assisted work. Review generated or imported statements before treating them as current business facts.

## Appearance

Appearance controls supported workspace presentation preferences. It does not change transaction, stock, accounting, or access behavior.

## POS setup

POS setup configures supported register and retail settings. Confirm the intended location and role before changing operational controls.

## Data source

Data Source controls supported reporting inputs. Changing a source can affect freshness and comparability; verify a successful sync before relying on derived reports.

## Team

Team manages customer-facing user access for the selected business. Assign the least privilege needed and use supported invitation, role, MFA, and removal workflows.

## Shopify

Connect the intended Shopify store with the required access. After connection, configure and verify product, customer, order, inventory, and webhook workflows from IMS. Large catalogues can synchronize in bounded batches.

1. Sign in to Shopify Admin and open **Settings > Apps and sales channels > Develop apps**.
2. Allow custom app development if required, create an app, and configure its Admin API scopes.
3. Enable the product, order, inventory, and customer read access required by the displayed workflow, plus customer write access when customer synchronization is enabled.
4. Save the scopes, install the app, and enter the resulting Admin API access token only in the protected **Access Token** field.
5. Enter the Shop ID using the store hostname shown by Shopify, save, and test the connection.

[Open Shopify custom-app guidance](https://help.shopify.com/en/manual/apps/app-types/custom-apps)

## Xero

Connect the intended Xero organisation, then configure document policy, account mappings, tracking, and payment routing in IMS. Connection alone does not make every workflow ready to post.

## Cin7

Connect the intended Cin7 account and test access before relying on product, stock, or purchasing synchronization. Review source ownership so Solvantis and Cin7 do not compete to update the same fact.

1. Sign in to Cin7 Omni and open **Settings > Integrations > API**.
2. Note the account ID shown for the intended Cin7 account.
3. Generate or select an API key with the access required by the enabled synchronization.
4. Enter the account ID and API key only in their protected Setup fields, save, and test the connection.

[Open Cin7 Omni](https://go.cin7.com/)

## Meta

Connect the intended Meta account and grant the scopes required by enabled analysis or guarded execution features. Existing read-only connections may require reconnection when write-capable features are deliberately enabled.

1. Confirm your Facebook profile has access to the intended ad account in Meta Business Settings.
2. Select **Connect Meta Ads** in Solvantis and sign in to Meta.
3. Review and approve the permissions displayed by Meta.
4. When more than one ad account is returned, select the account belonging to the active Solvantis business.
5. Return to Setup and confirm the displayed account and connection status.

[Open Meta Business Settings](https://business.facebook.com/settings/ad-accounts)

## Google

Connect the intended Google services and advertising account. Confirm account identity before syncing or reviewing recommendations.

## Klaviyo

Connect the intended Klaviyo account for supported marketing data and workflows. Test access and review audience or campaign boundaries before relying on imported context.

## Troubleshooting

- Confirm the external account/organisation selected during OAuth.
- Reconnect after expired authorization or newly required scopes.
- A successful connection can still require product-specific mappings or policy before posting/sync is ready.
- Do not expose access tokens, secrets, passwords, recovery codes, or authorization details in support messages.

## Worked examples

### Connect Xero for POS accounting

Complete the Xero connection, open IMS Xero Setup, configure the POS revenue mapping and each required location/payment clearing mapping, then perform and review a controlled EOD sync.

### Recover an expired Shopify connection

Reconnect the same intended store, verify the displayed identity and webhook status, then run the supported bounded sync. Review results before starting another overlapping sync.