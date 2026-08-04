# Design QA

## Source of truth

- Selected design: `/Users/merill/.codex/generated_images/019fc04c-db70-7ba2-87f9-0a636ce5004f/exec-cc4eb62a-4395-4bef-bfe7-b1be3efa10b5.png`
- Reference product: the Message Center split-pane reader and formatted comparison at `https://mc.merill.net`
- Implementation screenshot: `/Users/merill/github/entra-doc-diff/prototype/entra-news/implementation-viewport.png`
- Side-by-side comparison: `/Users/merill/github/entra-doc-diff/prototype/entra-news/design-comparison.png`

## Comparison state

- Desktop viewport: 1440 × 1024
- Selected story: SMS and voice retirement
- Theme: dark
- Diff mode: Formatted changes
- Source and implementation were normalized to the same 720 × 512 frame in the side-by-side comparison.

## Required fidelity surfaces

- Dark shadcn-style shell with compact borders, restrained radius, system typography, and blue accent
- Sticky header and fixed left update index
- Plain-English summary before the source comparison
- Explicit admin-action checklist and documentation links
- Formatting-aware diff that preserves document hierarchy, prose, links, code, additions, and removals
- Separate Raw Markdown diff mode

## Interaction checks

- Search filters the update index to the SCIM story.
- Selecting the SCIM result replaces the article, summary, links, and diff content.
- Formatted changes and Raw Markdown tabs switch successfully.
- Raw mode exposes the added and removed Markdown lines.
- Theme toggle switches to light and back to dark.
- Story selection was restored to the SMS and voice article for handoff.
- Browser console contained no warnings or errors.

## Visual findings

- The split-pane proportions, density, hierarchy, dark palette, and article flow closely match the selected design.
- The implementation gives the English translation slightly more vertical breathing room than the mockup; this improves legibility while preserving the intended order.
- The formatted comparison starts lower in the viewport than the mockup because the prototype uses longer realistic admin copy, but the source-change heading and diff controls remain visible without navigation.
- No broken layout, cropped controls, incorrect radius, or visually inconsistent borders were found at the target state.

## Verification

- `npm run build`: passed
- `npm run test:sites`: 4 tests passed
- Visual comparison: passed
- Core interaction flow: passed

## Result

Passed for prototype review. Production integration is intentionally not included in this demo phase.
