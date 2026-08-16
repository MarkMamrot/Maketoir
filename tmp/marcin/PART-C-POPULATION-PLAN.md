# Part C Commercial Clarification Register Population Plan

## Agreed approach

- Use one Part C item per legal issue at each affected contractual location.
- Consolidate comments sharing the same legal anchor, while preserving every distinct request, rationale and proposed wording.
- Keep repeated commercial positions at different clauses as separate register items and cross-reference them as a linked issue family.
- Include the seven internal/action source comments, consolidated into three issue blocks, and format those full issue blocks in red so they can be found and removed manually if required.
- Use `14 Aug 2026` for the initial Tenderer date and `Open` for initial status.
- Populate legal references in contract order.

## Source findings

### Part C template

The operative register is a six-column landscape table:

1. Item No.
2. Section / Clause
3. Date
4. Comment By
5. Clarification
6. Status (Open/Closed)

Each issue is a three-message conversation block:

1. Tenderer initial submission
2. Fortescue response
3. Tenderer follow-up

The Item No. and Section / Clause cells are vertically merged across the three-message block. The initial Tenderer row is populated; the Fortescue and follow-up rows remain blank except for `Comment By`. New items should be made by cloning the complete three-row block so widths, borders, vertical merges, row behaviour and styles are preserved. The document is A4 landscape. The template has no tracked revisions or comments.

### Part D redline inventory

- 198 pages, 50 tables and 92 Word comments.
- 88 unique comment anchors after consolidating comments attached to the same location.
- Shared anchors: comments 77/78/79 at Annexure I; 80/81 at Schedule 3; 85/86 at Schedule 8.
- Seven source comments are internal/action notes: comments 77, 78, 79, 80, 81, 85 and 86. Under Option 1 they consolidate into three red issue blocks.
- OOXML contains 410 insertion objects, 1,554 deletion objects, 76 character-format changes and 86 paragraph-format changes.
- Word may group adjacent OOXML changes into fewer displayed revisions; the OOXML objects are the completeness baseline.
- There are no tracked changes in headers, footers, footnotes or endnotes. All tracked changes are in the main document story, including its tables.
- The main document also contains 310 highlighted elements, 38 strike/double-strike elements and non-black text. These require reconciliation against tracked changes to identify any manual redlines.
- Comments span 5-14 August 2026. The register will use the agreed common submission date rather than individual comment timestamps.

## Population workflow

### 1. Build the source change ledger

Create one working-ledger record for each of the 88 unique comment anchors. Retain the original 92 comment IDs in a source-ID field so consolidation is auditable.

For every anchor, capture:

- page and Word range position;
- complete comment text, author and original timestamp;
- complete anchor text;
- nearest numbered clause, paragraph and subparagraph;
- applicable schedule or annexure hierarchy;
- all insertion, deletion and formatting revisions intersecting the anchor and its containing paragraph/table cell;
- clean current wording and clean proposed wording reconstructed from the redline;
- whether the item is customer-facing or an internal/action item;
- linked issue family, where the same commercial position affects multiple clauses.

Do not use change IDs as a proxy for the number of issues. Pair adjacent deletions and insertions into a single proposed amendment and retain both texts in full.

### 2. Reconstruct each clarification

The initial Tenderer clarification should contain, in this order:

1. `Current wording:` the complete affected wording where needed to make the change intelligible.
2. `Proposed amendment:` the complete replacement, insertion or deletion request, preserving defined terms, punctuation and cross-references.
3. `Reason:` the complete Word comment rationale, edited only to remove drafting artefacts or convert an internal instruction where specifically approved.
4. `Related items:` cross-references to other Part C item numbers addressing the same commercial position.

For a deletion, state exactly what is to be deleted. For an insertion, state where it is inserted and reproduce the complete proposed text. For a replacement, show both current and proposed wording. Do not use vague descriptions such as “amend as marked up” or “refer to redline”.

### 3. Assign legal references

Use the following hierarchy in the `Section / Clause` column.

For the main agreement:

`Clause [number] – [clause name] / paragraph [subparagraph]`

For definitions:

`Clause 1.1 – Defined terms / “[Defined Term]” / paragraph [subparagraph if applicable]`

For Contract Particulars:

`Contract Particulars / Item [number] – [item name] / sub-item or table row [label]`

For annexures and schedules:

`[Annexure or Schedule number] – [full name] / Item [number and name]`

If there is no formal item number, use the most precise available locator in this order:

1. numbered section and section name;
2. table number and table name;
3. named table row or field;
4. heading-level item, explicitly marked `whole schedule` when the comment applies to the complete schedule.

Never use a bare page number or a bare schedule number.

Examples from Part D:

