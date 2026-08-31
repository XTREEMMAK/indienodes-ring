#!/usr/bin/env node
// Fails loudly on a malformed ring.json entry. This is the mechanical half
// of the thin-moderation rule from the brief: the schema enforces shape so
// a human never has to argue about quality.
//
// Two modes, and the split is deliberate:
//
//   node scripts/validate-ring.js            shape only
//   node scripts/validate-ring.js --publish  shape, plus publish-readiness
//
// `--publish` additionally rejects any entry marked `_placeholder: true`.
// That check cannot live in the default mode, because `ring.json` legitimately
// carries seed entries today: they are what gives the field view content
// before real members exist, so a blanket rule would fail the repo against
// itself and train everyone to ignore the validator.
//
// The risk being guarded is narrower than "placeholders exist" anyway. It is
// "placeholders reach the live ring", which happens at exactly one moment, so
// that is where the gate belongs. Wire this into the publishing pipeline when
// it exists; see docs/open-questions.md for what still has to be decided
// about that pipeline.

import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { loadMembers, RING_PATH, ROOT, serializeRing } from './ring-files.js';
import { assertStaticallySafeUrl } from './member-health.js';

/**
 * Every URL an entry carries, tagged with where it came from for a useful
 * error message. Schema `pattern`s already require `https://`; this exists
 * for what a regex pattern cannot cleanly express -- a private/reserved IP
 * literal, a `localhost`-shaped hostname, embedded credentials -- without
 * hand-copying the private-IP-range table Ajv can't see into a schema
 * pattern too. See `assertStaticallySafeUrl` in `member-health.js`, which
 * this reuses rather than duplicates.
 * @param {Record<string, unknown>} entry
 * @returns {{ field: string, url: string }[]}
 */
function urlsIn(entry) {
	/** @type {{ field: string, url: string }[]} */
	const found = [];
	for (const field of ['source_url', 'thumb_url', 'preview_url']) {
		if (typeof entry?.[field] === 'string') found.push({ field, url: entry[field] });
	}
	for (const [i, track] of (entry?.tracks ?? []).entries()) {
		if (typeof track?.media_url === 'string') {
			found.push({ field: `tracks[${i}].media_url`, url: track.media_url });
		}
	}
	for (const [i, page] of (entry?.pages ?? []).entries()) {
		if (typeof page?.image_url === 'string') {
			found.push({ field: `pages[${i}].image_url`, url: page.image_url });
		}
	}
	for (const [i, artwork] of (entry?.artworks ?? []).entries()) {
		if (typeof artwork?.image_url === 'string') {
			found.push({ field: `artworks[${i}].image_url`, url: artwork.image_url });
		}
		if (typeof artwork?.external_url === 'string') {
			found.push({ field: `artworks[${i}].external_url`, url: artwork.external_url });
		}
	}
	for (const [i, excerpt] of (entry?.excerpts ?? []).entries()) {
		if (typeof excerpt?.audio_url === 'string') {
			found.push({ field: `excerpts[${i}].audio_url`, url: excerpt.audio_url });
		}
	}
	return found;
}

const entrySchema = JSON.parse(
	readFileSync(new URL('../schema/ring.schema.json', import.meta.url))
);
const documentSchema = JSON.parse(
	readFileSync(new URL('../schema/ring-document.schema.json', import.meta.url))
);
const ringSource = readFileSync(RING_PATH, 'utf8');
const ringDocument = JSON.parse(ringSource);
const members = loadMembers();

const ajv = new Ajv2020({ allErrors: true });
addFormats(ajv);
// Registered once, then fetched rather than compiled a second time: the
// document schema's own `entries` items `$ref` this by `$id`, and compiling
// the same `$id` twice is an Ajv error, not a no-op.
ajv.addSchema(entrySchema);
const validateEntry = ajv.getSchema(entrySchema.$id);
const validateDocument = ajv.compile(documentSchema);

const publishMode = process.argv.includes('--publish');

let failures = 0;
const seenIds = new Set();
const placeholders = [];

// The envelope itself, separate from any one entry: is this an object with a
// `version` and an `entries` array, nothing else. A malformed envelope is
// reported the same way a malformed entry is — one error block, not a
// process.exit here — so a single run still shows every problem the file
// has, envelope and entries together.
if (!validateDocument(ringDocument)) {
	failures++;
	console.error(`ring.json does not match the envelope schema (${ROOT}ring.json):`);
	for (const error of validateDocument.errors) {
		console.error(`  ${error.instancePath || '(root)'} ${error.message}`);
	}
}
const ring = Array.isArray(ringDocument?.entries) ? ringDocument.entries : [];

for (const { file, expectedId, entry } of members) {
	const label = entry?.id ? `"${entry.id}" (${file})` : file;

	if (!validateEntry(entry)) {
		failures++;
		console.error(`Entry ${label} failed schema validation:`);
		for (const error of validateEntry.errors) {
			console.error(`  ${error.instancePath || '(root)'} ${error.message}`);
		}
	}

	if (entry?.id !== expectedId) {
		failures++;
		console.error(`Entry ${label}: id must match its filename (${expectedId}).`);
	}

	// Not gated on --publish: unlike a placeholder, which is a legitimate
	// interim state, a URL naming a private IP, a localhost-shaped hostname,
	// or embedded credentials has no legitimate reason to be in real ring
	// data at all, so both modes reject it.
	for (const { field, url } of urlsIn(entry)) {
		try {
			assertStaticallySafeUrl(url);
		} catch (error) {
			failures++;
			console.error(`Entry ${label}: ${field} is unsafe: ${error.message}`);
		}
	}

	if (entry?.id) {
		if (seenIds.has(entry.id)) {
			failures++;
			console.error(`Entry ${label}: duplicate id.`);
		}
		seenIds.add(entry.id);
	}

	if (entry?._placeholder === true) {
		placeholders.push(entry.id ?? file);
		if (publishMode) {
			failures++;
			console.error(`Entry ${label}: _placeholder is true and cannot be published.`);
		}
	}
}

const generated = await serializeRing(members.map(({ entry }) => entry));
if (ringSource !== generated) {
	failures++;
	console.error('ring.json is out of date with members/*.json. Run `npm run ring:build`.');
}

if (failures > 0) {
	console.error(`\n${failures} problem(s) found in ring.json.`);
	if (publishMode && placeholders.length > 0) {
		console.error('Remove seed entries before publishing, or drop their _placeholder flag.');
	}
	process.exit(1);
}

const mode = publishMode ? 'valid and publishable' : 'valid';
console.log(`ring.json is ${mode}: ${ring.length} entries from ${members.length} member files.`);

// Reported, not failed, outside publish mode: knowing how much of the ring is
// still seed data is useful, and staying silent about it is how four
// placeholders quietly become the thing nobody notices at publish time.
if (!publishMode && placeholders.length > 0) {
	console.log(
		`${placeholders.length} placeholder entr${placeholders.length === 1 ? 'y' : 'ies'} (${placeholders.join(', ')}). ` +
			'These fail `npm run validate:publish`.'
	);
}
