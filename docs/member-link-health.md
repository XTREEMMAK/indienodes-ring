# Member link health

The checker lives in this repository; Semaphore only schedules it. This keeps
the knowledge of member fields beside the schema and makes the same command
usable locally, in pull requests, and from operations tooling.

## What it checks

For every non-placeholder file under members/, the checker probes:

- source_url
- thumb_url
- preview_url
- every tracks[].media_url
- every pages[].image_url

URLs shared by more than one field are fetched once and reported with every
reference. Requests use GET with Range: bytes=0-0 when the response body is not
needed, so an audio or video check does not download the whole asset. Redirects
are followed up to five hops, with every target checked against private,
loopback, link-local, and reserved addresses before it is requested.

The result classes are deliberately conservative:

- Healthy: a final 2xx response.
- Broken: a final 404 or 410 response.
- Warning: timeouts, DNS/TLS failures, 401/403, 429, 5xx, unsafe addresses,
  redirect problems, the three participation results below, and optional
  missing-token results.

Warnings are visible but do not fail the command. A broken URL must repeat on
three consecutive stateful runs before the command exits with an alert. Any
healthy or uncertain result resets that URL's definite-failure streak. Nothing
automatically removes a member or edits ring data.

Continuing participation is checked by default on source pages. The checker
recognizes three tiers: a full `<indienode-widget>` whose `site-id` matches the
member, an `<iframe>` whose `src` is `indienodes.us/embed-frame?site-id=<id>` for
that same member, and the canonical `/go/random` link used by the script-free
badge and text-link tiers. A `site-id` is matched case-insensitively and trimmed
in both embed tiers, and `href`/`src` are resolved against the page's own final
URL, so a protocol-relative `//indienodes.us/go/random` counts where it previously
did not. Note that a root-relative `/go/random` or `/embed-frame` resolves to the
member's _own_ site and is correctly not a ring link. Absence is a warning for
human review, never an automatic removal. Use `--no-participation-check` only for
a deliberately availability-only run.

The frame tier is not an afterthought: it is the integration
[`webring-security-research-2026-08-31.md`](./webring-security-research-2026-08-31.md)
recommends as the default, since a sandboxed cross-origin frame cannot reach the
host page the way the script widget can. It went unrecognized here until
2026-09-01 — only `<a>` hrefs were inspected for a ring destination, and an
`<iframe src>` is not an `<a>` — so a member carrying the _recommended_ embed was
reported as not participating at all.

Only `source_url` is checked, which is the requirement rather than a shortcut: it
is the one page whose ownership was proven, and the one page visitors are sent to.
See `curation-policy.md`, "Continuing participation." There is deliberately no
second field naming where a member put their widget, and the checker does not crawl
looking for one — a crawl would need robots handling, depth and politeness budgets,
and a far wider address-screening surface than the single-URL model above, and
"absent after N pages" would still not be proof of absence.

### The three participation warnings, and how to triage them

Participation produces three distinct reasons, because "we did not find it" and
"there is nothing there" are different claims and only one of them is ever certain.

| Reason                             | What it means                                                                                           | Usual fix                                          |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| `ring_widget_site_id_unmatched`    | The page carries a ring embed — widget or `/embed-frame` iframe — whose `site-id` matches no member id. | Tell the member to correct one attribute.          |
| `ring_participation_indeterminate` | Nothing was found, **and** the page hit the read limit before the end.                                  | Open the page and look. The checker does not know. |
| `ring_participation_missing`       | Nothing was found in a page read to completion.                                                         | Ask the member to add a ring link.                 |

The most likely of the three is the first, and it is largely our own doing. The
`/widget` page hands out the snippet with `site-id="your-ring-entry-id"`, a
placeholder meant to read as something to fill in. A member who pastes it unedited
gets a widget that renders and works — `Widget.svelte` falls back to a random index
for an unknown id — so nothing on their site looks wrong. The `<a>` fallback cannot
rescue it either: the full widget builds its `/go/random` link at runtime, so it is
never in the served markup. Reported as a missing embed, this would send a
maintainer hunting for something already on the page.

