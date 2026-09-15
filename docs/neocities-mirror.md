# Neocities mirror

`indienodes.neocities.org` is a mirror of `site/`, the same static landing page and
`/start/` guide that GitHub Pages serves at `ring.indienodes.us`. It exists so the
ring's landing page still has a home if GitHub Pages, or GitHub itself, is unavailable.
It is not a separate design: both are built from the same `site/index.html`,
`site/start/index.html`, `site/styles.css`, and `site/images/`.

## Why it carries no ring data

`ring.json`, `feed.xml`, and the schema files are generated artifacts published
alongside `site/` on GitHub Pages, but Neocities has no build step of its own to
regenerate a copy of them. Rather than push a snapshot that would go stale the moment a
member joins, `site/index.html` and `site/start/index.html` link to those files by
their absolute canonical URL (`https://ring.indienodes.us/ring.json`, `/feed.xml`,
`/schema/ring-entry.json`, `/schema/ring-document.json`) instead of by root-relative
path. On `ring.indienodes.us` this behaves identically to a relative link; on the
mirror it means those links always resolve to the live canonical data. Only the
template itself — HTML, CSS, and images — is mirrored.

## How it deploys

`.github/workflows/publish-neocities.yml` pushes everything under `site/` to Neocities
via its API (`https://neocities.org/api/upload`) on every push to `main` that touches
`site/**`, and on manual `workflow_dispatch`. It is intentionally a separate workflow
from `publish-pages.yml`, both because the two hosts have unrelated failure modes and
because the mirror's trigger is narrower — it doesn't need to run on `ring.json`,
`schema/`, or `members/**.json` changes the way `publish-pages.yml` does.

## Setup

1. Create the Neocities site at `indienodes.neocities.org` (or whatever name is
   available) if it doesn't exist yet.
2. Generate an API key for that site (Neocities dashboard → Settings → API key).
3. Add it as the `NEOCITIES_API_KEY` repository secret (Settings → Secrets and
   variables → Actions), the same way `RING_BUILD_PAT` and `APP_DISPATCH_PAT` are
   configured.

Until that secret is set, `publish-neocities.yml` runs and exits cleanly without
uploading anything — it does not fail the workflow, so merging it ahead of the
Neocities account being ready is safe.

## Recovering from a failed deploy

Run `publish-neocities.yml` manually via `workflow_dispatch` (Actions tab, or
`gh workflow run publish-neocities.yml`) to retry. As a last resort, the same files can
be pushed by hand from the Neocities dashboard's file manager, or with a one-off:

```bash
curl -sS -f -H "Authorization: Bearer $NEOCITIES_API_KEY" \
  -F "index.html=@site/index.html" \
  -F "styles.css=@site/styles.css" \
  -F "favicon.svg=@site/favicon.svg" \
  -F "start/index.html=@site/start/index.html" \
  -F "images/IndieNodes_Logo.webp=@site/images/IndieNodes_Logo.webp" \
  https://neocities.org/api/upload
```
