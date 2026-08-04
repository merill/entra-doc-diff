# EntraDiff News Reader Prototype — Product Requirements Document

## 1. Product summary

EntraDiff is a news-style reader for daily Microsoft Entra documentation changes. It converts technical documentation diffs into concise, plain-English updates for Entra administrators, while preserving access to the exact source changes.

This prototype explores a replacement for the current raw-diff-first experience. It uses a split-pane layout inspired by the Message Center reader and a shadcn-style visual system.

## 2. Problem

The existing EntraDiff experience makes administrators interpret raw Markdown changes before they can understand why an update matters. This creates unnecessary effort and makes it difficult to quickly identify important changes and required actions.

Administrators need to answer four questions quickly:

1. What changed?
2. Why does it matter to my tenant?
3. What should I do?
4. What exactly changed in the source documentation?

## 3. Target audience

Primary users are Microsoft Entra administrators, identity architects, security engineers, and consultants who monitor Microsoft documentation changes.

Users are technically capable but often review updates under time pressure. The interface should support rapid scanning without hiding the underlying evidence.

## 4. Product goals

- Make each documentation change understandable without first reading a raw diff.
- Lead with a short English translation of the change and its operational impact.
- Clearly identify recommended administrator actions.
- Preserve direct links to Microsoft Learn and the original EntraDiff report.
- Show a readable, formatting-aware comparison by default.
- Retain raw Markdown as an optional evidence and troubleshooting view.
- Present daily changes in a dense, readable news-reader layout.

## 5. Non-goals for the prototype

- Replacing the production EntraDiff site.
- Connecting the interface to the production JSON feed.
- Generating summaries through the OpenAI API at runtime.
- Implementing authentication, subscriptions, saved items, or notification preferences.
- Building archive, date-picker, or filtering workflows beyond the demonstrated interactions.
- Finalizing mobile information architecture.

## 6. Core experience

### 6.1 Daily update index

The left pane lists the documentation changes for the selected day. Each story includes:

- Category
- Publication date
- Plain-English headline
- One-sentence summary
- Selected state

Users can search the visible updates and select a story without leaving the reader.

### 6.2 English-first article

The selected story opens in the right pane. The article leads with:

- Category and status badges
- Short, administrator-focused headline
- Publication metadata
- “What changed and why it matters” summary
- “What admins should do” checklist
- Link to the Microsoft documentation
- Link to the original EntraDiff report

The summary must explain the meaning of the change rather than repeat the changed Markdown.

### 6.3 Formatted comparison

The default diff view presents the source change as a rendered document. It should preserve recognizable document structures such as:

- Headings
- Paragraphs
- Lists
- Links
- Inline and block code
- Added content
- Removed content

Added content uses green highlighting. Removed content uses red highlighting and a strikethrough where appropriate.

### 6.4 Raw Markdown comparison

Users can switch to a separate Raw Markdown tab. This view exposes the source patch with conventional added, removed, and hunk-line treatments.

The raw view is secondary and must never replace the English summary or formatted comparison as the default experience.

## 7. Functional requirements

### Priority 0 — required for the prototype

- Display a daily list of realistic Entra documentation stories.
- Select a story and update the complete article experience.
- Search stories by headline, category, or summary.
- Display a plain-English explanation before the diff.
- Display administrator actions for each story.
- Link to Microsoft Learn and the relevant EntraDiff report.
- Switch between Formatted changes and Raw Markdown.
- Display realistic added and removed content in both diff modes.

### Priority 1 — demonstrated supporting behavior

- Switch between dark and light themes.
- Display the number of updates for the selected day.
- Provide a version-comparison selector.
- Adapt the split-pane layout for smaller screens.

### Priority 2 — future production work

- Populate stories, summaries, actions, links, and diffs from the generated EntraDiff JSON.
- Generate English summaries during the daily GitHub workflow using the configured OpenAI model.
- Store the generated summary alongside each change in the JSON output.
- Render the same generated summary in daily email and website experiences.
- Support archives, dates, categories, preview-only filtering, and importance ordering.
- Add loading, empty, malformed-data, and summary-generation fallback states.

## 8. Content requirements

### Headline

- Describe the administrator impact or required decision.
- Prefer an active phrase such as “Assess,” “Audit,” “Harden,” or “Evaluate.”
- Avoid repository names, filenames, and internal documentation terminology.

### English summary

- Use two short paragraphs at most.
- Explain the changed behavior and tenant impact.
- Identify whether the update is preview, breaking, security-related, or action-required.
- Avoid unsupported conclusions and marketing language.

### Administrator actions

- Use concrete checklist items.
- Distinguish assessment from required configuration changes.
- Do not imply urgency unless the source includes a deadline or rollout milestone.

## 9. Information hierarchy

The detail experience must appear in this order:

1. Headline and classification
2. Plain-English translation
3. Administrator actions
4. Microsoft documentation and EntraDiff links
5. Formatted source comparison
6. Optional raw Markdown comparison

## 10. Visual and interaction requirements

- Use the Message Center split-pane reader as the primary interaction reference.
- Use shadcn-style foundations: neutral surfaces, subtle borders, compact controls, restrained corner radii, and accessible focus states.
- Default to a dark theme consistent with the existing Message Center experience.
- Keep the update index visible while the article is read on desktop.
- Use typography and spacing appropriate for a technical news publication.
- Use icons from the selected icon library rather than handcrafted graphical assets.
- Ensure controls have accessible names and keyboard focus treatments.

## 11. Prototype data

The demo includes four representative stories:

- SMS and voice retirement migration opt-out
- SCIM provisioning with workload identity federation
- Immutable GitHub and GitLab federated credentials
- Company-branding CSS retirement guidance

The SMS and voice story is the default because it represents a high-impact administrator action and demonstrates prose, code, links, additions, and removals.

## 12. Success criteria

The prototype is successful when an Entra administrator can:

- Identify the most important change from the daily index.
- Explain the change and its tenant impact after reading the summary.
- Identify the next administrative actions.
- Open the Microsoft source documentation.
- Inspect a readable rendered comparison.
- Switch to the raw Markdown evidence when needed.

The core task should require no knowledge of Git or Markdown diff syntax.

## 13. Prototype acceptance criteria

- Search, story selection, theme toggle, and diff tabs work.
- Each story replaces its headline, summary, actions, links, and comparison content.
- Formatted diff is selected by default.
- Raw Markdown remains available as an explicit option.
- Browser console contains no warnings or errors during the core flow.
- Production site and data pipeline remain unchanged during prototype review.
- Production build and hosting compatibility tests pass.

## 14. Production follow-up decisions

Before implementation in the production site, confirm:

- Final JSON schema for headline, English summary, administrator actions, importance, and classification.
- Whether AI-generated content is stored per document change or per daily report.
- Summary-generation failure and regeneration behavior.
- Importance ranking rules and editorial overrides.
- URL structure for individual change detail views.
- Treatment of changes that affect multiple documents or contain only metadata edits.
- Accessibility and responsive-layout acceptance criteria.
