<p align="center">
  <img src="site/images/IndieNodes_Logo.webp" alt="IndieNodes logo" width="220" />
</p>

<h1 align="center">IndieNodes Ring</h1>

<p align="center">
  The canonical member data, schemas, and publishing tools for the IndieNodes webring.
</p>

<p align="center">
  <a href="https://ring.indienodes.us">Visit the ring</a> ·
  <a href="#run-it-locally">Run locally</a> ·
  <a href="#member-operations">Member operations</a> ·
  <a href="#documentation">Documentation</a>
</p>

## Overview

This repository owns the canonical IndieNodes ring: one record per creator, the schemas
that define valid entries and ring documents, and the tooling that builds and validates
[`ring.json`](./ring.json).

**A Node describes a creator. A client decides how that description is experienced.**
This repository owns the description. [`indienodes-app`](https://github.com/XTREEMMAK/indienodes-app)
is the official web, mobile, and desktop client that reads it, but the data is available
to other clients too.

The ring is deliberately separate from any one interface. Member data can be reviewed,
versioned, and published on its own schedule without requiring the app or another client
to be rebuilt.

## How it works

Each file in `members/` is a canonical member record. The build script combines those
records into a versioned document and the validation scripts ensure the source files and
generated artifact stay in sync.

```text
members/*.json ──> build-ring.js ──> ring.json ──> ring.indienodes.us
                         │                │
                         └──── schemas ───┘
                                          │
                    ┌─────────────────────┼─────────────────────┐
                    ▼                     ▼                     ▼
              indienodes-app        member widget          other clients
```

`ring.json` is a generated, versioned envelope rather than a bare array:

```json
{
	"version": "1.0",
	"entries": []
}
```

Do not edit it by hand. Change the corresponding file in `members/`, then rebuild the
aggregate.

## Repository layout

```text
members/*.json                Canonical source; one file per member
schema/
  ring.schema.json            Schema for a single entry
  ring-document.schema.json   Schema for the generated ring document
scripts/
  ring-files.js               Shared file-path and serialization logic
  build-ring.js               Builds ring.json from members/*.json
  build-feed.js               Builds feed.xml, the "what's new" RSS feed
  validate-ring.js            Validates shape, filenames, and freshness
  member-health.js            Probes member links and ring participation
  check-member-links.js       Command-line wrapper for health checks
  n8n/backups/                Checked-in member-health workflow exports
ring.json                     Generated artifact; do not hand-edit
feed.xml                      Generated at publish time; never committed
site/                         Static site for ring.indienodes.us
```

## Run it locally

You need Node.js and npm. Install the development dependencies, then validate the
committed ring:

```bash
npm install
npm run validate
```

### Common commands

| Command                    | Purpose                                                       |
| -------------------------- | ------------------------------------------------------------- |
| `npm run ring:build`       | Regenerate `ring.json` from `members/*.json`                  |
| `npm run feed:build`       | Regenerate `feed.xml`, the "what's new" RSS feed              |
| `npm run validate`         | Check schemas, filename/id agreement, and aggregate freshness |
| `npm run validate:publish` | Run validation and reject placeholder entries                 |
| `npm run members:health`   | Probe live URLs and continuing ring participation             |
| `npm test`                 | Run the automated tests                                       |

## Member operations

The `/join` and `/update` flows live in
[`indienodes-app`](https://github.com/XTREEMMAK/indienodes-app). They prove that a creator
controls the site their entry points to, then use the app's automation to open a pull
request against this repository.

Direct contributions to `members/*.json` are also supported. A hand-written pull request
does not prove site ownership in the way `/join` does, so reviewers must account for that
tradeoff. The [member operations guide](./docs/member-operations.md) explains where each
kind of change belongs, how the safeguards work, and how to add a member by hand.

For a member-data change, rebuild and validate before opening a pull request:

```bash
npm run ring:build
npm run validate:publish
```

Commit the member file and the regenerated `ring.json` together.

## Contributing

`main` is protected. Every change, including maintainer changes, must arrive through a
pull request and pass the required `validate` check before it can merge.

```bash
git checkout -b fix-whatever
# Make the change, then:
git add -A
git commit -m "Describe the change"
git push -u origin fix-whatever

gh pr create --fill
gh pr merge --auto --squash
```

Auto-merge queues the pull request and completes it when the required check succeeds. If
validation fails, fix the issue on the same branch and push again; the pull request stays
unmerged until its checks pass.

The automated `build-ring.yml` and emergency-removal workflows already work through
pull requests rather than direct pushes to `main`.

## Documentation

- [Member operations](./docs/member-operations.md) — where each kind of member change
  belongs and how to add a member by hand.
- [Curation policy](./docs/curation-policy.md) — which entries qualify and what continuing
  participation requires.
- [Member link health](./docs/member-link-health.md) — what the health checker probes and
  how to interpret its warnings.
- [The "what's new" feed](./docs/whats-new-feed.md) — how `feed.xml` and `joined_at` work,
  and the backfill limitation for members that predate the field.
- [Emergency member removal](./docs/emergency-member-removal.md) — the narrow removal path
  and its required configuration.
- [Adding a Node type](./docs/adding-node-type.md) — coordinated schema, client, renderer,
  submission, and rollout work for a new medium.
- [Webring security research](./docs/webring-security-research-2026-08-31.md) — the review
  against which this repository and the widget threat model are audited.

## Project status

This repository was split from `indienodes-app` so the ring is not owned by any one
client. The app may retain a fallback mirror of the data, but this repository is the
canonical source and publishes independently at
[`ring.indienodes.us`](https://ring.indienodes.us).

## License

IndieNodes Ring is licensed under GPL-3.0-or-later. See [`LICENSE`](./LICENSE).
