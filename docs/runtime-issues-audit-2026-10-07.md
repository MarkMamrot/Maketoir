# Runtime Issues audit - 2026-10-07

Private engineering audit, not product Help. Registry snapshot: 184 issues, 127 New and 57 Fixed. Each ID is accounted for below. No stock, sales, customer value, provider credentials, accounting mappings or integration activation was changed. The registry contains historical administrative and age-based closures; those are not evidence of reconciled business data.

Registry follow-up: added evidence-based notes/events to 19 records. Closed 11 verified historical causes (1175, 1353, 1599, 1614, 1656, 1660, 1714, 1202, 1689, 872, 873). Kept the five new code repairs and three browser/navigation records In progress (586, 820, 1798, 1908, 1950, 19, 1846, 1952). Readback: 108 New, eight In progress, 68 Fixed. Existing notes were appended, not erased; no user was impersonated as the event actor.

## Latest registry action - 8 October

The user explicitly requested closure of 19 and 1846 and all issues relating to businesses other than Monsterthreads. The retained business is the exact production business named **Monsterthreads**; **Monsterthreads DEV SANDBOX** is a separate business and was included in the administrative closure. Unassigned/System issues were not included.

Closed 40 previously open records in one transaction, preserving existing resolution notes and assignments and adding one status_changed event per issue with no impersonated actor:

| Business | Newly closed | Issue IDs |
| --- | --- | --- |
| Monsterthreads | 2 | 19, 1846 |
| Monsterthreads DEV SANDBOX | 25 | 800, 1294, 1480, 1486, 1487, 1490, 1492, 1493, 1513, 1514, 1515, 1590, 1592, 1837, 1839, 1893, 1896, 1900, 1908, 1911, 1912, 1914, 1949, 1950, 1951 |
| Sage | 13 | 815, 816, 817, 819, 820, 851, 855, 934, 935, 1093, 1167, 1733, 1734 |

Solvantis had no open issues. These are user-requested administrative closures, not certification of repaired accounting, stock, customer value or external documents. The navigation notes explicitly retain the undeployed-fix and unknown-original-trigger caveats. A later matching occurrence can reopen a closed issue.

Independent readback: **74 New, three In progress, 108 Fixed** across 185 records. Monsterthreads has **69 New, two In progress, 46 Fixed**; all other named businesses have only Fixed records. System/unassigned remains five New, one In progress and ten Fixed. All 40 new closure events were verified by their unique closure reasons, not a calendar-date assumption: database-generated timestamps currently show a different date from the session date. No business data, mapping, provider permission, financial document, gift-card balance or loyalty ledger was changed.

### Monsterthreads accounting and customer-value decisions

This is a summary of recorded evidence, not fresh Xero/Shopify reconciliation. Review the actual source records before approving a correction.

| Area | Production issues | Review or approval needed |
| --- | --- | --- |
| Xero bill approval | 1443, 1712 | 1443's saved validation payload is truncated; inspect the existing bill before deciding whether mapping, tax, tracking or document state needs correction. 1712 explicitly rejects reauthorisation because payments or credits are allocated. Bookkeeper approval is required before any financial amendment; do not repost or force approval. |
| Paid daily invoice | 1737 | Recorded conflict attempts to increase an already paid invoice from $507.45 to $535.39. Its companion batch-marker correction is already covered, but matched invoice/refund/credit-note outcomes must be checked before any amendment. Avoid counting a manually netted invoice and separate refunds twice. |
| Batch readiness and operator permissions | 1098, 1729; 1711, 1728, 1730, 1732 | Closed-business-day and Advisor read-only guards are intentional. Check whether the now-completed dates were subsequently posted, using an authorised operator. No permission bypass or duplicate daily invoice. |
| Gift-card history access | 595, 796 | Merchant-approved read_gift_card_transactions permission and app reauthorisation are needed before full transaction reconciliation. Existing unexplained balance differences must not be overwritten without event evidence. |
| Gift-card void and issuance | 945, 1658 | 945 blocks a Shopify-linked gift-card sale void until replacement-card history can be safely reversed. 1658's provider issuance rejected a code shorter than eight characters. Verify issued cards, balances and original sales; approve any replacement or compensation before changing customer value. |
| Refunds and loyalty outcomes | 153, 154, 1417, 1927 | Historical refund/points reversal and later reward-reservation failures need ledger/outcome checks despite current source corrections. 1417 recorded no positive refund amount; do not invent a refund or credit. Approve only proven missing or incorrect customer-value entries. |
| Loyalty account access | 805, 892, 1665, 1757 | Current source covers the recorded schema/collation causes, but verify affected customer access and summaries. No point adjustment is implied by an access failure. |
| Customer and loyalty provider writes | 1090, 1122 | Customer export requires merchant-approved write_customers access; loyalty metafield writes also lacked owner-resource access, with a recent October recurrence. Reauthorise only with merchant approval, then retry affected syncs without adding duplicate value. |

