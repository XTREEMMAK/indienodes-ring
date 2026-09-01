# The "what's new" feed

`feed.xml`, published at `https://ring.indienodes.us/feed.xml`, is an RSS 2.0
feed of new members joining the ring. It exists because the ring itself had
no way to answer "what's new here" — `ring.json`'s only order is submission
order, and the app's own member directory sorts alphabetically instead,
specifically because submission order is meaningless to a reader. `joined_at`
is the field that makes both the feed and a future "recently added" view
possible.

## What it is, and isn't

New members only, not new-and-updated. RSS 2.0 has no Atom-style separate
"updated" element distinct from `pubDate` — reusing `pubDate` for an edit
would make an already-read item reappear as unread in most feed readers, a
real regression, not a technicality. `updated_at` exists in the schema for
when that changes, but nothing auto-sets it yet (see below), and the feed
doesn't use it.

## Where `joined_at` comes from

`joined_at` is a required field on every member entry, stamped automatically
by `scripts/build-ring.js` the first time a member file is built without one
— never hand-edited, the same way `verification_token` is explicit rather
than derived. This is not computed from git history: `validate-ring.js`
compares a fresh rebuild of `ring.json` byte-for-byte against the committed
one on every run, and a value that could differ depending on checkout depth
(as a `git log`-derived date would) would make that comparison
checkout-depth-dependent and fail intermittently. An explicit, stored,
idempotent field avoids that entirely.

Because `build-ring.yml` already commits members and `ring.json` together
whenever `ring:build` changes either one, this needs no new automation: the
stamp happens on the same run that already builds and commits everything
else, for every existing entry path (a same-repo pull request, a fork
contributor's own local `ring:build` before opening theirs, or a maintainer
adding a member by hand).

`updated_at` is optional and **not** auto-set. Detecting "was this edit
substantive" cheaply is genuinely ambiguous with the tooling that exists
today (indistinguishable from a pure formatting pass), so it stays an
explicit field a human, or `indienodes-app`'s `/update` flow, can set when
they know an edit is real.

## The backfill limitation

`audio-key-jay` and `comic-kjc-comix` predate this field. Their `joined_at`
is the date this feature shipped, not their true historical join date, which
isn't reliably recoverable. Every member added after this feature exists
gets an accurate `joined_at`.

## Building it

```bash
npm run feed:build   # writes feed.xml at the repo root; never committed
```

`feed.xml` is a publish-time artifact, generated fresh by
`.github/workflows/publish-pages.yml` on every deploy — the same posture
`ring.json`'s old inline `index.html` had before `site/` existed. It carries
no "byte-for-byte matches the committed version" invariant the way
`ring.json` does, because nothing commits it in the first place.

## Related

- [`member-operations.md`](./member-operations.md) — where `joined_at` sits
  among the fields a maintainer shouldn't hand-edit.
