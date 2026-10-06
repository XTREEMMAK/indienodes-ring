import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
	formatMemberJson,
	serializePublishedRing,
	serializeRing,
	stampJoinedAt,
	withGeneratedAt
} from './ring-files.js';

/** @param {Record<string, unknown>} entry */
function member(entry) {
	return { file: `${entry.id}.json`, expectedId: /** @type {string} */ (entry.id), entry };
}

describe('build-ring: stampJoinedAt', () => {
	it('injects joined_at on a member that has none', () => {
		const now = '2026-09-02T00:00:00.000Z';
		const members = [member({ id: 'audio-example' })];
		const touched = stampJoinedAt(members, { now });
		assert.equal(touched.length, 1);
		assert.equal(members[0].entry.joined_at, now);
	});

	it('leaves an existing joined_at untouched and excludes it from the touched list', () => {
		const original = '2026-01-01T00:00:00.000Z';
		const members = [member({ id: 'audio-example', joined_at: original })];
		const touched = stampJoinedAt(members, { now: '2026-09-02T00:00:00.000Z' });
		assert.equal(touched.length, 0);
		assert.equal(members[0].entry.joined_at, original);
	});

	it('is idempotent: a second run over its own output touches nothing', () => {
		const members = [member({ id: 'audio-example' })];
		const first = stampJoinedAt(members, { now: '2026-09-02T00:00:00.000Z' });
		assert.equal(first.length, 1);
		const second = stampJoinedAt(members, { now: '2026-09-03T00:00:00.000Z' });
		assert.equal(second.length, 0);
		assert.equal(members[0].entry.joined_at, '2026-09-02T00:00:00.000Z');
	});

	it('never sets updated_at', () => {
		const members = [member({ id: 'audio-example' })];
		stampJoinedAt(members, { now: '2026-09-02T00:00:00.000Z' });
		assert.equal('updated_at' in members[0].entry, false);
	});

	it('stamps only the members that lack joined_at, in a mixed batch', () => {
		const members = [
			member({ id: 'audio-example', joined_at: '2026-01-01T00:00:00.000Z' }),
			member({ id: 'comic-example' })
		];
		const touched = stampJoinedAt(members, { now: '2026-09-02T00:00:00.000Z' });
		assert.deepEqual(
			touched.map((m) => m.file),
			['comic-example.json']
		);
	});
});

describe('build-ring: formatMemberJson', () => {
	it('round-trips through JSON.parse unchanged', async () => {
		const entry = { id: 'audio-example', creator: 'Example', tags: ['music'] };
		const formatted = await formatMemberJson(entry);
		assert.deepEqual(JSON.parse(formatted), entry);
	});

	it('wraps a long entry across lines using tabs, not spaces', async () => {
		const entry = {
			id: 'audio-example',
			creator: 'A Creator With A Fairly Long Name',
			why: 'A sentence long enough to push this object past the configured print width of 100.',
			tags: ['music', 'ambient', 'field-recording']
		};
		const formatted = await formatMemberJson(entry);
		assert.deepEqual(JSON.parse(formatted), entry);
		assert.ok(formatted.includes('\n\t"id"'));
		assert.ok(!formatted.includes('  '), 'expected tabs, not two-space indentation');
	});
});

describe('build-ring: withGeneratedAt', () => {
	it('adds generated_at without touching version or entries', () => {
		const document = { version: '1.0', entries: [{ id: 'audio-example' }] };
		const stamped = withGeneratedAt(document, { now: '2026-09-28T00:00:00.000Z' });
		assert.deepEqual(stamped, {
			version: '1.0',
			entries: [{ id: 'audio-example' }],
			generated_at: '2026-09-28T00:00:00.000Z'
		});
	});

	it('does not mutate the document it was given', () => {
		const document = { version: '1.0', entries: [] };
		withGeneratedAt(document, { now: '2026-09-28T00:00:00.000Z' });
		assert.equal('generated_at' in document, false);
	});

	it('defaults to the current time when none is given', () => {
		const before = Date.now();
		const stamped = withGeneratedAt({ version: '1.0', entries: [] });
		const stampedMs = new Date(stamped.generated_at).getTime();
		assert.ok(stampedMs >= before && stampedMs <= Date.now());
	});
});

describe('build-ring: serializePublishedRing', () => {
	// Sized like a real ring: a document short enough to fit on one line is
	// legitimately wrapped differently once generated_at is added, which says
	// nothing about the published copy's formatting.
	const entries = ['audio-one', 'comic-two', 'art-three'].map((id) => ({
		id,
		creator: `Creator of ${id}`,
		why: 'A sentence long enough that each entry needs several lines of its own.',
		tags: ['ambient', 'field-recording']
	}));
	const now = '2026-09-28T00:00:00.000Z';

	it('is the committed serialization plus a generated_at line, and nothing else', async () => {
		const committed = await serializeRing(entries);
		const published = await serializePublishedRing({ version: '1.0', entries }, { now });
		assert.equal(
			published.replace(/,\n\t"generated_at": "[^"]*"/, ''),
			committed,
			'the published copy must not differ from the committed one in formatting'
		);
		assert.ok(published.includes(`"generated_at": "${now}"`));
	});

	it('keeps short arrays compact, as the committed file does', async () => {
		const published = await serializePublishedRing({ version: '1.0', entries }, { now });
		assert.ok(published.includes('"tags": ["ambient", "field-recording"]'));
	});
});