The inventory/stock-adjustment mapping issue 1294, rejected inventory-account bills 1911/1949/1951, unsupported-currency bills 1912/1914 and stale invoice link 1893/1900 belong to **Dev Sandbox**, not Monsterthreads production. They are now administratively closed and are excluded from production correction proposals.

## Interpretation

### PO-907413 foreign-payment follow-up - 8 October

- User supplied the Xero payment screen showing USD 3,000 converted to AUD 3,000 at a one-to-one rate. Read-only Monsterthreads payment lookup confirms local payment 3, dated 11 September, saved AUD-per-USD rate 1.402100 and AUD amount 4,206.3000. Its stored Xero payment ID matches the reported transaction.
- Local payment 2, dated 15 May, is also posted: USD 3,086, rate 1.391789, saved AUD amount 4,295.0609. Its actual Xero conversion has not been checked. Review both linked transactions; do not infer that the first is correct merely because its posting succeeded.
- Root cause: syncOrderPayment hard-coded CurrencyRate: 1 and both payment hooks omitted the saved exchange_rate. Prepared correction forwards the payment-specific rate and uses its reciprocal for Xero, preserves invoice-currency Amount, and blocks invalid/missing foreign rates or non-AUD organisation/account routing. Both PO and ordinary SO payment paths share the correction.
- Replay protection remains in place. No payment was reposted, reversed, deleted, amended or unlinked, and no existing accounting-action record was cleared. Existing successful foreign-payment actions must be reconciled explicitly; changing the request rate is not permission to replay them.
- Correction is local and undeployed. The incorrectly posted payment requires bookkeeper-approved Xero correction plus coordinated Solvantis posting-link reconciliation, not an automatic second payment. The paid-bill reauthorisation issue 1712 is separate and was not changed by this FX fix.

#### User-authorised retry reset after Xero deletion

The user subsequently confirmed deleting both Xero payments for PO-907413 and requested that the existing Solvantis payments become postable again. Live Xero GETs independently verified both linked PaymentIDs as DELETED on the correct bill. The bill was AUTHORISED in USD with 6,086 due and zero paid.

Reset only local payments 2 and 3 and their po-payment:2804:2 / po-payment:2804:3 accounting actions in one cross-schema transaction under resolved Monsterthreads tenant context. Local intent remains post_to_xero, posting status is pending, and old payment IDs/errors/posting timestamps are cleared. Accounting actions are pending with corrected FX request fingerprints and cleared old Xero IDs/completion timestamps; attempt counts are preserved. Original USD amounts, AUD equivalents, dates, rates and payment methods are unchanged.

Two skipped/DELETED sync-history entries preserve the old provider IDs, old/new request fingerprints and explicit user-authorised reset reason. Independent readback confirmed both local rows and actions are pending and both audit entries exist. No new payment was posted, no bill was amended, and no provider financial write was performed. Repost manually only after the FX fix is deployed; older request payloads do not match the prepared fingerprints. Expected recorded AUD amounts remain 4,295.06 and 4,206.30.

- **Prepared**: changed and tested locally; deployment and live acceptance remain required.
- **Code covered**: the current implementation addresses the recorded cause; affected business data has not necessarily been reconciled.
- **Verified cause resolved**: a read-only current-schema check disproves the exact recorded missing-object or query failure.
- **Decision**: a stock, accounting, customer-value, provider-permission or activation decision is required before correction.
- **Unverified**: historical evidence does not establish current reproduction or resolution; do not close by age.
- **Retained closure**: already Fixed, with no later recorded recurrence. Prior closure retained, not freshly certified as operationally reconciled.

