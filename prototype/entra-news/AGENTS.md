# Prototype Instructions

Run the local server yourself and open the preview in the browser available to this environment. Do not give the user server-start instructions when you can run it.

Before making substantial visual changes, use the Product Design plugin's `get-context` skill when the visual source is unclear or no longer matches the current goal. When the user gives durable prototype-specific design feedback, preferences, or decisions, record them in `AGENTS.md`.

When implementing from a selected generated mock, treat that image as the source of truth for layout, component anatomy, density, spacing, color, typography, visible content, and hierarchy.

Build app UI in `src/`. Keep `.openai/hosting.json`, `worker/index.js`, `scripts/prepare-sites-build.mjs`, and `tests/sites-worker.test.mjs` intact so the same local prototype can be handed to Sites. Before a Sites handoff, run `npm run build` and `npm run test:sites`; the build must leave `dist/client/index.html`, `dist/server/index.js`, and `dist/.openai/hosting.json`.

## Selected design direction

- Use the selected split-pane news reader direction: update list on the left, readable plain-English article on the right.
- Lead with the English explanation and administrator actions before source material.
- Source changes default to a formatting-aware rendered diff, preserving headings, paragraphs, lists, links, emphasis, and code blocks.
- Always provide a separate Raw Markdown tab for the underlying patch.
- Match the shadcn-based visual language of `/Users/merill/github/mc`: neutral slate tokens, crisp borders, 8px radii, restrained shadows, compact badges, and readable typography.
