# Klaviyo OAuth App Setup

Klaviyo uses OAuth 2.0 authorization-code flow with mandatory S256 PKCE. Retailers select Connect Klaviyo, sign in at Klaviyo, and approve access. They do not enter private API keys.

## Platform Configuration

1. Create the Solvantis OAuth app at https://www.klaviyo.com/manage-apps using an owner, admin, or manager Klaviyo account.
2. Register the exact callback URL `${APP_URL}/api/klaviyo/oauth/callback` for each deployed environment. `APP_URL` must be the canonical public application origin, not an arbitrary incoming host.
3. Grant only these scopes: `campaigns:read flows:read lists:read metrics:read profiles:read profiles:write events:write`.
4. Configure `KLAVIYO_CLIENT_ID` and `KLAVIYO_CLIENT_SECRET` in the server environment. Never enter secrets into Help, chat, source control, or browser-visible configuration. Existing server encryption configuration must be available.
5. Plan the additive main-table migration with `node scripts/setup-klaviyo-oauth.mjs`; after approval, run the same command with `--apply`. No tenant migration or setting activation is performed by this script.
6. Restart the application, enable Klaviyo for the intended sandbox business, and select Connect Klaviyo. Authorizing does not enable customer or commerce sync.

The app does not need a Marketplace listing to use its installation URL; Klaviyo app creation/configuration is still required. See https://developers.klaviyo.com/en/docs/set_up_oauth.

## Verification

- Confirm authorization cancellation leaves the existing connection intact.
- Confirm callback state rejects a different actor/business, an expired request, and missing/mismatched state.
- Confirm customer credentials never appear in browser responses or logs.
- Confirm a saved OAuth connection supports Test Connection and marketing reads, and worker profile/event writes once separately activated.
- Confirm expiring tokens refresh under the business credential lock and failed refreshes require reconnection.
- Confirm both integration availability and source switches save immediately and failed saves retain the confirmed value.
- Confirm Disconnect revokes the refresh token, clears local OAuth and legacy credentials, and disables customer/commerce sync without deleting profiles or history.

Existing private-key connections remain a compatibility path for runtime callers, but keys are no longer requested by the settings UI. A failed OAuth refresh must not silently fall back to an old key.