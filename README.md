<p align="center">
  <img src="site/images/IndieNodes_Logo.webp" alt="IndieNodes logo" width="220" />
</p>

# indienodes-ring

The canonical IndieNodes ring: member records, the schemas that define what a
valid entry and a valid ring document look like, and the tooling that builds
and validates `ring.json` from them.

**A Node describes a creator. A client decides how that description is
experienced.** This repository owns the description. [indienodes-app][app] is
the official web/mobile/desktop client that reads it; other clients can too.

[app]: https://github.com/XTREEMMAK/indienodes-app

## Layout

```
members/*.json        canonical source, one file per member
schema/
  ring.schema.json           what a single entry must look like
  ring-document.schema.json  what ring.json itself must look like
scripts/
  ring-files.js        shared file-path and serialization logic
  build-ring.js         members/*.json -> ring.json
  validate-ring.js      shape + freshness validation
  member-health.js       link-health probing
  check-member-links.js  CLI wrapper around member-health.js
  n8n/backups/           checked-in n8n workflow exports (see member-link-health.md)
ring.json              generated artifact — do not hand-edit
site/                  static landing page for ring.indienodes.us
```

`ring.json` is a versioned envelope, not a bare array:

```json
{ "version": "1.0", "entries": [ ... ] }
```

## Commands

```bash
npm run ring:build       # regenerate ring.json from members/*.json
npm run validate         # shape, filename/id agreement, and aggregate freshness
npm run validate:publish # the above, and refuses placeholder entries
npm run members:health   # probe live URLs and continuing ring participation
```

## Making a change

`main` requires a pull request — a direct `git push` to it is rejected by a
repository rule, not just discouraged. This applies to every change,
including the maintainer's own; there is no bypass. Merging also requires
the `validate` check (`ci.yml`) to pass first, so a `members/`/`ring.json`
mismatch can't land on `main` at all, only get stuck on a branch until fixed.

```bash
git checkout -b fix-whatever
# ... edit, then:
git add -A
git commit -m "..."
git push -u origin fix-whatever   # pushing a branch is fine; only main is protected

gh pr create --fill               # opens the PR from the commit message
gh pr merge --auto --squash       # queues the merge; completes once `validate` passes
```

`--auto` is the part worth knowing: it doesn't merge immediately, it tells
GitHub to merge the moment the required check succeeds, so there's no need
to sit refreshing the PR page or come back and click merge separately. If
`validate` fails, the PR just sits unmerged — fix it on the same branch,
push again (`gh pr merge --auto` only needs to be run once; it stays queued
across new pushes) or run `gh pr merge --auto --squash` again if it already
returned.

Nothing about this changes `emergency-remove-member.yml` or `build-ring.yml`
— both already worked by opening a PR against a branch, never by pushing to
`main` directly, so this rule formalizes what they already did rather than
requiring anything new of them.

## Documentation

- [`docs/member-operations.md`](docs/member-operations.md) — where each kind
  of change belongs, and how to add a member by hand
- [`docs/curation-policy.md`](docs/curation-policy.md) — whether an entry
  qualifies, and the continuing-participation requirement
- [`docs/member-link-health.md`](docs/member-link-health.md) — what the
  health checker probes and how to read its warnings
- [`docs/emergency-member-removal.md`](docs/emergency-member-removal.md) —
  the narrow removal path and its required configuration
- [`docs/adding-node-type.md`](docs/adding-node-type.md): coordinated schema,
  client, renderer, submission, and rollout work for a new node type
- [`docs/webring-security-research-2026-08-31.md`](docs/webring-security-research-2026-08-31.md) —
  the security review this repo and the widget's threat model are audited against

## How a member actually joins

The `/join` and `/update` flows that prove someone controls the site their
entry points to live in [indienodes-app][app], not here — a fine-grained PAT
lets that repo's automation open pull requests against this one. Direct
contribution against `members/*.json` is also supported and is what the docs
above describe; a pull request proves no site ownership the way `/join` does,
which is the trade curation weighs.

## Status

This repository was split out of `indienodes-app` to make explicit that the
ring is not owned by any one client. As of this split, `indienodes-app` still
carries its own copy of this data pending the cutover described in that
repo's migration plan — check there for the current state of that transition
before assuming this repository is yet the one thing anything reads from in
production.
