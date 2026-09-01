# Emergency member removal

Use the `Emergency member removal` GitHub Actions workflow only when a member
must be removed faster than the normal creator-request review path allows —
most often a dead or abandoned site, where nobody remains who can pass the
normal `/update` removal flow's ownership check (it re-verifies against the
site's _current_ `source_url`, which is exactly what a dead site can't
answer). It is an admin/maintainer incident tool, not an alternate membership
workflow.

## Running it

1. Go to **Actions → Emergency member removal → Run workflow**, on `main`.
2. Fill in the three inputs:
   - **member_id** — the exact id (the filename under `members/` without
     `.json`), e.g. `audio-key-jay`.
   - **reason** — 10 to 1000 characters. Recorded in the commit and the PR
     body, so write it for whoever reviews this later, not just yourself now.
   - **confirmation** — type `REMOVE ` followed by the exact member id, e.g.
     `REMOVE audio-key-jay`. This is a typo-catcher, not a security control —
     it exists so a misclick doesn't silently target the wrong member.
3. Click **Run workflow**. The job stops at the protected
   `emergency-member-removal` environment and waits for an authorized
   reviewer to approve it under **Actions → (this run) → Review deployments**.
   If you are both the requester and the only reviewer, this is still a
   deliberate pause, not a formality to click through instantly — it is the
   one moment to double-check the member id before anything is committed.
4. Once approved, the job removes `members/<id>.json`, regenerates
   `ring.json`, runs the publish validator, and opens a PR titled
   `Emergency removal: <member_id>`. Review it and merge once `validate`
   passes — GitHub won't offer the merge button until it does, same as any
   other PR against this repository.
5. Confirm the new image was actually published and the live deployment
   pulled it. **Merging this PR only updates the source ring — it does not
   itself redeploy anything.** See `indienodes-app`'s own deploy process for
   what triggers a real rebuild there.

If `members/<id>.json` is already gone from `main` (already removed, or a
typo'd id), the workflow stops immediately with no commit and no PR — safe to
re-run without double-removing anything.

## What it touches, and what it deliberately doesn't

The workflow never pushes to `main` directly: it creates a single-purpose
branch (`emergency/remove-<id>-<run-id>`), removes the one member file,
regenerates `ring.json`, runs `npm run validate:publish`, and opens a PR.
Ordinary review and this repository's `validate` check apply from there
exactly as they would to a human-authored PR — this tool skips the
_ownership-verification_ step a normal removal requires, not the review one.

It never touches member-health state, and the member-health checker (the
weekly scan and the per-PR check) never removes a member or regenerates
`ring.json` on its own either — detection and removal are two deliberately
separate systems. A health-check warning is a reason to _consider_ running
this workflow, never something that triggers it. See
`docs/member-link-health.md`.

## Required GitHub configuration

Before the first use:

1. Create an Environment named `emergency-member-removal` under **Settings →
   Environments**.
2. Add the administrators or incident reviewers who may approve an emergency
   run as required reviewers. Disable administrator bypass if the repository's
   ownership model permits it.
3. In that Environment, create a variable named
   `EMERGENCY_REMOVAL_ENABLED` with the exact value `enabled`. Keep this as an
   environment variable, not a repository-wide variable. Its absence makes
   the workflow fail closed.
4. Ensure the existing `RING_BUILD_PAT` Actions secret is limited to this
   repository and has **Contents: Read and write** and **Pull requests: Read
   and write**. The PAT is necessary so the pushed branch and opened PR trigger
   the normal pull-request workflows.

GitHub already limits manual workflow dispatch to users with repository write
access. The protected Environment supplies the additional approval gate; the
typed `REMOVE <member-id>` confirmation prevents an accidental click-through.

**`main` is protected as of 2026-08-31**, superseding an earlier draft of
this document that recorded the opposite decision. Every change — this
workflow's PR included — now requires merging through a pull request, and
`ci.yml`'s `validate` check must pass before that merge is allowed. This
workflow's own "opens a PR, never pushes to `main` directly" behavior was
already true by construction (`git switch -c ...` + `gh pr create`, not a
direct push), so the rule doesn't change how the workflow itself behaves —
what it adds is that step 4's "wait for `validate` to pass" is now something
GitHub actually enforces, not a habit to remember. See the root
[`README.md`](../README.md#making-a-change) for the general `git`/`gh` flow
this implies for everything else in this repository.
