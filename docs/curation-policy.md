# Curation policy: what qualifies as an IndieNode

Reviewer guidance for the private review queue, and the standard `/join` states
publicly so creators can judge themselves before spending five minutes on a form.

The short version:

> **IndieNodes does not judge popularity, polish, commercial success, or audience
> size. It only requires that a visitor have something substantive to experience
> right now.**

## Proof of creation, not proof of success

It is tempting to describe this as wanting "proven" creators, but that word carries
implications this project does not intend. None of the following is required, and
none may be used as a reason to decline a submission:

- Commercial release or any sales
- Professional credits or industry recognition
- An existing audience, following, or traffic
- High production values
- Critical approval
- A finished or complete work

What is required is narrower and factual: **something exists, and someone can
experience it.** That is the whole test.

## The single question

For any submission, of any type:

> **Can a visitor meaningfully experience this as creative work, rather than
> merely see evidence that development has started?**

The dividing line is not _prototype vs. demo_, or _amateur vs. professional_. A
polished fifteen-minute game-jam release qualifies even though it is tiny. A
technically sophisticated greybox movement prototype does not, if there is no
experience to have yet.

## By type

Judged at the Node's `source_url` — the page a visitor is actually sent to.

### Audio

At least one piece of music a visitor can hear.

**Qualifies:** a single, an EP, an album, a finished composition, any publicly
accessible original recording.

**Does not, on its own:** "album coming soon", a producer seeking collaborators, a
profile with no listenable music behind it.

**Playing inside the ring is explicitly not required.** A Node whose audio is only
reachable at its `source_url`, with no direct `media_url` this project can play,
is a fully supported shape — see EULA §5.1 and `/join`'s own "No direct file? Skip
this" path. The question is whether a visitor can hear the music _somewhere_, not
whether IndieNodes can play it _here_.

### Writing

At least one substantive readable work: a short story, an essay, a serialized
chapter, a novella, a book, or comparable finished or publicly readable writing.

Announcing that a novel is being written is not sufficient by itself.

### Comics and visual art

Work a visitor can actually look at: a finished illustration, a portfolio, a short
comic, several substantial pages, a completed issue, or any publicly viewable
visual project.

Professional publication is not required.

### Games

A publicly playable build. The project does not need to be finished, and does not
need to be formally labelled a demo.

**Qualifies:** a finished game, an Early Access release, a vertical slice, a game
jam entry, a substantial demo, a public alpha, or a small but complete playable
experience.

**Does not:** screenshots alone, design documents, concept art, a teaser trailer
with no playable build behind it, a devlog, an announced project with no release,
or a technical experiment not intended to function as an experience.

## Continuing participation

Everything above is judged once, at review. One requirement continues after that:
**the ring link has to be on the page `source_url` points at.** Any of the three
tiers satisfies it — the full widget, the 88×31 badge, or the plain text link.

This is one page, not a site-wide obligation. A member is free to carry the link
everywhere or nowhere else; what matters is the page a visitor actually lands on.
That page is the requirement for two reasons, and both are structural rather than
administrative:

- **It is the only page whose ownership was proven.** The verification token was
  issued against `source_url` and checked there, and `verify` deliberately uses the
  stored URL rather than one supplied at check time (`submission-form-spec.md`
  section 7). A ring link on some other page is an unverified claim about a page
  nobody confirmed the member controls.
- **It is the only page traffic is sent to.** The link exists to pass a visitor
  onward to the next member. On a page IndieNodes never routes anyone to, it
  circulates nothing, so the ring is broken there whether or not anyone can find it.

For a creator whose site IndieNodes generated, this is automatic: the embed ships in
the generated page's footer, and that page is `source_url`. For a creator with their
own site, it is the one placement instruction `/join` gives.

Absence is a warning for human review, never an automatic removal — see
`member-link-health.md`, including the cases where the checker can miss a link that
is genuinely there. `/update` is how a member corrects one.

## What the tooling does and does not check

Nothing here is automated, and no part of it is enforced by
`npm run validate:publish`.

The schema (`schema/ring.schema.json`) checks **shape**, not substance: that a
comic has at least one page, that a game has a `thumb_url`, that media URLs are
`https://` and not hosted on this project's own domain. It cannot tell whether a
`source_url` leads to a playable game, a readable story, or a page saying the
game is coming soon. It never will.

**Every judgment in this document is a human one, made once, in the review
queue.** That is the only place it can be made, and it is why the standard is
written as guidance a person applies rather than as rules a validator enforces.

## Why this exists

A common failure of creator directories is that browsing them turns up intentions
rather than work: empty portfolios, announcements, profiles about future plans.
Each one costs a visitor a click and returns nothing, and enough of them teach
people to stop clicking.

This standard is what lets "open a random node" carry an implicit promise —
**there will be something here** — without IndieNodes ever having to decide
whether that something is any good.

## Where this is binding

EULA §8 ("Moderation Standard") carries this as the fourth item on the review
checklist, worded to test existence rather than merit, and §8's own statement that
review is "not an editorial quality judgment" remains true because of that
limit. This document is the detail behind that clause; the EULA is what binds.
