#!/usr/bin/env node
// Generates feed.xml, an RSS 2.0 feed of new members, at publish time only.
// Never committed (see .gitignore) -- same posture as ring.json's old inline
// index.html before site/ existed: a build output, not a source file.
//
// New members only, not new-and-updated: RSS 2.0 has no Atom-style separate
// "updated" element distinct from pubDate, so reusing pubDate for an edit
// would make an already-read item reappear as unread in most readers. See
// docs/whats-new-feed.md.

import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { loadMembers } from './ring-files.js';

const SITE_URL = 'https://ring.indienodes.us';
// Matches site/index.html's own <meta name="description"> voice.
const CHANNEL_DESCRIPTION =
	'A hand-curated path through creator-owned corners of the web: music, comics, writing, games, and visual art made beyond the feed.';

const XML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' };

/** @param {unknown} value */
export function escapeXml(value) {
	return String(value).replace(/[&<>"']/g, (c) => XML_ESCAPES[c]);
}

/**
 * Pure: entries in, RSS 2.0 XML string out. No fs access and no implicit
 * Date.now() unless the caller omits generatedAt, so this is deterministic
 * and testable without touching disk or the clock.
 *
 * @param {Record<string, unknown>[]} entries
 * @param {{ generatedAt?: Date }} [options]
 */
export function buildFeed(entries, { generatedAt = new Date() } = {}) {
	const items = entries
		.filter((entry) => entry?._placeholder !== true && typeof entry.joined_at === 'string')
		.sort((a, b) => new Date(b.joined_at).getTime() - new Date(a.joined_at).getTime())
		.map((entry) => {
			const categories = /** @type {string[]} */ (entry.tags ?? [])
				.map((tag) => `      <category>${escapeXml(tag)}</category>`)
				.join('\n');
			return `    <item>
      <title>${escapeXml(`New on IndieNodes: ${entry.creator}`)}</title>
      <link>${escapeXml(entry.source_url)}</link>
      <guid isPermaLink="false">${escapeXml(entry.id)}</guid>
      <pubDate>${new Date(/** @type {string} */ (entry.joined_at)).toUTCString()}</pubDate>
      <description>${escapeXml(entry.why)}</description>
${categories}
    </item>`;
		})
		.join('\n');

	return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>The IndieNodes Webring</title>
    <link>${SITE_URL}/</link>
    <atom:link href="${SITE_URL}/feed.xml" rel="self" type="application/rss+xml"/>
    <description>${escapeXml(CHANNEL_DESCRIPTION)}</description>
    <language>en-us</language>
    <lastBuildDate>${generatedAt.toUTCString()}</lastBuildDate>
${items}
  </channel>
</rss>
`;
}

async function main() {
	const members = loadMembers();
	const xml = buildFeed(members.map(({ entry }) => entry));
	writeFileSync(new URL('../feed.xml', import.meta.url), xml);
	console.log(`Generated feed.xml (${(xml.match(/<item>/g) ?? []).length} item(s)).`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	await main();
}