## Safe repairs prepared

| ID | Repair | Verification |
| --- | --- | --- |
| 586 | Stable Daybook template insertion order; at most three attempts for a deadlock on its idempotent insert | Three route tests: recovery, exhausted retries, unrelated failure |
| 820 | Open Online Sales no longer depends on legacy item name/code columns; adjacent day-detail query uses canonical catalogue joins and both retain legacy saved labels when present | Five route tests and read-only EXPLAIN in all four registered tenants |
| 1798 | Invalid login JSON, non-object bodies and non-string credentials return validation errors before authentication | Seven route tests; no user lookup or Runtime Issue report |
| 1908 | Typed incoming-allocation protection returns a conflict, not an operational failure; protection is unchanged | Existing PO route suite, 18 tests |
| 1950 | Malformed backorder JSON returns a validation error before order, stock or Xero work | Seven backorder tests including existing FIFO conflict coverage |

The existing payout-forwarding test passes for 1952; no additional payout-permission change was made.

## Open-record review

| ID | Assessment | Evidence and next action |
| --- | --- | --- |
| 19 | Requested closure | Closed on 8 October at the user's explicit instruction. The recorded router-initialization stack is reproducible with a cleared initialParallelRoutes map; global recovery now reloads the current address. Original trigger remains unconfirmed and the fix is undeployed; closure is administrative, not production certification. |
| 138 | Unverified | Historical Gemini URL timeout; no proof of current provider failure or successful retry for the affected operation. |
| 153 | Code covered | Loyalty identity joins now use binary comparisons. Historical refund/points reconciliation still requires review. |
| 154 | Code covered | Companion refund-webhook collation incident; code correction alone does not prove refund processing completed. |
| 168 | Decision | Fingerprint reopened after an earlier variant unlink; the latest context lists different variants. Do not reuse the old unlink resolution or clear mappings in bulk. |
| 368 | Decision | Insufficient-stock fingerprint reopened for another fulfilment. Earlier repaired order does not prove the latest order is reconciled. |
| 586 | Prepared | Daybook deadlock recurred on 6 October despite its old resolution note; narrow retry/order repair above. |
| 594 | Decision | Incoming-stock fulfilment warning; verify physical receipt and resulting location balances rather than replaying fulfilment. |
| 595 | Decision | Missing Shopify gift-card transaction-history scope; merchant permission and reconciliation required. |
| 796 | Decision | Same permission failure at the scope-check level; no automatic permission or gift-card mutation. |
| 800 | Decision | Sandbox gift-card redemption currency mismatch; verify both card balances and currencies before compensation. |
| 805 | Code covered | Current loyalty repository no longer references contact deleted_at. Validate the customer summary without changing points. |
| 807 | Code covered | fetchSettings is defined inside the current settings hook. No recent recurrence; source coverage is not browser acceptance. |
| 812 | Unverified | Rewards server-render digest alone cannot identify the original server exception; obtain correlated server evidence. |
| 815 | Decision | Sage inventory queue is still absent. Sage Shopify is deliberately paused; a schema rollout/activation decision is required. |
| 816 | Decision | No matching Shopify location for opening stock; do not guess a source location or import quantities. |
| 817 | Decision | Invalid opening-stock preview; obtain a fresh reviewed preview before any stock import. |
| 819 | Code covered | Old business-level webhook pathway was retired; Sage remains paused. Historical failed imports are not thereby reconciled. |
| 820 | Prepared | Reproduced missing legacy fields in Sage metadata; repaired canonical query compiles in all four tenants. Five tests cover open/day details and preserve saved labels for legacy unlinked items. |
| 824 | Code covered | Retired undefined capability-hook symbol is absent from current source. Browser acceptance remains distinct. |
| 846 | Code covered | Current capability/channel architecture replaces legacy shopify_enabled paths; do not add a legacy flag casually. |
| 851 | Code covered | Sage counterpart of 846; no activation change. |
| 855 | Code covered | Sage legacy payout capability query; exact-instance architecture now controls runtime access. |
| 856 | Code covered | Monsterthreads counterpart of 855. |
| 871 | Code covered | Historical Google account-rate import is no longer the commercial pricing control plane. No live rate changes made. |
| 872 | Code covered | User-businesses route explicitly declares force-dynamic; build verification required. |
| 873 | Code covered | User-me route explicitly declares force-dynamic; build verification required. |
| 882 | Code covered | Obsolete Google rate-preview path, replaced by curated commercial pricing; historical audit tooling is not treated as runtime activation. |
| 886 | Code covered | Same retired pricing workflow; no Google billing configuration changed. |
| 889 | Code covered | Historical duplicate-rate import; no existing price/history rows overwritten. |
| 892 | Code covered | Current loyalty/contact code uses canonical active checks; verify customer sign-in separately. |
| 915 | Unverified | POS browser-cache failure lacks the original storage cause. Do not clear offline browser data to test it. |
| 917 | Code covered | Current text-model resolution addresses stale model choices; plan entitlement and the affected content job remain separate checks. |
| 918 | Code covered | Same stale-model/plan-denial family; no plan, margin or customer charge changed. |
| 934 | Unverified | Sage browser-cache counterpart of 915; device-specific storage evidence required. |
| 935 | Decision | Sage fulfilment shortfalls remain operational evidence; paused integration does not reconcile stock or orders. |
| 945 | Decision | Shopify-linked gift-card void is intentionally blocked; do not bypass the customer-value safeguard. |
| 968 | Unverified | Historical undefined currency symbol needs the original component/source mapping or authenticated reproduction. |
| 998 | Unverified | Public assistant model denial; current pricing architecture differs, but no successful matching public conversation was verified. |
| 1014 | Unverified | Historical prepared-statement argument failure; existing tests are not a production SQL execution for this exact list. |
| 1090 | Decision | Shopify customer-write permission failure; obtain merchant approval before reconnecting or retrying customer exports. |
| 1093 | Code covered | Retired Sage legacy refund path; missing legacy ownership schema and historic refunds remain rollout/reconciliation decisions. |
| 1098 | Decision | Correct completed-business-day protection; do not remove it. Check whether the closed day was later posted. |
| 1122 | Decision | Customer-metafield write permission failure recurred on 6 October; current provider-access issue. |
| 1149 | Unverified | Isolated Shopify HTTP 500; no proof that the affected inventory batch was later delivered. |
| 1167 | Decision | Zero-value Shopify refund observation; do not fabricate a positive refund or issue customer value. |
| 1175 | Verified cause resolved | Production build-recipe table now exists; old missing-table cause is gone. |
| 1201 | Code covered | Build-requirement pagination now interpolates a bounded numeric limit. |
| 1202 | Verified cause resolved | Current product-build batch joins compile against production using read-only EXPLAIN. |
| 1221 | Code covered | Australia Post address-country normalization is present; existing shipping tests pass. |
| 1222 | Code covered | Alternate message order for the same country-normalization failure. |
| 1263 | Unverified | Undefined React element type; minified stack does not identify the component. Do not assert resolution merely from age. |
| 1281 | Decision | Shipping lifecycle protection; verify the selected order stage rather than enabling invalid dispatch. |
| 1294 | Decision | Missing sandbox accounting mappings; choose approved asset/adjustment accounts before a journal retry. |
| 1316 | Code covered | Current shipping code no longer requests legacyResourceId on LineItem. Verify affected provider fulfilments separately. |
| 1326 | Decision | Shopify fulfilment-order scope failure; merchant access and affected dispatch need verification. |
| 1353 | Verified cause resolved | Production inventory-cost state table now exists; no receipt replay was performed. |
| 1417 | Decision | Production zero-value refund; no automatic credit or ledger mutation. |
| 1443 | Decision | Historical Xero bill approval; stored message is truncated before full validation details. Inspect the existing payable before retry. |
| 1480 | Unverified | Sandbox stocktake value-count error; requires exact statement/operation verification, not another stocktake application. |
| 1483 | Unverified | Production counterpart of 1480; stock state must be checked separately. |
| 1486 | Decision | Costing-switch lock timeout; maintenance/concurrency and financial valuation must be reviewed before retrying a switch. |
| 1487 | Decision | Costing-switch closed connection; do not repeat a possibly partially applied method switch without operation-state review. |
| 1490 | Decision | Sandbox Xero authentication rejection; later successful calls do not prove this bill was posted. |
| 1492 | Decision | Companion PO retry failure; inspect the linked payable before replay. |
| 1493 | Unverified | Stocktake-reversal value-count error; no reversal or stock correction was run. |
| 1513 | Unverified | Historical Xero tracking authentication error; newer API access exists, but matching readiness was not rechecked. |
| 1514 | Unverified | Historical Xero accounts authentication error; do not infer missing mappings are now correct. |
| 1515 | Decision | Sandbox Xero bill approval; mapping/account and existing document require review. |
| 1575 | Decision | Dispatch shortfall; verify physical stock and order readiness rather than permitting negative stock. |
| 1590 | Unverified | Channel-rule collation incident; no current production-equivalent probe of this exact query was performed. |
| 1592 | Unverified | Channel-rule prepared-argument incident; verify query pagination and current tenant execution. |
| 1599 | Verified cause resolved | Sandbox channel-jobs table now exists. |
| 1614 | Verified cause resolved | Production channel-product-rules table now exists. |
| 1629 | Unverified | Shopify inventory batch failure has an empty provider message; inspect delivery job state before retry. |
| 1656 | Verified cause resolved | Production channel-product-assignments table now exists. |
| 1658 | Decision | Short Shopify gift-card code was rejected after issuance workflow; do not replace a customer-issued code/card automatically. |
| 1660 | Verified cause resolved | Same deployed assignments table, channel-rule loader counterpart. |
| 1665 | Code covered | Loyalty identity joins use binary comparisons; no points, membership or redemption history changed. |
| 1689 | Verified cause resolved | Exact support-ticket business-list join now compiles against the current main schema. |
| 1692 | Code covered | Receipt-close token is defined, passed and consumed in the current POS source. |
| 1711 | Decision | Advisor import preflight permission guard; choose an authorised operator without weakening read-only access. |
| 1712 | Decision | Xero rejects AUTHORISED on a document with allocated value; inspect the paid/credited bill rather than forcing approval. |
| 1714 | Verified cause resolved | Shared bookkeeper-review table now exists. |
| 1728 | Decision | Advisor preflight rejection for another date; same role protection. |
| 1729 | Decision | Same current-day accounting safeguard as 1098; completed-day reconciliation still needed. |
| 1730 | Decision | Advisor preflight rejection; no role bypass. |
| 1732 | Decision | Advisor preflight rejection; no role bypass. |
| 1733 | Decision | Sage Shopify token/install failure; deliberate disconnect is not permission to reconnect it. |
| 1734 | Decision | Sage payout counterpart; activation remains paused. |
| 1737 | Code covered | Companion of repaired migrated batch marker 1738. Paid invoice must not be increased or reposted automatically. |
| 1751 | Unverified | Inventory-queue collation error; no queue delivery or current exact query was rerun. |
| 1757 | Code covered | Loyalty/contact mapping comparisons were hardened; no customer account mutation. |
| 1788 | Unverified | Publication collation failure; publication is deliberately disabled and was not activated for testing. |
| 1798 | Prepared | Malformed login input is now rejected before critical operational reporting. |
| 1835 | Decision | Expired Meta session; account owner must reconnect/authorise. |
| 1836 | Decision | Same expired Meta session; time-varying provider text created another fingerprint. |
| 1837 | Decision | Sandbox bill creation failed; inspect supported currency and existing payable before retry. |
| 1839 | Decision | Companion PO bill retry failure. |
| 1840 | Code covered | Both current order views define their own moveItemsOrder state. |
| 1844 | Decision | Expired Meta session. |
| 1845 | Code covered | Safari spelling of the same missing order-state symbol; current state is defined. |
| 1846 | Requested closure | Closed on 8 October at the user's explicit instruction. Same recorded cache-filling access as 19; global recovery now reloads instead of remounting the exhausted router. Original iPhone Safari trigger and live recovery remain unverified; closure is administrative. |
| 1886 | Decision | Expired Meta session. |
| 1889 | Unverified | Google Ads returned an empty errors array and request ID; no provider cause can be recovered from this record alone. |
| 1890 | Decision | Expired Meta session. |
| 1891 | Decision | Nightly reconciliation already repaired observed fulfilments; missed webhook cause and all affected shipment states remain to be checked. |
| 1893 | Decision | Missing linked sandbox Xero invoice; never clear/relink a financial identity without verification. |
| 1896 | Code covered | Transfer query now reads stock-item status from product, not variant; existing transfer tests pass. |
| 1900 | Decision | Xero throttling on the same stale invoice preflight; fix identity first, do not hammer retries. |
| 1907 | Decision | Expired Meta session. |
| 1908 | Prepared | Allocation protection is returned as an expected conflict; protected stock is unchanged. |
| 1911 | Decision | Xero explicitly rejects an inventory account on the sandbox bill; approved mapping choice required. |
| 1912 | Decision | Sandbox bill creation rejects unsupported currency; no currency substitution or amount conversion. |
| 1914 | Decision | Companion PO bill retry failure for unsupported currency. |
| 1920 | Decision | Expired Meta session. |
| 1925 | Decision | Expired Meta session. |
| 1927 | Code covered | Latest stack identifies reserveReward; current reward/transaction/account identity joins are binary-safe. Failed checkout/points outcomes still need operational verification. |
| 1938 | Decision | Expired Meta session. |
| 1939 | Decision | Expired Meta session. |
| 1942 | Decision | Creative-media request hit the same expired Meta session. |
| 1943 | Decision | Second creative-media fingerprint for the same expired session. |
| 1946 | Decision | Most recent Meta ingestion expiry; provider access has not been renewed in this task. |
| 1949 | Decision | Sandbox Xero rejects inventory account 630 when approving the test bill; no mapping or payable changed. |
| 1950 | Prepared | Empty backorder request is rejected before any order, stock or Xero work. |
| 1951 | Decision | Second sandbox test bill with the same inventory-account rejection. |
| 1952 | Code covered | Payout flag is defined and forwarded in current source; two existing payout-prop regression cases pass. Live deployment/browser acceptance is still required. |

