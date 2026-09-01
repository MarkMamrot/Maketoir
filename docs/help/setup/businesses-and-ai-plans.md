---
{"id":"setup-businesses-ai-plans","title":"Businesses and AI Plans","audiences":["ims"],"capability":"navigation","screen":"SuperAdmin > Businesses","product":"setup","format":"task","parentId":"setup-connections","contexts":["businesses"],"contextSections":{"businesses":"Step-by-step"},"relatedTopics":["ims-settings-account-ai-credits","setup-feature-rollouts","setup-team-access-security"],"order":4,"summary":"Manage business access, operating limits, environment safeguards, and the assigned Solvantis AI plan.","lastReviewed":"2026-09-01","owner":"platform"}
---
# Businesses and AI Plans

Use Businesses to onboard and administer each Solvantis business. Business Settings contains module access, environment safeguards, operating limits, billing values, and the business's Solvantis AI plan.

## Main operations

- Open a business's settings and change its Solvantis AI plan.
- Select any active business and administer it with your own SuperAdmin account.
- Enable or disable Intel & Automation, IMS, and POS access.
- Identify sandbox businesses and pause their scheduled automation when required.
- Set location and user limits and the monthly cost per location.
- Open AI Usage & Credits for funding, enforcement, usage, model costs, and plan margins.
- Maintain one AUD-per-USD exchange rate for the supported Google models.
- Set the percentage markup for Starter, Core, Scale, Enterprise, and Platform.
- Apply the complete six-model price set in one operation while retaining historical usage rates.

## At a glance

| Control | Where to manage it | Effect |
| --- | --- | --- |
| Active business | Top bar or **Businesses > Open IMS** | Changes which business's IMS, POS, integrations, settings, and operational data are active |
| Solvantis AI plan | **Businesses > Settings** | Selects the sell-rate plan for future AI usage |
| Module access | **Businesses > Settings** | Controls access to Intel & Automation, IMS, and POS |
| Sandbox and automation | **Businesses > Settings** | Identifies test businesses and can stop scheduled automation |
| AI funding and enforcement | **AI Usage & Credits** | Controls prepaid credit or account limits and exhaustion behaviour |
| Supported model costs | **AI Usage & Credits > AI pricing** | Shows the published USD dimensions and converted AUD costs for six supported models |
| AUD per USD | **AI Usage & Credits > AI pricing** | Converts the published Google prices into the provider costs used for future calls |
| Plan markups | **AI Usage & Credits > AI pricing** | Applies a saved percentage above provider cost for each Solvantis AI plan |

## Before you begin

- Sign in with SuperAdmin access.
- Finish or park any POS sale before changing businesses.
- Confirm the requested plan and commercial arrangement before saving it.
- Check the business name carefully, especially when a sandbox has a similar name.
- Confirm the current AUD-per-USD rate and each plan's approved markup before applying pricing.

> **Important:** Changing the Solvantis AI plan changes the rates used for future AI usage. It does not add prepaid credit, reset current-cycle usage, or alter funding and enforcement settings.

> **Important:** Selecting a business does not sign in as one of its staff. You remain the same SuperAdmin with full administrator permissions; only the active business and its data change.

## Step-by-step

1. Open **Admin > Businesses**.
2. Find the business and select **Settings**.
3. Review the business name and module access.
4. Under **Plan Limits & Billing**, choose the **Solvantis AI Plan**.
5. Review location, user, and cost-per-location values.
6. Select **Save Changes**.
7. Open **AI Usage & Credits** only when funding, enforcement, cycle, credit, or rate controls also need attention.

### Work in a business

1. Open **Admin > Businesses**.
2. Find the active business you need to administer.
3. Use **Open IMS**, or choose the business with the top-bar **Business** selector.
4. Wait for the workspace to reload and confirm the selected business name in the top bar before viewing or changing data.
5. Move between IMS, Intel & Automation, Setup, and POS as needed. Your SuperAdmin permissions remain available.
6. To return, choose another business, including your usual business, from the same selector.

When POS was configured for a different business, it returns to Device Setup after the change. Select a location and register belonging to the newly active business. Carts, parked sales, product caches, and offline queues remain separated by business.

> **Warning:** Always confirm the active business before changing stock, orders, payments, integrations, or accounting settings. Changing the active business reloads the workspace and closes any unsaved screen state.

