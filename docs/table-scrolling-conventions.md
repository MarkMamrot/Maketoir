# IMS Table Scrolling Conventions

Use this pattern for desktop IMS data tables that can exceed the available content width.

## Required behavior

- Keep normal page-level vertical scrolling for standard IMS list views.
- Keep the header row visible while the page scrolls.
- Give the table body its own horizontal scrollbar only; do not add an internal vertical height cap.
- Freeze only the explicitly identified identity columns.
- Left and Right move the table body by 240px.
- Up and Down move the normal page by 240px.
- Ignore arrow shortcuts while focus is in an input, select, textarea, or content-editable control.
- Report tables use the same page-level vertical scrolling as standard IMS lists.

## Standard implementation

1. Constrain every flex boundary from the IMS `<main>` through the view root with `minWidth: 0`. The view root should also use `width: '100%'` and `maxWidth: '100%'`.
2. Define one numeric table width and one shared `renderColGroup()` function. Use the same fixed widths in the header and body tables.
3. Render a non-scrolling outer frame containing two sibling regions:
   - a header wrapper with `position: sticky`, `top: 0`, `overflow: hidden`, and its own table;
   - a body wrapper with `overflowX: auto`, `overflowY: hidden`, and a second table containing only `<tbody>`.
4. Give both tables the same width, colgroup, `tableLayout: 'fixed'`, `borderCollapse: 'separate'`, and `borderSpacing: 0`.
5. Synchronize horizontal movement in the body wrapper:

```tsx
onScroll={event => {
  if (headerScrollRef.current) {
    headerScrollRef.current.scrollLeft = event.currentTarget.scrollLeft;
  }
}}
```

6. Freeze requested columns in both header and body with `position: sticky`. The first frozen column uses `left: 0`; each later frozen column uses the sum of all preceding frozen widths. Give frozen cells an opaque row/header background, a higher z-index, and a right-edge divider shadow.
7. Attach `useTableArrowScroll(bodyScrollRef)` from `src/app/ims/hooks/useTableArrowScroll.ts` so Up and Down move the IMS page. Report tables follow this same behavior.
8. Add `tabIndex={0}`, `role="region"`, and an `aria-label` describing arrow-key scrolling to the body wrapper.
9. Use `ims-sticky-table ims-sticky-table--self-scroll` on the body wrapper so desktop global CSS does not override its horizontal overflow.

## Shared `ImsTable`

For simple data lists, use `ImsTable` in `src/app/ims/page.tsx` and provide:

- `columnWidths`: one width for every column;
- `frozenColumnIndex`: the single column that remains fixed;
- `scrollClassName`: a view-specific selector for browser tests.

Use a dedicated split table when rows need custom click handling, multiple frozen columns, sortable headers, or complex action controls.

## Validation

A real authenticated Playwright check must prove behavior, not just appearance:

- `scrollWidth > clientWidth`;
- Right changes body `scrollLeft` and header `scrollLeft` to the same value;
- frozen cell X coordinates do not change;
- the first moving column shifts left;
- Down increases vertical scroll and Up reverses it;
- vertical keys do not change horizontal scroll;
- the header remains visible during vertical scrolling;
- inputs/selects still receive their normal arrow-key behavior.

Do not validate these tables with an `about:blank` or synthetic HTML fixture. Use the actual authenticated IMS view and real rendered rows.
