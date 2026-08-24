# scripts

Product-local tooling. The generator's own commands come from the engine —
`dailynews monitor`, `build-site`, `search-index`, `summaries`, `publish-kit`,
`regenerate-diffs`, `serve`.

| | |
|---|---|
| `link-engine.js` | points `node_modules/@merill/dailynews-engine` at a sibling checkout, for local development. CI does this through the engine's setup action instead. |
| `generate-historical-data.js` | one-shot: walks the documentation history and writes deterministic daily reports and period briefs. No OpenAI calls, so it costs nothing — and claims nothing it cannot support, marking every brief `deterministic-backfill`. |

`generate-historical-data.js` **rewrites every dated report in `website/`**. It
only runs when invoked directly — it used to run on `require`, which meant
loading it was enough to overwrite the archive.
