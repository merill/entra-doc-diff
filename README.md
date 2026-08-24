# entra-doc-diff

[daily.entra.news](https://daily.entra.news) — Daily.Entra.News.

This repository holds the product. The generator lives in
[merill/dailynews-engine](https://github.com/merill/dailynews-engine), shared
with the other Daily.\*.News sites, and is reached through a composite action
rather than an npm dependency — so this repository has no dependencies at all.

## What is here

| | |
|---|---|
| `dailynews.config.js` | everything specific to this product: taxonomy, prose, Learn URL routes, classification |
| `assets/site/` | favicons, OG image, product and topic icons, shared chrome |
| `website/` | the generated site, committed and served from here |
| `src/` | this product's conformance tests — its own rendered output, its Kit marker, its configuration |
| `scripts/` | the engine link helper and a one-shot historical backfill |

There is no generator code. If you are looking for how a page is built, it is in
the engine.

## What it tracks

`MicrosoftDocs/entra-docs` (branch `main`), the `docs/` subtree, plus the Microsoft 365
Message Center archive at `merill/mc`.

## Working on it

```bash
git clone https://github.com/merill/dailynews-engine.git ../dailynews-engine
(cd ../dailynews-engine && npm ci)
npm run engine:link
npm test
```

`npm run engine:link` points `node_modules` at the sibling engine checkout,
including the `.bin` shim so `npm run build:site` works. In CI the engine's
setup action does the same thing.

To rebuild the site locally you need a clone of the documentation repository:

```bash
git clone --filter=blob:limit=100k --single-branch \
  https://github.com/MicrosoftDocs/entra-docs.git ../entra-docs
TZ=UTC DOCS_REPO_PATH=../entra-docs npm run build:site
```

`TZ=UTC` matters: without it every date bucket shifts and hundreds of pages
appear to change.

## Deployment

Cloudflare Pages builds from this repository directly — production branch `main`,
no build command, output directory `website`. There is no deploy step in any
workflow; pushing a rebuilt `website/` is the deployment.

## Verifying a change

The generated site is committed, so a change is proven by rebuilding and finding
no diff. `.github/workflows/verify-site-build.yml` does this on every pull
request. Pagefind re-hashes its index on every run even when the indexed content
is identical, so the index is compared on coverage counts rather than bytes.

## Configuration and secrets

Anything public that changes the rendered output belongs in
`dailynews.config.js`. Environment variables are per-run operational knobs — see
`.env.example`. Secrets are credentials only, set on the repository.
