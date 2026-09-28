import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

const schema = JSON.parse(readFileSync(new URL('../schema/ring.schema.json', import.meta.url)));
const ajv = new Ajv2020({ allErrors: true });
addFormats(ajv);
const validate = ajv.compile(schema);

/** @param {object} extra */
function entry(extra) {
	return {
		id: 'audio-example',
		creator: 'Example Creator',
		type: 'audio',
		form: 'music',
		why: 'One-line framing',
		source_url: 'https://example.com/',
		tags: ['example'],
		verification_token: 'abc123',
		joined_at: '2026-09-01T00:00:00.000Z',
		...extra
	};
}

test('feeds accepts a known type, an unknown type, and an unverified feed', () => {
	assert.equal(
		validate(
			entry({
				feeds: [
					{ type: 'rss', url: 'https://example.com/feed.xml', verified: true },
					{ type: 'bluesky', url: 'https://bsky.app/profile/example' },
					{ type: 'gemini-capsule', url: 'https://example.com/feed.gmi' }
				]
			})
		),
		true
	);
});

test('feeds rejects a non-https url, a rehosted url, and a feed missing url', () => {
	assert.equal(
		validate(entry({ feeds: [{ type: 'rss', url: 'http://example.com/feed.xml' }] })),
		false
	);
	assert.equal(
		validate(entry({ feeds: [{ type: 'rss', url: 'https://ring.indienodes.us/feed.xml' }] })),
		false
	);
	assert.equal(validate(entry({ feeds: [{ type: 'rss' }] })), false);
});

test('feeds is capped at 10', () => {
	const feeds = Array.from({ length: 11 }, (_, i) => ({
		type: 'rss',
		url: `https://example.com/feed-${i}.xml`
	}));
	assert.equal(validate(entry({ feeds })), false);
});

test('discoverable accepts true or false and rejects a non-boolean', () => {
	assert.equal(validate(entry({ discoverable: true })), true);
	assert.equal(validate(entry({ discoverable: false })), true);
	assert.equal(validate(entry({ discoverable: 'no' })), false);
});

test('layout accepts only the two declared values', () => {
	assert.equal(validate(entry({ layout: 'mobile-friendly' })), true);
	assert.equal(validate(entry({ layout: 'desktop-first' })), true);
	assert.equal(validate(entry({ layout: 'responsive' })), false);
});

test('an entry with none of the three additive fields is still valid', () => {
	assert.equal(validate(entry({})), true);
});
