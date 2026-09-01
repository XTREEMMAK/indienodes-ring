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
 * Stamps `joined_at` onto any member whose entry doesn't already have one,
 * idempotently: an existing value is never touched. This is what lets
 * `joined_at` be a required field without a separate backfill step or any
 * change to build-ring.yml -- the same "commit members + ring.json together,
 * only if changed" step that workflow already runs picks up a freshly
 * stamped file exactly like any other edit.
 *
 * Deliberately does not touch `updated_at`: RSS 2.0 has no separate
 * "updated" concept the way Atom does, so an auto-bumped value here would
 * have nowhere correct to flow in scripts/build-feed.js without making
 * already-read feed items look unread again. It stays an explicit,
 * human/automation-set field, the same as verification_token.
 *
 * Mutates each touched member's `entry` in place (so the caller's own
 * `members` array reflects the new value for anything built from it in the
 * same run, e.g. serializeRing) and returns just the members that changed,
 * so the caller knows which files actually need rewriting to disk.
 *
 * @param {{ file: string, expectedId: string, entry: Record<string, unknown> }[]} members
 * @param {{ now?: string }} [options]
 * @returns {{ file: string, expectedId: string, entry: Record<string, unknown> }[]}
 */
export function stampJoinedAt(members, { now = new Date().toISOString() } = {}) {
	const touched = [];
	for (const member of members) {
		if (typeof member.entry.joined_at !== 'string') {
			member.entry = { ...member.entry, joined_at: now };
			touched.push(member);
		}
	}
	return touched;
}

/**
 * Formats one member entry to match what build-ring.yml's own
 * `prettier --write 'members/*.json'` step would produce on the same file --
 * one canonical style, not two that happen to agree most of the time.
 *
 * `JSON.stringify(entry, null, '\t')`, not the minified `JSON.stringify(entry)`
 * serializeRing uses for ring.json: Prettier's JSON printer keeps an object
 * or array on one line only if there was no newline between its opening
 * bracket and first element in the *input* it was given, the same way it
 * preserves a human's own choice to break a JS object across lines. A fully
 * minified input has no such newlines anywhere, so formatting one collapses
 * every nested object/array that fits under printWidth -- silently
 * reformatting parts of the file this function was never asked to touch.
 * Feeding it already-indented JSON preserves that per-object hint, so this
 * changes only what it's supposed to (the newly added key) and leaves
 * everything else exactly as the file's own last real format left it.
 *
 * @param {Record<string, unknown>} entry
 */
export function formatMemberJson(entry) {
	return format(JSON.stringify(entry, null, '\t'), {
		parser: 'json',
		useTabs: true,
		printWidth: 100
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
 * @param {Record<string, unknown>[]} entries
 */
export function serializeRing(entries) {
	return format(JSON.stringify({ version: RING_VERSION, entries }), {
		parser: 'json',
		useTabs: true,
		printWidth: 100
	});
}
