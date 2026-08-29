---
{"id":"foresight-experiments-outcomes-learning","title":"Experiments, Outcomes, and Learning","audiences":["ims"],"capability":"navigation","screen":"Intel & Automation > Recommendation Inbox > Experiments","product":"foresight","format":"task","parentId":"foresight-planning","contexts":["experiments-outcomes-learning"],"contextSections":{"experiments-outcomes-learning":"Step-by-step"},"relatedTopics":["foresight-recommendations-creative-review-audits","foresight-planning-workspace-lifecycle"],"order":23,"summary":"Review an experiment design, record or perform its launch, and decide how its measured conclusion may be used.","lastReviewed":"2026-08-29","owner":"foresight"}
---
# Experiments, Outcomes, and Learning

Use the experiment workflow to compare a control and treatment under an accepted design, then review the measured conclusion.

## Main operations

- Draft an experiment from accepted planning work.
- Review the exact design, dates, metric, and safety checks.
- Record a manual launch or use a supported launch action only when offered.
- Wait until the scheduled end date for results.
- Acknowledge or reject the conclusion for future planning use.

## At a glance

| Input | Human decision | Output | External change |
| --- | --- | --- | --- |
| Accepted plan, deliverable, launch information, and measured variant results | Accept or revise the design; later acknowledge or reject the conclusion | An exact experiment design, launch record, and conclusion | Only a successful supported launch or a separately completed manual launch changes a platform |

## Before you begin

- Confirm the linked plan and deliverable are accepted.
- Choose one clear treatment and a valid control.
- Use a metric that can be collected for both variants over the same complete period.
- Check the dates, audience, budget, and stop conditions.

> **Warning:** Accepting an experiment design does not launch, schedule, send, or change a campaign. A separate launch step is required.

## Step-by-step

1. Open the selected recommendation and its planning details.
2. Draft the experiment design.
3. Check the hypothesis, control, treatment, metric, dates, and safety checks.
4. Accept the exact design, request revision, or reject it.
5. For a manual launch, make the external changes and record the launch against that accepted design.
6. When a supported Meta launch package is available, select the exact control and treatment, confirm the read-only package, complete the final confirmation, and launch.
7. Check the execution result. If it fails, verify external state before retrying.
8. Wait until the scheduled end date. Intel & Automation then collects the supported result information.
9. Review the conclusion and choose **Acknowledge** or **Reject**.

## Experiment stages

| Stage | Human decision | Output | External change |
| --- | --- | --- | --- |
| Draft design | Is the comparison fair and useful? | Reviewable design | None |
| Accepted design | Is this exact version suitable to launch? | Accepted version | None |
| Launch | Is the live setup correct? | Launch record or execution result | Yes, only when launch succeeds or is completed manually |
| Measurement | Has the complete period ended? | Collected result | None |
| Conclusion review | Is the conclusion suitable as future planning evidence? | Acknowledged or rejected conclusion | None |

## Read conclusions carefully

| Conclusion | Plain meaning | What not to claim |
| --- | --- | --- |
| Treatment won | Treatment met the design rules better than control | That it will always win in every audience or period |
| Control won | Control performed better under this design | That all future changes should stop |
| No significant difference | The design did not find a reliable difference | That both variants are identical |
| Safety check failed | A protected measure crossed its limit | That the treatment caused every observed change |
| Inconclusive | Available evidence could not decide | That the treatment succeeded or failed |

## Troubleshooting

| Symptom | Likely cause | Safe action |
| --- | --- | --- |
| Launch controls are unavailable | The design is not accepted or required setup is incomplete | Finish review and check the shown readiness items |
| Launch reports failure | Live campaign state changed or access failed | Inspect the external platform before retrying |
| No result appears on the end date | The complete measurement period or collection has not finished | Wait for complete-day processing, then refresh once |
| The conclusion looks misleading | Metric, dates, or safety checks do not answer the business question | Reject it and record the reason |

## Worked examples

### Test two Meta creative variants

Use the current advert as control and a new approved image as treatment. Run both for the accepted dates with the same audience conditions and compare the selected metric. If the treatment wins under the design, acknowledge that result as planning evidence, not as proof it will win everywhere.

### Stop after a failed launch

The launch reports failure after the external campaign was edited. Open Meta and check whether either variant or study exists before trying again. Rebuild the package only after the live state and selected campaigns are clear.