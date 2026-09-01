import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildFeed, escapeXml } from './build-feed.js';

const RFC822 = /^[A-Za-z]{3}, \d{2} [A-Za-z]{3} \d{4} \d{2}:\d{2}:\d{2} GMT$/;

/** @param {Partial<Record<string, unknown>>} overrides */
function entry(overrides = {}) {
	return {
		id: 'audio-example',
		creator: 'Example Creator',
		source_url: 'https://creator.example',
		why: 'Makes lovely things.',
		tags: ['music'],
		joined_at: '2026-09-01T00:00:00.000Z',
		...overrides
	};
}

describe('build-feed: escapeXml', () => {
	it('escapes every reserved XML character', () => {
		assert.equal(escapeXml(`&<>"'`), '&amp;&lt;&gt;&quot;&apos;');
	});

	it('leaves ordinary text untouched', () => {
		assert.equal(escapeXml('Example Creator'), 'Example Creator');
	});
});

describe('build-feed: buildFeed', () => {
	it('produces one <item> per eligible entry', () => {
		const xml = buildFeed([entry({ id: 'a' }), entry({ id: 'b' })]);
		assert.equal((xml.match(/<item>/g) ?? []).length, 2);
	});

	it('formats pubDate as RFC 822', () => {
		const xml = buildFeed([entry()]);
		const pubDate = /<pubDate>(.*)<\/pubDate>/.exec(xml)?.[1];
		assert.ok(pubDate, 'expected a pubDate element');
		assert.match(/** @type {string} */ (pubDate), RFC822);
	});

	it('escapes creator, why, and tags rather than emitting raw markup', () => {
		const xml = buildFeed([
			entry({ creator: 'A & B <Studio>', why: 'Uses <script> & "quotes"', tags: ['r&b'] })
		]);
		assert.ok(xml.includes('A &amp; B &lt;Studio&gt;'));
		assert.ok(xml.includes('Uses &lt;script&gt; &amp; &quot;quotes&quot;'));
		assert.ok(xml.includes('<category>r&amp;b</category>'));
		assert.ok(!/[^&]&(?!amp;|lt;|gt;|quot;|apos;)/.test(xml.split('<description>')[1] ?? ''));
	});

	it('produces a valid empty channel for a ring with no members', () => {
		assert.doesNotThrow(() => buildFeed([]));
		const xml = buildFeed([]);
		assert.equal((xml.match(/<item>/g) ?? []).length, 0);
		assert.ok(xml.includes('<channel>'));
		assert.ok(xml.includes('</channel>'));
	});

	it('excludes _placeholder entries', () => {
		const xml = buildFeed([entry({ id: 'real' }), entry({ id: 'seed', _placeholder: true })]);
		assert.equal((xml.match(/<item>/g) ?? []).length, 1);
		assert.ok(!xml.includes('seed'));
	});

	it('excludes entries with no joined_at rather than crashing on an invalid date', () => {
		const withoutDate = entry({ id: 'no-date' });
		delete withoutDate.joined_at;
		const xml = buildFeed([withoutDate]);
		assert.equal((xml.match(/<item>/g) ?? []).length, 0);
	});

	it('sorts newest joined_at first', () => {
		const xml = buildFeed([
			entry({ id: 'older', creator: 'Older', joined_at: '2026-01-01T00:00:00.000Z' }),
			entry({ id: 'newer', creator: 'Newer', joined_at: '2026-06-01T00:00:00.000Z' })
		]);
		assert.ok(xml.indexOf('Newer') < xml.indexOf('Older'));
	});

	it('uses id, not source_url, as the guid', () => {
		const xml = buildFeed([entry({ id: 'stable-id', source_url: 'https://creator.example/page' })]);
		assert.ok(xml.includes('<guid isPermaLink="false">stable-id</guid>'));
	});
});