`ring_participation_indeterminate` exists because the body read stops at
`MAX_SOURCE_BYTES` (2 MB, decompressed) and cancels the stream. Ring embeds are
usually in the footer, which is last, so a page that runs long — heavy inline
data, a large hydration payload, inlined base64 media — is exactly the shape where
the marker sits past the cut. That is not evidence of absence and is no longer
reported as if it were. If truncation turns out to be common in practice, raising
`MAX_SOURCE_BYTES` is a one-constant change.

### Known limitation: the check reads HTML, not a rendered page

Participation is matched against the HTML as served; no JavaScript runs. The
distinguishing factor is **server rendering, not templating.** A site built with
Next, Astro, Nuxt, SvelteKit, Gatsby, or any other SSR/SSG framework puts its
footer template into the served HTML and passes normally — which covers most of
the modern ecosystem, and creators lean that way for search visibility anyway.

The narrow case that fails is a **client-rendered-only** site, where the document
is a shell and the footer is assembled in the browser. Templating is precisely
what does not help here: the link is on every _rendered_ page and in _zero served
documents_. Tag-manager or other script injection fails the same way, as do the
badge and text tiers, since the `<a>` also has to be in the served markup.

This produces a false `ring_participation_missing` against a member who is
genuinely participating. It is a known cost of not executing untrusted pages, and
the conservative design absorbs it: participation is warning-only, reviewed by a
human, and never removes anyone. **Confirm in a browser before acting on any of
these three warnings.** Server-rendering the link, or putting it in a static part
of the document, is the member-side fix.

## Commands

```bash
npm run members:health
npm run members:health -- --json
npm run members:health -- --check-tokens
npm run members:health -- --help
```

By default, consecutive results are stored in .member-health-state.json, which
is ignored by Git. For a one-run pull-request check:

```bash
npm run members:health -- --no-state --failure-threshold 1 members/audio-example.json
```

Exit codes:

- 0: no URL has reached the alert threshold; warnings may still be present.
- 1: at least one 404/410 has reached the configured threshold.
- 2: invalid arguments, member selection, state, or another checker failure.

Participation and token retention are separate. Participation is checked by
default. With `--check-tokens`, source pages are also read up to 2 MB and checked
for the same `indienode-verification` meta tag recognized by intake. A missing
token is a warning, not a dead link, because availability, current ring
participation, and continuing ownership are different questions.

## Scheduled runs

Two exist, answering different questions:

- **`member-link-health.yml`** checks only the member files a pull request adds
  or modifies, so a bad URL cannot be merged. It never revisits an entry.
- **`member-health-scheduled.yml`** checks the whole ring weekly, plus on demand
  via workflow dispatch. GitHub's runner is disposable, so it holds no state
  between runs and the three-strike threshold cannot apply: it reports every
  result to the job summary and fails only on a definite 404/410.

Something else needs to hold the stateful run's three-strike threshold across
jobs, since `member-health-scheduled.yml`'s own runner can't. Semaphore was
tried first and abandoned: its Bash tasks run in a non-login shell that never
sources the profile a version-manager Node (nvm/asdf/volta) needs to reach
`PATH`, and on the runner actually in use Node wasn't installed at all —
fixable only by customizing Semaphore's own image/host, which its operator
didn't want to take on as ongoing maintenance.

## External scheduler (n8n)

`member-health-scheduled.yml`'s `workflow_dispatch` takes an optional
`resume_url` input (default `''`, so the weekly cron and a plain manual
dispatch are unaffected). When set, a final step POSTs `health.json` to it.
This lets an external scheduler hold state without this repository needing to
know what that scheduler is.

This is **two** n8n workflows, not one, both checked in under
`scripts/n8n/backups/` (import them; credentials are stripped on export and must
be re-selected after import, and both must be **published** before their triggers
go live):

`member-health-dispatcher.json` — fires and forgets:

1. **Schedule Trigger** — weekly, ahead of the `0 7 * * 1` fallback cron above
   so that cron stays a true fallback rather than a race.
2. **HTTP Request** — dispatches this workflow via the GitHub API, passing the
   receiver's static webhook URL as `resume_url`. Auth is a fine-grained PAT
   (Actions: read/write, scoped to this repo only) stored in n8n's own
   credential store — not a repository or Actions secret.

`member-health-receiver.json` — a plain webhook trigger at
`/webhook/indienodes-member-health`, the URL the dispatcher hands to GitHub:

3. **Webhook** — responds immediately; the GitHub job never reads the response.
4. **Code node** ("Track streaks") — tracks the three-consecutive-`broken`
   streak per URL in `$getWorkflowStaticData('global')`, replacing `--state`.
   The streak history therefore lives in the receiver, which is the workflow
   that runs every time. When a URL crosses the threshold, it also stashes the
   alert detail under a random token in `staticData.reports` and builds
   `reportUrl`, so the next step's push can stay short.
5. **IF** — only alerted URLs continue to the next step.
6. **Gotify** (the native n8n node, not a raw HTTP request) — a short markdown
   push: `"N member link(s) crossed the failure threshold.\n\n[Full
report](<reportUrl>)"`. Not `clickUrl`: that Options field doesn't exist in
   the Gotify node as shipped in n8n 2.36.9 (it's on a newer, unreleased-as-run
   version — confirmed against the actual `2.36.9`-tagged source, not
   `master`), so setting it gets silently dropped the next time the workflow
   is opened and saved. Markdown content type with an inline link is what this
   version's node actually supports. The tradeoff is real: the raw OS push
   banner shows unrendered markdown syntax, and the link only becomes tappable
   once the message is opened in a client that renders markdown (confirmed for
   the web UI and the Android app).

Two more nodes in the receiver render that report:

7. **Webhook** (GET) at `/webhook/indienodes-member-health-report?token=<token>`
   — reads `staticData.reports[token]` and builds an HTML page styled to match
   the rest of the IndieNodes admin surface (the CSS is ported from
   `indienodes-app`'s `scripts/n8n/build_workflows.py`, the same `review_style`
   block `Webring - Review Action v2` uses for its own approve/reject pages),
   listing every alerted URL, its reason, streak, and member file. An unknown
   or pruned token renders a plain "not found or expired" page in the same
   style rather than an error. Unauthenticated by design — there's no login
   system on this n8n instance for it to check against — gated only by the
   token being an unguessable value that's never logged anywhere public.
   Reports self-prune after 30 days.
8. **Respond to Webhook**, `Content-Type: text/html`.

### Testing the alert without a real failure

Two more nodes exist purely for this and are meant to be temporary — delete
`TEST trigger (delete when done testing)` and `TEST: seed near-threshold
streak`, and the one connection they add into `Track streaks`, once you're
done exercising the flow:

```bash
curl -X POST https://n8n.kjnet.us/webhook/indienodes-member-health-test-trigger
```

This seeds a fake URL's streak to 2 in the same static data `Track streaks`
reads, then hands it a synthetic already-broken result for that URL — so the
node's own `+ 1` is what crosses the real threshold of 3. Every step after
that point (streak math, report storage, the Gotify push, the report page) is
the genuine production code path; only the input is fake. This is
deliberately not a shortcut that skips straight to "send an alert" — a
shortcut like that would only prove Gotify credentials work, not that the
feature works.

### Why two workflows instead of one Wait node

The obvious shape is one workflow that dispatches, pauses on a **Wait** node
resuming from `{{ $execution.resumeUrl }}`, then alerts. That was the original
design and it does not work on n8n 2.x: resuming a paused execution runs an
internal project-ownership permission check that still queries a `user.role`
column n8n's own `RemoveOldRoleColumn` migration deleted, so the resume fails
with `column ... role does not exist` (upstream bug, see
[n8n#20697](https://github.com/n8n-io/n8n/issues/20697), reported there against a
different trigger). The webhook resume returns a misleading
`404 ... does not contain a waiting webhook` while the execution sits in the UI
looking like it is still waiting, and the 20-minute ceiling then expires.

Splitting the flow sidesteps it entirely: nothing ever pauses, so nothing ever
resumes. A static production webhook starts a **fresh** execution, which is the
ordinary trigger path every other workflow uses. It is also simply more robust —
the URL does not expire, carries no per-execution signature, survives n8n
restarts, and imposes no deadline on how long the GitHub job may take.

`member-health-scheduled.yml` needs no change for this. Its `resume_url` input
only ever gets `curl`'d, and never cared whether the URL was an n8n resume URL or
an ordinary webhook; the name is now a slight misnomer.

The existing /update flow is how a creator replaces a dead resource after a
maintainer confirms the report.