### Configure AI pricing

1. Open **Admin > AI Usage & Credits**.
2. Under **AI pricing**, review the six supported models and their published USD charging dimensions.
3. Enter the current **AUD per USD** exchange rate.
4. Enter the approved markup percentage for Starter, Core, Scale, Enterprise, and Platform.
5. Select **Apply pricing**.
6. Confirm every model shows **Active** and the page shows **Current**.

The supported catalogue includes a recent Flash model, Flash-Lite, Pro Preview, Nano Banana 2, Nano Banana Pro, and Veo 3.1 Standard. Applying pricing activates this complete set and makes other model IDs unavailable for new Solvantis AI work.

The calculation is **customer charge = provider cost × (1 + plan markup percentage)**. A 20% markup changes a $1.00 provider cost into a $1.20 customer charge. A markup percentage is not the same as a target gross-margin percentage.

Google responses provide usage quantities rather than a final dollar cost. Solvantis calculates the provider cost from returned token or duration usage and the rate active when the call began, then applies the business's plan markup.

> **Important:** Applying pricing affects future AI calls. Historical provider costs, customer charges, and the rate details recorded with completed calls remain unchanged.

> **Important:** Gemini Pro uses separate prices when prompt and cached input exceed 200,000 tokens. Image generation is charged from image-output tokens. Veo Standard is charged per generated second; 4K video is not available through this price set.

## Troubleshooting

| Symptom | Likely cause | Safe action |
| --- | --- | --- |
| A business is missing from the selector | The business was deleted or is an internal platform account | Check **Admin > Businesses** and select an active operating business |
| The workspace returns to sign-in while switching | The original signed-in session expired | Sign in again; changing businesses does not extend the session |
| POS returns to Device Setup | Its saved location belongs to the previously active business | Select a location and register for the current business before continuing |
| The expected features or connections are missing | The selected business has different module access, rollout settings, or connections | Confirm the active business, then review its Business Settings and Connections |
| The AI plan is still loading | AI account details have not returned yet | Wait briefly and reopen Settings if loading does not finish |
| The plan cannot be changed | The business does not have an available AI account | Review AI Usage & Credits and contact platform support |
| Saving reports that only the AI plan failed | Business settings saved but the AI account update did not | Verify the plan and retry after checking the reported error |
| AI remains unavailable after a plan change | Funding is exhausted, enforcement is active, or the account is suspended | Review the business in AI Usage & Credits |
| A deleted business is missing | Deleted rows are hidden by default | Enable **Show deleted** for historical review |
| Apply pricing is unavailable | Pricing is still loading or a save is already running | Wait for the current operation to finish, then retry |
| Apply pricing reports a missing markup | One of the five plan percentages is blank or invalid | Enter every plan markup, including zero where no markup is intended |
| A model shows Apply required | Its current AUD rates or availability do not match the displayed price set | Verify the exchange rate and markups, then select **Apply pricing** |
| A model is missing from tenant selectors | It is outside the supported six or the current price set has not been applied | Apply the complete AI price set, then choose one of the available models |
| A previously selected model stops working | The saved model is outside the supported six | Choose an available model and save the setting again |

## Worked examples

### Resolve an issue in another business

A SuperAdmin is signed in under Solvantis and needs to correct a purchase order for Sage. They choose **Sage** in the top bar, wait for IMS to reload, and confirm Sage is displayed before opening the order. They remain the same SuperAdmin throughout. After finishing, they choose **Solvantis** to return to their usual workspace.

### Move a business to a different AI plan

A business is approved to move from Starter to Core. A SuperAdmin opens that business's Settings, changes **Solvantis AI Plan** to **Core**, and saves. Existing prepaid credit or current-cycle usage remains unchanged. Future AI usage is valued using the applicable Core rates.

### Keep plan and funding controls separate

A business remains on Scale but needs additional prepaid value. The SuperAdmin leaves its plan unchanged in Business Settings, opens **AI Usage & Credits**, and records the approved credit adjustment with its reference and reason.

### Apply new exchange rate and margins

The approved exchange rate changes from 1.50 to 1.52 AUD per USD. The SuperAdmin enters **1.52**, keeps Starter at **20%**, and sets Scale to **15%** before selecting **Apply pricing**. Future usage uses the newly converted provider costs and each business's plan markup. Earlier calls keep their recorded cost and charge.