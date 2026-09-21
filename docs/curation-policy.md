# Curation policy: what qualifies as an IndieNode

Reviewer guidance for the private review queue, and the standard `/join` states
publicly so creators can judge themselves before spending five minutes on a form.

The short version:

> **IndieNodes does not judge popularity, polish, commercial success, or audience
> size. It only requires that a visitor have something substantive to experience
> right now.**

> These are real independent creators making real things. Whether they're good is up
> to you.

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

## Presentable, not finished

Creators must have publicly available work that has reached a presentable release
state. Works-in-progress may appear alongside an established body of work, but
concepts, pitches, placeholders, and planned projects alone are not sufficient for
membership.

"Presentable" is about release, not polish. A rough thing put out on purpose is
released; a beautiful thing not yet shown to anyone is not. Comics, serials, games,
and music are routinely ongoing, and none of that counts against a submission — the
question is only whether something has actually been put in front of people.

## By type

Judged at the Node's `source_url` — the page a visitor is actually sent to.

### Audio

At least one piece of audio a visitor can hear — music or spoken-word content
(narration, audio drama, voice work). The declared `form` (`music` or `spoken`)
is a required, shape-only field, checked the same way `type` is: **does the
declared form match the content?** That is the whole check — it is not a
judgment about which form is more worthwhile, and it never gates on quality
within a form.

**Music qualifies:** a single, an EP, an album, a finished composition, any
publicly accessible original recording.

**Music does not, on its own:** "album coming soon", a producer seeking
collaborators, a profile with no listenable music behind it.

**Spoken qualifies:** a narrated scene, an audio drama episode, an original
character voice reel, or comparable finished, publicly reachable spoken-word
work.

**Spoken does not, on its own:** a demo reel built entirely from client-owned
commercial work with no original or rights-cleared piece included (see the
pending rights-checklist item in `docs/open-questions.md` of the app repo), or
a profile announcing spoken work with nothing a visitor can actually hear yet.

**Playing inside the ring is explicitly not required, for either form.** A Node
whose audio is only reachable at its `source_url`, with no direct `media_url`
this project can play, is a fully supported shape — see EULA §5.1 and `/join`'s
own "No direct file? Skip this" path. The question is whether a visitor can
hear the audio _somewhere_, not whether IndieNodes can play it _here_.

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

## Authenticity

Separate from whether work exists is whether the Node is whose it says it is. These
fail regardless of what is behind the `source_url`:

- A Node submitted for a creator by someone unauthorized to represent them.
- Scraped, aggregated, or republished work presented as the submitter's own.
- Bulk or content-farm material — pages produced for volume rather than as a practice.
- Submissions whose declared creator, type, or site do not describe a real presence.

This is not a judgment about effort or quality. It is the same existence test applied
to the _creator_ rather than the work: is there someone there.

## Content rules that are not about quality

Revised 2026-09-17 with the content rules published on `/join`. These are creator
representations rather than reviewer taste calls, and every one of them is stated
publicly before anyone fills in the form.

- **Authorship, tested on what a visitor experiences.** Everything a visitor
  experiences in the featured work must be made by people: the music, art, writing,
  voice performances, and game design. Tools that edit or clean up human-made work,
  such as spellcheck, noise reduction, or pitch correction, are fine. Work where
  generative AI produces the music, images, text, or voices is not eligible. For
  games, AI-assisted programming is allowed as long as the art, audio, writing, and
  design are made by people.
- **Rights.** The creator must hold the rights to the works they feature. Covers,
  uncleared samples, fan work using characters the creator does not own, and
  performances owned by a client are not eligible as featured works. This is about
  the works on the Node, not about everything the creator has ever made.
- **Adult content.** A member's site may include adult content if it sits behind a
  clear content warning, and the application asks whether it does. Featured works may
  be adult content only when the Node is marked `explicit`, which keeps it hidden from
  the field, Members, Lists, and the widget until a visitor turns explicit content on
  in Settings. The disclosure is review data and never reaches `ring.json`.
- **Minors.** Sexual content involving minors, or characters depicted as minors, is
  never allowed anywhere on a member's website. There is no disclosure that makes this
  acceptable, and it is the one rule here that is a removal on sight.
- **Destination-site conduct.** The site a visitor is sent to must not host material
  attacking or degrading people, including but not limited to racism, antisemitism,
  sexism, homophobia, transphobia and TERF ideology, xenophobia, ableism, religious
  hatred, or any other hatred towards minorities.

### What the reviewer actually checks

The submission carries an attestation for authorship, for rights, and for the adult
content answer (plus a confirmation when the answer is yes). They appear on the
private review page as their own rows. The checklist items are yes/no:

- The AI attestation is checked.
- The rights attestation is checked, and no featured work is obviously a cover, fan
  work using characters the creator does not own, or client work.
- The adult content disclosure is answered, and if any featured work is adult content,
  the Node is marked `explicit`.
- No sexual content involving minors, or characters depicted as minors, is visible on
  the site.

**AI attestations are trusted at submission.** A Node is removed only on credible
evidence that featured work is generated, never on suspicion and never on the output
of a detector. There is no detection tooling, and adding one is not planned: these are
representations a creator makes, and acting on a guess would decline real work for
being unusual.

A reviewer acts on the rest of these rules when they are visible, and otherwise relies
on the representation.

## Continuing participation

Everything above is judged once, at review. One requirement continues after that:
**the ring link has to be on the page `source_url` points at, or on the home page of
that same site.** Any tier satisfies it — the full widget (framed or script), the
88×31 badge, or the plain text link.

The home page counts because members do put the ring there rather than on the page
they submitted, and a site-wide footer is the natural home for a webring. It is the
same site as the verified page (same host, `www.` aside), and a visitor who lands on
`source_url` is one click from it. This is the one exception, not a site-wide search:
no other page counts, and it does not apply to shared hosting such as
`pages.kjnet.us`, whose root is not any single member's.

Otherwise this is one page, not a site-wide obligation. A member is free to carry the
link everywhere or nowhere else; what matters is the page a visitor actually lands on.
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
limit. This document is the detail behind that clause; the EULA is what binds. §5.4
carries the authorship and destination-site representations, and §8's decline clause
reaches them by reference.

**The EULA is currently narrower than the rules above, on purpose.** §5.4 excludes work
"produced purely by generative systems", which is looser than the authorship test here,
and accepts anything a creator holds "every right and permission" for, which would admit
licensed covers and client work that the rights rule excludes. It also has no explicit
minors clause beyond compliance with applicable law. The EULA was left untouched pending
attorney review (tracked in the app repo's `docs/open-questions.md`). Until that lands,
the published rules and the attestations on `/join` are what creators agree to, and this
document is what a reviewer applies.