- `Annexure I – Performance requirements and Acceptance Tests / Whole annexure`
- `Schedule 3 – Pricing Schedule / Item 6 – Applicable Milestones for each Supply Order / Table 3-1 – Framework Milestones for each Supply Order`
- `Schedule 3 – Pricing Schedule / Item 1 – Applicable Rise and Fall Formula`
- `Schedule 7 – Form of Parent Company Guarantee / Whole schedule (proposed Not Used)`
- `Schedule 8 – Form of Security / Whole schedule`
- `Schedule of Insurances / General Third Party (Public & Products) Liability / Deductibles`
- `Schedule of Insurances / General Third Party (Public & Products) Liability / Additional requirements`
- `Schedule of Insurances / Marine Transit Insurance / Deductibles`
- `Schedule 11 – Subcontractor Warranty / Whole schedule (proposed Not Used)`
- `Schedule 12 – Review Procedures / Whole schedule`
- `Schedule 15 – Deed of Novation / Whole schedule`

### 4. Apply first-pass consolidation

Start with 88 item blocks, subject only to a final legal-location review.

- Consolidate comments 77/78/79 into one red internal/action item for Annexure I, preserving all three instructions and dates in the working ledger.
- Consolidate comments 80/81 into one red internal/action item for Schedule 3 as a whole.
- Consolidate comments 85/86 into one red internal/action item for Schedule 8 as a whole.
- Do not consolidate Parent Company Guarantee comments in the definition/main clause/Schedule 7 merely because the commercial position is the same. Keep each affected location as a separate linked item.
- Apply the same rule to subcontractor warranties, escalation, insurance, acceptance and other repeated themes.

### 5. Populate Part C

For every item:

- Item No.: sequential integer in contract order.
- Section / Clause: exact hierarchy described above.
- Date: `14 Aug 2026`.
- Comment By: `Tenderer`.
- Clarification: full reconstructed request and rationale.
- Status: `Open`.

Leave the Fortescue response and Tenderer follow-up rows blank except for their existing `Comment By` labels. Preserve the template note that coloured text may identify the latest issue.

For the three consolidated internal/action issue blocks, colour the entire three-row block red, including Item No., Section / Clause, date, Comment By, clarification and status. Do not rely on red text only inside the clarification cell, because the user needs to locate and remove the whole block reliably.

### 6. Annexure and schedule quality pass

Perform a dedicated second pass from the first annexure/schedule page to the end of the document.

For each comment or redline:

- identify the current annexure or schedule heading;
- identify the nearest numbered item within that part;
- for table content, capture the table title plus row/field label;
- verify the locator against the visible Word page, not only the preceding XML paragraph;
- confirm that heading-level comments are labelled `Whole annexure` or `Whole schedule` rather than incorrectly inheriting an item from the previous schedule;
- confirm that every annexure/schedule redline has a Part C item or a documented reason for consolidation.

This prevents the known failure mode where Annexure I inherits `Additional Lubrication Schedule` from the preceding material, or insurance table comments lose their row labels.

### 7. Completeness reconciliation

Use four independent controls before finalising:

1. Comment control: all 92 comments map to one of the 88 initial item blocks, with no orphaned comment IDs.
2. Redline control: every material insertion/deletion cluster maps to an item, is marked purely consequential/mechanical, or is documented as formatting-only.
3. Visual-style control: inspect all highlighted, struck and coloured text not already enclosed by tracked revisions; add any manual proposed change to the ledger.
4. Legal-order control: compare the final Part C sequence against the main agreement, Contract Particulars, Annexure I and Schedules in document order.

The final reconciliation sheet should include: source comment IDs, source revision IDs/ranges, Part C item number, legal reference, disposition, internal/action flag and reviewer sign-off.

## Review gates

### Gate 1: working ledger review

Review the 88 proposed issue records before editing Part C. Confirm legal reference, proposed wording, rationale, consolidation and internal/action flag.

### Gate 2: populated register review

Review a generated Part C copy with Track Changes off. Check merged cells, repeated header rows, page breaks, red internal blocks and legibility of long clarifications.

### Gate 3: legal completeness review

Have the contract owner confirm that the reconstructed proposed wording accurately represents the intended departures. This is particularly important for comments that reserve rights, refer to an external offer, or request later replacement material.

### Gate 4: final submission hygiene

Before external issue, decide whether to delete the three red internal/action blocks, replace them with customer-facing clarifications, or retain them. Remove analysis metadata, internal source IDs and drafting instructions from the submission copy. Re-run the 92-comment/88-anchor reconciliation after any deletion or conversion.

## Items requiring business input before final submission

The following source areas do not contain final standalone customer wording and require documents or decisions from the business:

- Annexure I: correct offer document/reference, SDRL, Scope of Work and data sheet.
- Schedule 3: correct offer document and detailed pricing schedule position.
- Schedule 3 item 6/Table 3-1: Supplier milestone framework.
- Schedule 3 item 1: escalation/rise-and-fall mechanism.
- Schedule 8: ABB standard bank guarantee/security template.
- Schedule 12: scope of reserved additional comments after offer discussions.
- Schedule 15: detailed proposed amendments are expressly deferred to a subsequent review.
- Tariffs and duties: detailed departures remain reserved.
- Insurance schedule: ABB standard policy terms and deductibles are referenced but not reproduced in full.

These items may be entered in Part C as reservations or information requests, but they cannot be represented as final contractual wording until the referenced material is supplied or the commercial position is confirmed.