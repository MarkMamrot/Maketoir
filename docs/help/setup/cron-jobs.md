---
{"id":"setup-cron-jobs","title":"Cron Jobs","audiences":["ims"],"capability":"integrations","screen":"SuperAdmin > Cron Jobs","product":"setup","format":"task","parentId":"setup-connections","contexts":["cron-jobs"],"contextSections":{"cron-jobs":"Step-by-step"},"relatedTopics":["setup-runtime-issues","setup-team-access-security","foresight-planning"],"order":7,"summary":"Review and switch platform-wide scheduled jobs without changing individual business settings.","lastReviewed":"2026-10-13","owner":"platform","quickSections":["Main operations","At a glance","Step-by-step"],"navigation":{"category":"platform","label":"Manage scheduled jobs"},"requiredTier":"SuperAdmin"}
---
# Cron Jobs

SuperAdmins can open **Admin > Cron Jobs** to review and change the master switches for scheduled work across Solvantis. These switches apply to every business, regardless of the active business selection.

## Main operations

- Review each job's global On or Off status and UTC schedule.
- Filter by category or status, or search for a job by name.
- Confirm the selected job and platform-wide effect before changing its switch.
- Read the risk warning before pausing stock, accounting, backups, or AI billing maintenance.
- Refresh status after a failed save before attempting another change.

## At a glance

| State | Meaning |
| --- | --- |
| On | The master switch permits future triggered runs; business, integration, and readiness settings still apply |
| Off | Future triggered runs are skipped before scheduled work begins |
| External trigger only | The endpoint is available for a separately configured trigger; no built-in schedule is listed |
| Status unavailable | Status could not be loaded; switches remain unavailable until a successful refresh |

Jobs without a saved master preference default to On. Opening the page does not enable individual integrations or change existing business settings. On is permission to run, not proof that a trigger fired or that an integration is healthy.

## Before you begin

- Sign in as a SuperAdmin.
- Confirm that a platform-wide pause, rather than a single-business pause, is intended.
- Consider outstanding orders, queued work, recovery needs, and accounting deadlines before changing a maintenance job.

## Step-by-step

1. Sign in as a SuperAdmin and open **Admin > Cron Jobs**.
2. Find the job using search, category, or status.
3. Check its global status and schedule. Listed schedules use UTC.
4. Select the job's switch.
5. Read the confirmation and any risk warning. Choose **Cancel** to leave the setting unchanged, or **Turn on** or **Turn off** to save.
6. Confirm the displayed status changed after the save completed. Use Refresh when you need a fresh status check.

The page includes inventory and channel automation, Amazon orders and fulfilments, returns, Shopify reconciliation, online-sales and Xero accounting, customer service, marketing monitoring and digests, prospect maintenance, AI billing maintenance, Runtime Issues digests, database backups, and Klaviyo outbox delivery.

## Scope and existing controls

These switches control execution when a scheduled endpoint is triggered. They do not remove the external schedule. A trigger can still arrive while a job is Off; Solvantis skips that run.

Business-wide **Pause scheduled automation**, business-level **Scheduled marketing jobs**, integration switches, and readiness checks remain effective. Turning a master switch On does not override them. The daily marketing job and weekly marketing digest have separate master switches.

Existing manual business actions remain available where provided. For shared inventory and customer-service routes, the master switch applies only to the scheduled branch. Switching Off does not cancel work already running, reverse completed changes, clear queued work, or refund charges. Resuming a job uses its existing retry and catch-up rules.

## Maintenance risks

> **Warning:** These switches affect every business. Pausing backups, stock synchronization, or financial maintenance can create recovery, availability, or accounting gaps.

| Paused work | Operational risk |
| --- | --- |
| Database backups | New scheduled recovery copies stop |
| AI billing maintenance | Billing-cycle advancement and reconciliation are delayed; existing unknown charges are not automatically released |
| Inventory or order synchronization | Online availability or incoming orders can fall behind |
| Accounting and reconciliation | Invoices, journals, payouts, or balance checks can be delayed |
| Customer service | Scheduled synchronization and automatic replies stop; manual actions remain available |
| Digests | Scheduled summaries and associated scheduled alert retries can be delayed |

## Troubleshooting

| Symptom | Safe action |
| --- | --- |
| A job is On but nothing happens | Check whether its trigger is configured, then check business pauses, integration settings, readiness, and Runtime Issues |
| A switch save fails | Refresh to read the persisted status; do not assume the change succeeded or failed |
| The cron control cannot be read | The run does not start and reports a retryable operational failure; review Runtime Issues |
| A job continued after being switched Off | A run may already have started; the switch affects later runs |

## Worked examples

### Pause marketing without stopping retail

Turn Off **Daily marketing monitoring and digest** and **Weekly marketing digest**. These master switches pause those marketing jobs across all businesses, without changing inventory or accounting master switches. For a single business, use Marketing Settings instead.

### Resume reconciliation safely

Find **Xero reconciliation**, confirm the master switch change to On, then check the relevant business and integration controls. Existing reconciliation rules determine what is due; the switch does not force a journal or repeat a completed payment.