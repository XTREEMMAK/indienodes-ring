# Member operations: where to add, change and remove entries

Every member exists twice: as one file under `members/`, and as one object inside the
generated `ring.json`. `members/*.json` is the source and `ring.json` is built from it by
`npm run ring:build`. The two must move together in the same commit — the app, the
widget and every other client read only `ring.json`, so a change that never reaches it is
a change that never happened.

That is the whole rule. Everything below is what enforces it, what does not, and what
breaks when it is worked around.

## Where each operation belongs

| Operation                     | Do it here                                                 | Not here                           |
| ----------------------------- | ---------------------------------------------------------- | ---------------------------------- |
| A creator joins               | `/join`                                                    | Hand-written member file           |
| A creator changes their entry | `/update`                                                  | Editing their file for them        |
| A creator leaves              | `/update`'s removal step                                   | Deleting the file directly         |
| Fixing a typo in copy         | Pull request against `members/`                            | A push that skips `ring:build`     |
| Correcting a broken URL       | Ask the creator to use `/update`                           | Editing it yourself                |
| Removing a member for cause   | `emergency-remove-member.yml`                              | Direct push to `main`              |
| Adding a member yourself      | [By hand, with the checks below](#adding-a-member-by-hand) | Assuming `/join` already proved it |
| Trying something locally      | Any branch, never merged                                   | `main`                             |

`/join` and `/update` are the only paths that prove the person asking controls the site
the entry points at. Everything else is a maintainer acting on someone's behalf, which is
sometimes right and is never the same thing.

## What actually guards each path

| Path                          | `ring.json` rebuilt                        | Validated                              | Ownership proven                                       |
| ----------------------------- | ------------------------------------------ | -------------------------------------- | ------------------------------------------------------ |
| `/join`, `/update`            | Yes, by the approval workflow              | Yes, on the PR it opens                | **Yes** — token placed at the entry's own `source_url` |
| Pull request, same repo       | Yes, by `build-ring.yml`                   | Yes, by `validate-ring.yml`            | No                                                     |
| Pull request, from a fork     | **No** — run `npm run ring:build` yourself | Yes, and it fails on a stale aggregate | No                                                     |
| `emergency-remove-member.yml` | Yes                                        | Yes, on the PR it opens                | Not applicable                                         |

`main` is protected by a repository rule as of 2026-08-31: every change goes through a
pull request, and merging requires `ci.yml`'s `validate` check to pass first. There is no
direct-push path anymore, admin included — see the root
[`README.md`](../README.md#making-a-change) for the `git`/`gh` commands. Because `validate`
is now required to merge, a `members/`/`ring.json` mismatch blocks the merge outright
rather than landing on `main` and failing after the fact.

Nothing rebuilds `ring.json` for a same-repo pull request that only edits `members/` by
hand — `build-ring.yml` does that for you automatically. A fork's pull request is skipped
by `build-ring.yml` deliberately, since it cannot be handed the credential that pushes
back to a branch it does not own — **so a fork contributor must run `npm run ring:build`
themselves and commit the result in the same commit**, which is why that row says so and
why `validate-ring.yml` failing on a stale aggregate is the safety net rather than an
inconvenience.

## What breaks when it goes wrong

| Mistake                              | What happens                                                              | How you find out                                                     |
| ------------------------------------ | ------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Edited `members/` without rebuilding | `ring.json` still serves the old entry                                    | `npm run validate` — "ring.json is out of date with members/\*.json" |
| Edited `ring.json` by hand           | Next rebuild silently reverts it                                          | Same check, same message                                             |
| Deleted a member file, no rebuild    | They stay in the ring, still linked                                       | Same check                                                           |
| Opened a PR without rebuilding       | The PR can't merge — `main` is protected and requires `validate` to pass  | The PR's own checks, before it ever reaches `main`                   |
| Changed an existing `id`             | Their widget's `site-id` matches nothing, and `/update?node=` links break | `members:health` reports `ring_widget_site_id_unmatched`             |
| Invented a `verification_token`      | Their page does not carry it                                              | `members:health --check-tokens` warns until they place it            |
| Added a member by pull request       | Nobody proved they own the site                                           | Never, automatically — that is the trade                             |

## Adding a member by hand

Sometimes a creator cannot use `/join` — the form is down, their setup fights it, or they
reached you some other way. Adding them yourself is supported. What it is not is
equivalent: **`/join` proves things a hand-written entry merely asserts**, and when you add
someone directly, you are the one making those assertions.

`/join` refuses to publish until a token it issued appears on the page the entry points
at. That is the entire ownership proof, and both a pull request and a direct commit skip
it. Doing this by hand means you have satisfied yourself by other means that the person
asking controls that site — and that their page carries a ring link, or the ring stops at
them.

The checker already knows how to confirm both. Point it at the one file:

```bash
npm run members:health -- --no-state --failure-threshold 1 --check-tokens members/their-id.json
```

That probes every URL in the entry, confirms the page carries a supported ring link (the
full widget, the 88×31 badge, or the text link), and with `--check-tokens` confirms the
`indienode-verification` meta tag matches the file's `verification_token`. A clean run is
the manual equivalent of what `/join` automates.

The order that works:

1. Agree the entry qualifies — [`curation-policy.md`](./curation-policy.md).
2. Write `members/<id>.json`. The `id` must match the filename, and is what their widget's
   `site-id` will have to say.
3. Choose a `verification_token`, and have them add both it and a ring link to the page
   `source_url` points at.
4. Run the health command above **before committing anything**. A warning here is the
   check doing its job.
5. `npm run ring:build`, then `npm run validate:publish`.
6. Commit the member file and `ring.json` together, on a branch — `main` no longer takes a
   direct push, admin included. Push the branch, `gh pr create --fill`, then
   `gh pr merge --auto --squash` (see the root [`README.md`](../README.md#making-a-change)).
   If you forget the rebuild, the `pre-push` hook stops you before the branch push, and
   `validate` blocks the merge either way if it somehow got past that.

Step 4 is the one that matters. Everything else fails loudly on its own; that one fails
silently, months later, as a member whose site never linked onward — and by then the
entry looks established rather than unverified.

## Fields a maintainer should not touch

`id` and `verification_token` are not editorial. Both are load-bearing outside this
repository:

- **`id`** is what a member's embedded widget carries as its `site-id`, and how `/update`
  finds their entry. Changing it after publication silently breaks the widget on a site
  you do not control. If an id truly must change, treat it as a removal and a rejoin.
- **`verification_token`** is the string that must appear in a `<meta
name="indienode-verification">` tag on the member's own page. It is public by design —
  it proves nothing on its own, because every check reads it _from the page at the entry's
  stored `source_url`_, never from anything a caller supplies. Rewriting it here does not
  change what is on their site; it only makes the health check disagree with reality.
- **`joined_at`** is machine-managed the same way: `npm run ring:build` stamps it once,
  automatically, the first time a member file is built without one. Hand-editing it back-dates
  or forward-dates that entry in [the "what's new" feed](./whats-new-feed.md) without changing
  anything real about when it joined.

Everything else — `creator`, `why`, `tags`, media URLs, and `updated_at` — is ordinary
content. The creator can change most of it themselves through `/update`; `updated_at`
specifically is meant to be set deliberately (by `/update`, or by a maintainer editing by
hand) whenever an edit is substantive enough to be worth noting, since nothing sets it
automatically.

## Commands

```bash
npm run ring:build       # regenerate ring.json from members/*.json
npm run validate         # shape, filename/id agreement, and aggregate freshness
npm run validate:publish # the above, and refuses placeholder entries
npm run members:health   # probe live URLs and continuing ring participation
```

Run `ring:build` and `validate` together before opening any pull request that touches
`members/`. On a fork, that is not optional — nothing else will do it for you.

A `pre-push` hook runs `validate:publish` for you and refuses a push that would take a
stale ring with it. `npm install` enables it (`scripts/install-hooks.mjs` points git at
`.githooks/`), so a fresh clone gets it without a setup step. It is the same check CI
runs, one step earlier — early enough that the fix is `ring:build` and an amend rather
than a follow-up commit correcting the first one.

Two things to know about it. It validates the working tree rather than the commits being
pushed, so uncommitted drift blocks a push as well; that is the intended bias, since a
dirty ring is worth knowing about either way. And it is a local convenience, not a
control: `git push --no-verify` skips it, and `git config --unset core.hooksPath` turns
it off. CI is the check that cannot be skipped.

## Related

- `curation-policy.md` — whether an entry qualifies at all, and the continuing
  participation requirement.
- `submission-form-spec.md` — the `/join` contract, and how `id` and
  `verification_token` are assigned.
- `member-link-health.md` — what the health checker probes and how to read its warnings.
- `emergency-member-removal.md` — the narrow removal path and its required configuration.