## Previously Fixed records

These 57 IDs were already Fixed in the registry and have no later recorded recurrence. Their existing status was retained. Rows with age-only, administrative or missing notes are explicitly not a fresh reconciliation certification.

| ID | Review |
| --- | --- |
| 3 | Retained closure; no original resolution note. |
| 7 | Retained closure; no original resolution note. |
| 18 | Retained closure; no original resolution note. |
| 73 | Retained closure; no original resolution note. |
| 78 | Retained closure; no original resolution note. |
| 83 | Retained closure; old Xero journal outcome not freshly verified. |
| 84 | Retained age-based closure; held COGS period not freshly reconciled. |
| 88 | Retained age-based closure; Xero bill void not freshly verified. |
| 90 | Retained age-based closure; old payable not freshly verified. |
| 92 | Retained age-based closure; companion PO sync not freshly verified. |
| 105 | Current loyalty code uses active contacts, not deleted_at; original focused test evidence retained. |
| 106 | Retained closure; original report note absent. |
| 108 | Original prepared-LIMIT correction and focused reconciliation evidence retained. |
| 111 | Original resolution records fulfilled order/item; no new fulfilment was run. |
| 114 | Retained age-based AI-response closure. |
| 121 | Retained closure; original Serper resolution note absent. |
| 123 | Retained age-based AI-timeout closure. |
| 133 | Retained age-based Serper closure. |
| 170 | Retained age-based browser-symbol closure. |
| 177 | Retained age-based bill-void closure; no new provider verification. |
| 178 | Retained age-based receipt/Xero closure; no stock or accounting replay. |
| 180 | Retained age-based browser-symbol closure. |
| 209 | Retained prior browser-guard closure. |
| 243 | Original cancelled sandbox test PO/no live payable evidence retained. |
| 244 | Original cancelled sandbox test PO/no live payable evidence retained. |
| 245 | Original cancelled sandbox test PO/no live payable evidence retained. |
| 247 | Original fulfilled sandbox order evidence retained. |
| 248 | Original linked gift-card verification retained; no value changed. |
| 250 | Retained session-secret closure; secret value never read or printed. |
| 258 | Original allocation collation verification retained. |
| 259 | Current canonical allocation identity implementation; original focused evidence retained. |
| 261 | Original allocation collation verification retained. |
| 275 | Original stock-workbench verification retained. |
| 282 | Original all-tenant allocation alignment retained. |
| 292 | Sales counterpart of the verified original alignment. |
| 338 | Original CRM pipeline join verification retained. |
| 345 | Original CRM duplicate/merge join verification retained; no contact edits. |
| 358 | Original schema parser correction/compensation evidence retained. |
| 359 | Original schema parser correction/compensation evidence retained. |
| 360 | Original quoted-semicolon parser correction/compensation evidence retained. |
| 361 | Original quoted-semicolon parser correction/compensation evidence retained. |
| 362 | Original canonical variant aggregation correction retained. |
| 381 | Current status-badge implementation; original browser-symbol evidence retained. |
| 389 | Original remote-variant readback retained; a separate reopened fingerprint 168 remains open. |
| 401 | Administrative wholesale-auth closure retained; not newly certified. |
| 408 | Current metadata independently confirms wholesale-favourites table exists. |
| 432 | Original expected analytics-disconnect handling retained. |
| 447 | Administrative dashboard closure retained; not newly certified. |
| 455 | Original shipping join verification retained. |
| 456 | Original product-publication join verification retained. |
| 457 | Current onboarding active-contact correction; original administrative note retained. |
| 493 | Same original onboarding correction for another business. |
| 538 | Current metadata independently confirms Daybook product-guide table exists. |
| 544 | Retained historical lock-timeout closure; separate deadlock 586 is prepared, not closed. |
| 593 | Original deleted-variant unlink evidence retained; no new unlink. |
| 1676 | Original address wrapping and recovered-label verification retained; shipping tests pass. |
| 1738 | Original exact-instance batch-marker repair retained; paid Xero invoice untouched. |

