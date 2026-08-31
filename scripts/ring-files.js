import { readFileSync, readdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { format } from 'prettier';

export const ROOT = fileURLToPath(new URL('..', import.meta.url));
export const MEMBERS_DIR = fileURLToPath(new URL('../members', import.meta.url));
export const RING_PATH = fileURLToPath(new URL('../ring.json', import.meta.url));

/**
 * The member files, or none.
 *
 * A missing `members/` directory means no members, not an error. Git does not
 * track empty directories, so a ring with no members has no directory at all —
 * which is the state a fresh clone of this repo is in right now, and the state
 * anyone forking it to run their own ring starts from. Without this guard both
 * `ring:build` and `validate:publish` die with ENOENT on their first run, which
 * makes an empty ring something to work around rather than something to grow
 * out of.
 *
 * Only ENOENT is swallowed. A permissions error or a file where the directory
 * should be is a real problem and still throws.
 */
export function memberFiles() {
	let files;
	try {
		files = readdirSync(MEMBERS_DIR);
	} catch (error) {
		if (/** @type {NodeJS.ErrnoException} */ (error).code === 'ENOENT') return [];
		throw error;
	}
	return files.filter((file) => file.endsWith('.json')).sort();
}

export function loadMembers() {
	return memberFiles().map((file) => {
		const entry = JSON.parse(readFileSync(join(MEMBERS_DIR, file), 'utf8'));
		return { file, expectedId: basename(file, '.json'), entry };
	});
}

/**
 * The envelope's own shape version, independent of any individual entry's
 * shape (schema/ring.schema.json governs that). Bumping this is a decision
 * about the document, not something a member's data ever needs to touch —
 * see schema/ring-document.schema.json and docs/decisions.md.
 */
export const RING_VERSION = '1.0';

/**
 * The canonical on-disk form of ring.json: a versioned envelope, not a bare
 * array. `src/lib/ring.js`'s `loadRing` reads both shapes and shipped before
 * this one started producing the envelope, specifically so that a page
 * already holding a fetched `embed.v1.js` from before that reader existed
 * would still be pointed at a bare array by every deploy prior to this one —
 * see docs/decisions.md, 'LOCKED: ring.json is a versioned envelope', for why
 * that ordering was load-bearing rather than incidental.
 *
 * No `generated_at` or other build-time metadata here on purpose: this file
 * is compared byte-for-byte against a fresh call to this same function by
 * `validate-ring.js`'s freshness check, and anything that changes between two
 * runs over identical input would make every build differ from the last and
 * fail that check against itself. A timestamp belongs on a *published*
 * endpoint, stamped at publish time, not in the committed artifact.
 *
 * Typed because `src/lib/publishedRing.test.js` imports this module, which
 * pulls the file into svelte-check's graph — nothing under src/ referenced it
 * before, so the parameter had gone unchecked rather than been decided against.
 * @param {import('../src/lib/ring.js').RingEntry[]} entries
 */
export function serializeRing(entries) {
	return format(JSON.stringify({ version: RING_VERSION, entries }), {
		parser: 'json',
		useTabs: true,
		printWidth: 100
	});
}
