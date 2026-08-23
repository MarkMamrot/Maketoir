---
{"id":"foresight-business-intelligence","title":"Business Intelligence and Inventory Analysis","audiences":["ims"],"capability":"navigation","screen":"Dashboard > Business Intelligence","product":"foresight","format":"overview","parentId":"foresight-workspaces","contexts":["business-intelligence","business-info","brand-profile","sync-data","calculated-data","inventory","inactive-candidates","lost-candidates","space-analysis","stock-turnover"],"contextSections":{"business-intelligence":"Business information and data","business-info":"Business information and data","brand-profile":"Business information and data","sync-data":"Refresh source data","calculated-data":"Read calculated results","inventory":"Inventory analysis","inactive-candidates":"Inventory analysis","lost-candidates":"Inventory analysis","space-analysis":"Inventory analysis","stock-turnover":"Inventory analysis"},"relatedTopics":["foresight-workspaces","foresight-planning"],"order":10,"summary":"Keep business information current and investigate performance or inventory signals before acting.","lastReviewed":"2026-08-23","owner":"foresight"}
---
# Business Intelligence and Inventory Analysis

Use Business Intelligence to check the information behind a result before changing stock, pricing, marketing, or merchandising.

## Main operations

- Keep Business Key Information and Brand Profile accurate.
- Refresh the relevant source before using time-sensitive results.
- Match date ranges and locations when comparing figures.
- Open the source records behind an inventory candidate before acting.

## Business information and data

Business Key Information records practical facts about the business. Brand Profile records reviewed information such as audience, voice, products, policies, and positioning. These details can shape generated analysis, so a person should correct anything that is old or unsupported.

| Input | Human decision | Output | External change |
| --- | --- | --- | --- |
| Saved business facts and brand information | Which facts are correct and current | Context used by supported analysis and drafting | None |

> **Important:** Generated or imported profile text is a draft until someone who knows the business checks it.

## Refresh source data

Sync Data refreshes the supported source selected by the screen. Check the displayed status and time before refreshing. Wait for one refresh to finish before starting another.

| Before refresh | After refresh | What to check |
| --- | --- | --- |
| Source is connected and the intended account is selected | A success, warning, or failure result is shown | Account, date, record count where shown, and warnings |

## Read calculated results

Calculated views turn available source records into summaries. A result is only comparable when its date range, location, source freshness, and definition match the result beside it.

| Result | Check before deciding | Human decision |
| --- | --- | --- |
| Sales or marketing trend | Same dates and current source data | Whether the movement needs investigation |
| Stock turnover | Sales period, current stock, incoming stock, and seasonality | Whether ordering or merchandising should change |
| Space efficiency | Product range and location context | Whether space use should be reviewed |

## Inventory analysis

Inactive Candidates, Possible Losses, Space Efficiency, and Stock Turnover are investigation lists. They do not automatically change a product or prove why a result occurred.

| Input | Human decision | Output | External change |
| --- | --- | --- | --- |
| Product, sales, stock, and selected period | Whether the signal makes sense for this product and season | A candidate or comparison to investigate | None |

## Troubleshooting

| Symptom | Likely cause | Safe action |
| --- | --- | --- |
| Two views disagree | Dates, locations, definitions, or refresh times differ | Align those settings before comparing again |
| A candidate seems wrong | Recent receipts, seasonality, or product history changes the picture | Inspect the product and source records |
| Results are empty | The source is not ready or the chosen period has no records | Check source status and widen the period only when appropriate |
| Refresh fails twice | The connection or source needs attention | Stop retrying and check Setup connection status |

## Worked examples

### Review a slow-moving jacket

Stock Turnover flags a jacket with 18 units on hand and two sales in the selected period. Check that the period includes the relevant winter weeks, inspect stock by location and incoming orders, then decide whether to move stock, change ordering, or leave it for the season.

### Compare two sales summaries

One view uses the last seven complete days and another includes today. Set both to the same complete dates and confirm the source refresh time before treating the difference as a business change.