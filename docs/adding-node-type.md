# Adding a node type

This guide describes the coordinated work required to add a new value to the
IndieNodes entry `type` enum. It covers the canonical ring repository, the
official client, the embeddable widget, and submission automation.

Adding a type is not only a schema change. The current client deliberately
rejects unknown type values at runtime, and presentation, submission, and
moderation behavior branch on the type in several places.

Use a concrete identifier such as `photography` while following this guide.
Type identifiers should be lowercase, stable, and describe the media or
experience rather than a temporary program name.

## Decide the data contract first

Before editing code, decide:

- What makes an entry belong to this type.
- Whether the common fields are sufficient: `creator`, `why`, `source_url`,
  `tags`, and optionally `thumb_url`.
- Whether the type needs a new structured media field.
- Which fields are required and which are optional.
- Item limits, text limits, URL requirements, and accessibility requirements.
- How a client with no specialized renderer should represent the entry.
- Whether generated sites support this type or only creators with an existing
  site may submit it.

Prefer the existing common fields when they describe the content accurately.
A new media array creates work in every validator, health checker, submission
flow, renderer, and generator.

## Canonical ring repository

### Entry schema

Update `schema/ring.schema.json`:

1. Add the identifier to the `type` enum.
2. Define any new properties. The schema uses `additionalProperties: false`,
   so undeclared fields are rejected.
3. Add an `allOf` condition if the type requires particular fields.
4. Add useful limits and descriptions.
5. Update common-field descriptions when the new type changes their fallback
   behavior, especially `thumb_url`.

If the type uses a new media array, require meaningful alternative text for
visual media and use `$defs.externalMediaUrl` for creator-hosted media.

### URL validation and health checks

Every new URL-bearing field must be added to both:

- `scripts/validate-ring.js`, for publish-time static URL safety.
- `scripts/member-health.js`, for scheduled reachability checks.

Missing either integration would give the new media weaker protection than
existing tracks, pages, artworks, and excerpts.

### Public landing page

Update `site/index.html` and `site/styles.css` if the new type should appear
in the decorative type ring. Add its label, icon, color, and responsive
positioning.

This is presentational and does not block publishing.

### Build and validation

After adding or changing a member entry, run:

```bash
npm run ring:build
npm run validate
npm run validate:publish
npm run members:health
```

Do not publish the first entry until compatible clients and submission
automation are deployed.

## Official IndieNodes client

The official web, mobile, and desktop experiences share the IndieNodes client
codebase, but packaged versions may remain installed after a web deployment.
Older versions currently drop unknown types safely, which keeps the rest of
the ring usable but makes new-type entries invisible to those versions.

### Runtime acceptance

Update the known-type check in `src/lib/ring.js`. This is the critical gate.
Until it recognizes the new identifier, fetched entries of that type are
removed before reaching any interface.

Also update the client's mirror of `schema/ring.schema.json`.

If the new media shape contains URLs, update normalization, safe-media
filtering, cover selection, and the `RingEntry` type documentation in the
same module.

### Shared type definitions and registries

Update the type wherever it is used as a closed set, including:

- `src/lib/submissionValidation.js`: entry types and creator-facing labels.
- `src/lib/nodeShape.js`: `NodeType` and allowed aspect ratios.
- `src/skins/contracts.js`: supported node skin types.
- `src/routes/+page.svelte`: field pools grouped by type.
- Settings and ambient-mode type lists.
- Member-list and field-card labels.

Search for the full current type list and individual `entry.type` branches.
The current architecture contains several presentation-specific registries
rather than one generated registry.

### Visual language

Add:

- A primary and soft color token in `src/app.css`.
- A glyph in `TypeIcon.svelte`.
- A fallback illustration in `NodeFallbackIcon.svelte`.
- Type color rules for field nodes, empty nodes, member rows, arrange controls,
  and any ambient interface that presents the type.
- An option in the Arrange menu and Node Configuration control.
- A decision about square, portrait, landscape, or flexible node dimensions.

Decide whether the default first-visit layout should contain the new type.
Existing saved layouts will not gain a specialized node automatically. Those
users can encounter the type through an `Any` node or add its node manually.

### Node renderer

The Basic Node skin must provide and register a stage for the type:

