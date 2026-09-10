// Covers the pages.kjnet.us deep-link orchestration in run(): a source_url
// hosted on our own pages.kjnet.us template links out to a member's actual
// site, and that second URL must flow through the exact same probe/alert
// pipeline as source_url itself (see docs/member-link-health.md). run()
// normally reads members straight off disk via ring-files.js's loadMembers();
// dependencies.members overrides that so this suite never touches the
// filesystem or the repo's own .member-health-state.json.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseArgs, run } from './check-member-links.js';

const publicLookup = async () => [{ address: '93.184.216.34', family: 4 }];

function jewelMember(sourceUrl = 'https://pages.kjnet.us/jewel/') {
	return [
		{ file: 'jewel.json', expectedId: 'jewel', entry: { id: 'jewel', source_url: sourceUrl } }
	];
}

function baseOptions(overrides = {}) {
	return {
		...parseArgs(['--no-participation-check', '--no-state', '--failure-threshold', '1']),
		...overrides
	};
}

describe('check-member-links: pages.kjnet.us deep-link orchestration', () => {
	it('probes both the source page and the site it links out to', async () => {
		const fetchImpl = async (url) => {
			const href = url instanceof URL ? url.href : String(url);
			if (href === 'https://pages.kjnet.us/jewel/') {
				return new Response(
					'<a class="link-primary" href="https://real.example/">Their own site</a>'
				);
			}
			if (href === 'https://real.example/') return new Response('', { status: 200 });
			throw new Error('unexpected fetch: ' + href);
		};

		const report = await run(baseOptions(), {
			members: jewelMember(),
			fetchImpl,
			lookupImpl: publicLookup
		});

		assert.equal(report.summary.urlsChecked, 2);
		const deepLinkResult = report.results.find((result) => result.url === 'https://real.example/');
		assert.ok(deepLinkResult, 'expected a separate result entry for the deep-linked site');
		assert.equal(deepLinkResult.outcome, 'healthy');
		assert.deepEqual(
			deepLinkResult.references.map(({ field }) => field),
			['source_url (deep link)']
		);
	});

	it('trips the same alert pipeline as a directly broken source_url when the deep-linked site is broken', async () => {
		const fetchImpl = async (url) => {
			const href = url instanceof URL ? url.href : String(url);
			if (href === 'https://pages.kjnet.us/jewel/') {
				return new Response(
					'<a class="link-primary" href="https://real.example/">Their own site</a>'
				);
			}
			if (href === 'https://real.example/') return new Response('', { status: 404 });
			throw new Error('unexpected fetch: ' + href);
		};

		const report = await run(baseOptions(), {
			members: jewelMember(),
			fetchImpl,
			lookupImpl: publicLookup
		});

		const deepLinkResult = report.results.find((result) => result.url === 'https://real.example/');
		assert.equal(deepLinkResult.outcome, 'broken');
		assert.equal(deepLinkResult.alert, true);
		assert.equal(report.summary.alerts, 1);
	});

	it('--no-deep-link-check suppresses the second pass entirely', async () => {
		const fetchImpl = async () =>
			new Response('<a class="link-primary" href="https://real.example/">Their own site</a>');

		const report = await run(baseOptions({ checkDeepLinks: false }), {
			members: jewelMember(),
			fetchImpl,
			lookupImpl: publicLookup
		});

		assert.equal(report.summary.urlsChecked, 1);
		assert.equal(
			report.results.some((result) => result.url === 'https://real.example/'),
			false
		);
	});

	it('does not deep-link a member whose source_url is not on pages.kjnet.us', async () => {
		const fetchImpl = async () =>
			new Response('<a class="link-primary" href="https://real.example/">Their own site</a>');

		const report = await run(baseOptions(), {
			members: jewelMember('https://creator.example/work'),
			fetchImpl,
			lookupImpl: publicLookup
		});

		assert.equal(report.summary.urlsChecked, 1);
	});
});
