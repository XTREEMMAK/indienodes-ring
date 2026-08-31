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