- `src/skins/node/basic/manifest.js`
- `src/skins/node/basic/index.js`
- A new stage component under `src/skins/node/basic/stages/`

A cover-and-link type may need only a small stage. A type with playback,
sequential pages, a gallery, or another interactive experience also needs
host behavior in `FieldNode.svelte`, ambient mode, and any specialized
viewer.

The skin registry has a final text-stage fallback, but that is a crash
fallback, not a finished presentation for an unrelated type.

### Join and update flows

Update all creator-facing entry paths:

- The type selector, label, and card preview.
- The draft entry shape and persistence.
- Client-side validation.
- Conversion from form state to the canonical ring entry.
- The media step for both existing-site and generated-site branches.
- The update form.
- Tests that compare form validation with the canonical schema.

Relevant areas include:

- `src/routes/join/JoinEntryStep.svelte`
- `src/routes/join/JoinMediaStep.svelte`
- `src/lib/submissionStore.svelte.js`
- `src/lib/submissionValidation.js`
- `src/routes/update/+page.svelte`

### Site generator

If creators without a site may choose the new type, add generator support:

- Draft data derivation.
- Asset validation and packaging.
- ZIP export behavior.
- At least one compatible template.
- Template registry and scaffolding support.
- Generator fixtures and tests.

If generator support is intentionally unavailable, the join flow must state
that clearly and prevent the unsupported branch.

### Submission and moderation automation

The n8n workflow source has independent server-side controls. Update:

- The accepted-type allowlist.
- Type-specific field and media validation.
- The final member-file allowlist.
- Review-page rendering.
- Generated member JSON.
- Workflow fixtures and tests.

Regenerate and deploy the workflows from
`scripts/n8n/build_workflows.py`. Do not edit generated workflow exports as
the primary source.

### Widget and other consumers

The standalone widget uses the same runtime ring loader. It does not render
type-specific content, so after the loader recognizes the type it can include
the entry in Previous, Next, and Random navigation without a new visual
renderer.

Independent clients should treat an unknown type as an unsupported entry,
not as a fatal error for the entire ring. A generic cover, creator, and visit
presentation is preferable when the client can provide one safely.

## Rollout order

Use this order to avoid publishing entries that current clients cannot see:

1. Agree on the data contract and presentation behavior.
2. Update client runtime acceptance, renderers, forms, tests, and automation.
3. Deploy the web client, widget, and submission workflows.
4. Release packaged clients where applicable.
5. Update the canonical schema, validators, health checks, and landing page.
6. Add the first real member entry.
7. Rebuild and publish `ring.json`.
8. Verify web, mobile, desktop, widget, join, update, review, and health checks.

The ring document version can normally remain `1.0` when only the entry-type
enum expands. That version currently describes the envelope containing
`version` and `entries`, not the set of entry types. Reconsider the version
when the envelope or interpretation of existing fields changes incompatibly.

## Completion checklist

- [ ] Type identifier and qualification rule are documented.
- [ ] Canonical entry schema accepts the type and rejects malformed entries.
- [ ] New media URLs receive static safety and health checks.
- [ ] Official runtime accepts and safely normalizes the type.
- [ ] Basic Node skin renders it.
- [ ] Labels, colors, icons, filters, settings, and layout controls include it.
- [ ] Join and update flows validate and serialize it.
- [ ] Site generator supports it or explicitly excludes it.
- [ ] Submission and review automation validates and displays it.
- [ ] Widget navigation includes it.
- [ ] Unit, schema, component, workflow, and end-to-end tests pass.
- [ ] Compatible clients are deployed before the first entry is published.
- [ ] The landing page represents the type when desired.
- [ ] `ring.json` is rebuilt and passes publish validation.

## Future simplification

Type knowledge is currently distributed across schema, runtime validation,
layout rules, presentation, forms, and automation. Before adding several more
types, consider introducing a shared type registry containing:

- Identifier and creator-facing label.
- Color tokens.
- Icon.
- Allowed node dimensions.
- Media capabilities.
- Required entry fields.
- Renderer registration.
- Submission and generator support flags.

Schema and server-side security checks must remain authoritative, but a shared
registry would remove many repeated type lists and make omissions easier to
detect in tests.