## Verification and limits

- Focused suites for the edited paths pass, including the existing PO/backorder tests and payout-forwarding test.
- Production build and canonical Help/Assistant compilation pass. The final adjacent online-sales compatibility adjustment passes its five focused tests.
- Repaired online-sales SQL compiles using read-only EXPLAIN in all four registered tenant schemas.
- Nine of ten historically missing tables now exist; Sage's inventory queue remains absent.
- Original full-suite run: 3,555 passed, five skipped, one Help-context mismatch and one source-scan timeout. The source-scan passes in isolation with a 20-second timeout; the unrelated Help-context mismatch remains.
- No authenticated live IMS/POS acceptance or provider reconciliation was performed. The shared browser request helper failed before it could obtain cookies.
- New repairs are not deployed or committed by this task. Do not mark a prepared repair Fixed solely because its local tests pass.

## Approval boundaries

1. Accounting and customer value: approved Xero bill/journal mappings and currency support, paid-document corrections, missing invoice identity, gift-card/points reconciliation. Never fabricate stock/value or bypass paid-document restrictions.
2. Integration administration: merchant-granted Shopify scopes, Meta reauthorisation, Sage schema rollout/reconnection. Sage remains paused until explicitly approved.
3. Navigation/framework: on 8 October the user authorised investigation and an appropriate targeted repair. Global error recovery was changed to reload the current deep link, with three regression tests. Normal history integration and the Next.js version remain unchanged. A framework upgrade or broad history rewrite still requires separate approval.

## Navigation follow-up, 8 October

- Both recorded production offsets identify the same Next cache-filling routine. The installed router clears its module-level initialParallelRoutes after mounting; later initialization with that null map fails at the recorded access. The global error boundary previously called reset(), allowing the root router to remount with the cleared map.
- Global recovery now uses location.reload(), retaining the current pathname, query and hash while starting a fresh document/router. Error reporting remains unchanged. No automatic reload loop was introduced.
- Three focused recovery/reporting tests, the production build, canonical Help compilation and edited-file diagnostics pass. The isolated initializer succeeds with a fresh Map and reproduces the exact recorded stack with null; only unrelated prefetch/refresh-marker helpers were stubbed.
- Read-only authenticated paused-sandbox Chromium and WebKit probes asserted the displayed Products, Sales Orders, Purchase Orders and backorder-filter views during hash navigation and Back/Forward, followed by reload. Neither reproduced the recorded router exceptions. The final Chromium run had no browser errors; WebKit recorded three non-target browser errors. The initial rapid-navigation probe produced fetch errors. These checks do not prove the initial incident trigger is fixed or certify iPhone Safari 18.7.
- At the end of the navigation investigation, 19 and 1846 remained In progress. The subsequent user-requested administrative closures are recorded in Latest registry action above. No deployment, framework upgrade, stock/payment write or provider action was performed.