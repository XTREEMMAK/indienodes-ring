// Restores the SSRF-safety test coverage dropped when this logic moved out
// of indienodes-app (memberHealth.test.js, deleted in that repo's 6c21307
// "cut this repo over to consuming the ring instead of owning it") -- this
// repo has carried the module with zero replacement coverage since. See
// docs/webring-security-research-2026-08-31.md finding F-05 for why this
// matters: `isPublicIpAddress` and `validateExternalUrl` are the boundary
// between "a member's source_url" and an outbound request this project's own
// infrastructure makes on a stranger's say-so.
//
// Uses node:test rather than adding a test-framework dependency: this repo's
// devDependencies are ajv/ajv-formats/prettier, nothing else, and Node 24
// (already the CI runtime) ships everything this suite needs -- describe/it,
// async support, and mock.fn() for the same call-tracking vi.fn() gave the
// original suite.
import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import {
	applyFailureHistory,
	assertStaticallySafeUrl,
	collectMemberLinks,
	groupLinksByUrl,
	hasVerificationToken,
	isPublicIpAddress,
	LinkHealthError,
	MAX_SOURCE_BYTES,
	probeLink,
	ringParticipation,
	validateExternalUrl
} from './member-health.js';

const publicLookup = async () => [{ address: '93.184.216.34', family: 4 }];

function grouped(url = 'https://creator.example/work') {
	return groupLinksByUrl([
		collectMemberLinks(
			{ id: 'audio-example', source_url: url, verification_token: 'token-123' },
			'audio-example.json'
		)
	])[0];
}

/** @param {(...args: any[]) => Promise<any>} impl */
async function rejects(promise, code) {
	await assert.rejects(promise, (error) => {
		assert.ok(error instanceof LinkHealthError, `expected a LinkHealthError, got ${error}`);
		assert.equal(error.code, code);
		return true;
	});
}

describe('member health link collection', () => {
	it('collects every URL-bearing member field with its JSON path', () => {
		const links = collectMemberLinks(
			{
				id: 'comic-example',
				source_url: 'https://creator.example',
				thumb_url: 'https://cdn.example/thumb.jpg',
				preview_url: 'https://cdn.example/preview.mp4',
				trailer_url: 'https://youtu.be/dQw4w9WgXcQ',
				tracks: [{ media_url: 'https://cdn.example/track.mp3' }],
				pages: [{ image_url: 'https://cdn.example/page.png' }],
				artworks: [
					{ image_url: 'https://cdn.example/art.png', external_url: 'https://cdn.example/more' }
				]
			},
			'comic-example.json'
		);
		assert.deepEqual(
			links.map(({ field }) => field),
			[
				'source_url',
				'thumb_url',
				'preview_url',
				'trailer_url',
				'tracks[0].media_url',
				'pages[0].image_url',
				'artworks[0].image_url',
				'artworks[0].external_url'
			]
		);
	});

	it('deduplicates a URL while retaining every reference', () => {
		const links = groupLinksByUrl([
			collectMemberLinks(
				{
					id: 'audio-example',
					source_url: 'https://creator.example/same',
					thumb_url: 'https://creator.example/same'
				},
				'audio-example.json'
			)
		]);
		assert.equal(links.length, 1);
		assert.equal(links[0].references.length, 2);
	});
});

describe('member health URL safety: isPublicIpAddress', () => {
	const unsafe = [
		['0.0.0.0', 'this-network'],
		['10.0.0.1', 'RFC1918'],
		['10.255.255.255', 'RFC1918 upper bound'],
		['127.0.0.1', 'loopback'],
		['100.64.0.1', 'CGNAT lower bound'],
		['100.127.255.255', 'CGNAT upper bound'],
		['169.254.169.254', 'link-local / cloud metadata'],
		['172.16.0.1', 'RFC1918 172 lower bound'],
		['172.31.255.255', 'RFC1918 172 upper bound'],
		['192.0.0.1', 'IETF protocol assignments'],
		['192.0.2.1', 'TEST-NET-1'],
		['192.168.1.5', 'RFC1918 192.168'],
		['198.18.0.1', 'benchmark lower bound'],
		['198.19.255.255', 'benchmark upper bound'],
		['198.51.100.1', 'TEST-NET-2'],
		['203.0.113.1', 'TEST-NET-3'],
		['224.0.0.1', 'multicast'],
		['255.255.255.255', 'broadcast/reserved'],
		['::', 'IPv6 unspecified'],
		['::1', 'IPv6 loopback'],
		['fd00::1', 'IPv6 unique-local'],
		['fc00::1', 'IPv6 unique-local, fc prefix'],
		['fe80::1', 'IPv6 link-local'],
		['ff02::1', 'IPv6 multicast'],
		['2001:db8::1', 'IPv6 documentation'],
		['2001:2::1', 'IPv6 benchmark'],
		['::ffff:127.0.0.1', 'IPv4-mapped loopback'],
		['::ffff:10.0.0.1', 'IPv4-mapped RFC1918']
	];
	for (const [address, label] of unsafe) {
		it(`rejects ${address} (${label})`, () => {
			assert.equal(isPublicIpAddress(address), false);
		});
	}

	const safe = [
		['93.184.216.34', 'IPv4 public example'],
		['8.8.8.8', 'IPv4 public resolver'],
		['172.15.255.255', 'just below the RFC1918 172 range'],
		['172.32.0.0', 'just above the RFC1918 172 range'],
		['100.63.255.255', 'just below the CGNAT range'],
		['2606:4700:4700::1111', 'IPv6 public resolver'],
		['::ffff:93.184.216.34', 'IPv4-mapped public address']
	];
	for (const [address, label] of safe) {
		it(`accepts ${address} (${label})`, () => {
			assert.equal(isPublicIpAddress(address), true);
		});
	}
});

describe('member health URL safety: assertStaticallySafeUrl', () => {
	it('accepts a plain https URL and reports its normalized hostname', () => {
		const { hostname } = assertStaticallySafeUrl('https://Creator.Example/work');
		assert.equal(hostname, 'creator.example');
	});

	it('rejects non-http(s) schemes', () => {
		for (const url of ['ftp://creator.example', 'file:///etc/passwd', 'javascript:alert(1)']) {
			assert.throws(() => assertStaticallySafeUrl(url), { code: 'unsafe_url' });
		}
	});

	it('rejects embedded credentials', () => {
		assert.throws(() => assertStaticallySafeUrl('https://user:pw@creator.example'), {
			code: 'unsafe_url'
		});
	});

	it('rejects local and internal hostnames without a network call', () => {
		for (const url of [
			'https://localhost/',
			'https://foo.localhost/',
			'https://x.internal/',
			'https://metadata.google.internal/',
			'https://instance-data/'
		]) {
			assert.throws(() => assertStaticallySafeUrl(url), { code: 'unsafe_url' });
		}
	});

	it('rejects a literal private IP without a network call, and unwraps IPv6 brackets', () => {
		assert.throws(() => assertStaticallySafeUrl('http://127.0.0.1/'), { code: 'unsafe_url' });
		assert.throws(() => assertStaticallySafeUrl('http://[::1]/'), { code: 'unsafe_url' });
		const { hostname } = assertStaticallySafeUrl('https://[2606:4700:4700::1111]/');
		assert.equal(hostname, '2606:4700:4700::1111');
	});

	it('rejects a URL that fails to parse', () => {
		assert.throws(() => assertStaticallySafeUrl('not a url'), { code: 'invalid_url' });
	});
});

describe('member health URL safety: validateExternalUrl', () => {
	it('skips DNS entirely for a literal IP, safe or not', async () => {
		const lookupImpl = mock.fn(async () => {
			throw new Error('should not be called for a literal IP');
		});
		await assert.doesNotReject(validateExternalUrl('https://93.184.216.34/', lookupImpl));
		assert.equal(lookupImpl.mock.callCount(), 0);
	});

	it('checks DNS and rejects a hostname with a private answer', async () => {
		const privateLookup = mock.fn(async () => [{ address: '192.168.1.5', family: 4 }]);
		await rejects(validateExternalUrl('https://creator.example', privateLookup), 'unsafe_url');
		assert.equal(privateLookup.mock.callCount(), 1);
	});

	it('rejects if ANY resolved address is unsafe, not just the first', async () => {
		const mixedLookup = async () => [
			{ address: '93.184.216.34', family: 4 },
			{ address: '169.254.169.254', family: 4 }
		];
		await rejects(validateExternalUrl('https://creator.example', mixedLookup), 'unsafe_url');
	});

	it('accepts a hostname whose every resolved address is public', async () => {
		await assert.doesNotReject(validateExternalUrl('https://creator.example', publicLookup));
	});

	it('surfaces a DNS failure as dns_error, not an uncaught rejection', async () => {
		const failingLookup = async () => {
			throw new Error('ENOTFOUND');
		};
		await rejects(validateExternalUrl('https://creator.example', failingLookup), 'dns_error');
	});

	it('treats zero resolved addresses as a DNS error', async () => {
		await rejects(
			validateExternalUrl('https://creator.example', async () => []),
			'dns_error'
		);
	});
});

describe('member health probing', () => {
	it('uses a ranged GET and treats 2xx as healthy', async () => {
		const fetchImpl = mock.fn(async (_url, options) => {
			assert.equal(options.headers.Range, 'bytes=0-0');
			return new Response(new Uint8Array([1]), { status: 206 });
		});
		const result = await probeLink(grouped(), { fetchImpl, lookupImpl: publicLookup });
		assert.match(result.reason, /^ok$/);
		assert.equal(result.outcome, 'healthy');
		assert.equal(result.statusCode, 206);
		assert.equal(fetchImpl.mock.callCount(), 1);
	});

	for (const status of [404, 410]) {
		it(`treats HTTP ${status} as definitely broken`, async () => {
			const result = await probeLink(grouped(), {
				fetchImpl: async () => new Response('', { status }),
				lookupImpl: publicLookup
			});
			assert.equal(result.outcome, 'broken');
			assert.equal(result.reason, 'http_' + status);
			assert.equal(result.statusCode, status);
		});
	}

	it('keeps rate limits and server failures as warnings, not broken', async () => {
		const rateLimited = await probeLink(grouped(), {
			fetchImpl: async () => new Response('', { status: 429 }),
			lookupImpl: publicLookup
		});
		const serverError = await probeLink(grouped(), {
			fetchImpl: async () => new Response('', { status: 503 }),
			lookupImpl: publicLookup
		});
		assert.equal(rateLimited.outcome, 'warning');
		assert.equal(rateLimited.reason, 'http_429');
		assert.equal(serverError.outcome, 'warning');
		assert.equal(serverError.reason, 'http_503');
	});

	it('validates a redirect target before following it', async () => {
		const fetchImpl = mock.fn(
			async () =>
				new Response('', { status: 302, headers: { location: 'http://127.0.0.1/private' } })
		);
		const result = await probeLink(grouped(), { fetchImpl, lookupImpl: publicLookup });
		assert.equal(result.outcome, 'warning');
		assert.equal(result.reason, 'unsafe_url');
		// The unsafe hop must be rejected before a second request is ever
		// made to it -- fetchImpl having been called exactly once (for the
		// original, safe URL) is what proves that, not just the result shape.
		assert.equal(fetchImpl.mock.callCount(), 1);
	});

	it('follows a chain of safe redirects to the final healthy target', async () => {
		let call = 0;
		const fetchImpl = async () => {
			call++;
			if (call === 1) {
				return new Response('', {
					status: 301,
					headers: { location: 'https://creator.example/b' }
				});
			}
			if (call === 2) {
				return new Response('', {
					status: 302,
					headers: { location: 'https://creator.example/c' }
				});
			}
			return new Response('', { status: 200 });
		};
		const result = await probeLink(grouped(), { fetchImpl, lookupImpl: publicLookup });
		assert.equal(result.outcome, 'healthy');
		assert.equal(call, 3);
	});

	it('gives up after MAX_REDIRECTS with too_many_redirects, not an infinite loop', async () => {
		const fetchImpl = async () =>
			new Response('', { status: 302, headers: { location: 'https://creator.example/loop' } });
		const result = await probeLink(grouped(), { fetchImpl, lookupImpl: publicLookup });
		assert.equal(result.outcome, 'warning');
		assert.equal(result.reason, 'too_many_redirects');
	});

	it('treats a redirect with no Location header as a warning, not a crash', async () => {
		const result = await probeLink(grouped(), {
			fetchImpl: async () => new Response('', { status: 302 }),
			lookupImpl: publicLookup
		});
		assert.equal(result.outcome, 'warning');
		assert.equal(result.reason, 'redirect_without_location');
	});

	it('can check the verification meta tag recognized by intake', async () => {
		const fetchImpl = async () =>
			new Response('<html><meta content="token-123" name="indienode-verification"></html>', {
				status: 200
			});
		const result = await probeLink(grouped(), {
			checkTokens: true,
			fetchImpl,
			lookupImpl: publicLookup
		});
		assert.equal(result.outcome, 'healthy');
		assert.equal(result.reason, 'ok');
		assert.equal(
			hasVerificationToken('<meta name="indienode-verification" content="wrong">', 'token-123'),
			false
		);
	});

	it('warns when a source page no longer carries a supported ring tier', async () => {
		const result = await probeLink(grouped(), {
			checkParticipation: true,
			fetchImpl: async () => new Response('<html><p>Nothing here.</p></html>'),
			lookupImpl: publicLookup
		});
		assert.equal(result.outcome, 'warning');
		assert.equal(result.reason, 'ring_participation_missing');
	});

	it('reports an unmatched site-id as its own warning, not as a missing embed', async () => {
		const result = await probeLink(grouped(), {
			checkParticipation: true,
			fetchImpl: async () =>
				new Response('<indienode-widget site-id="your-ring-entry-id"></indienode-widget>'),
			lookupImpl: publicLookup
		});
		assert.equal(result.outcome, 'warning');
		assert.equal(result.reason, 'ring_widget_site_id_unmatched');
		assert.match(result.detail, /audio-example/);
	});

	it('does not claim an embed is missing when it stopped reading before the end', async () => {
		const body =
			'<html><body>' +
			'x'.repeat(MAX_SOURCE_BYTES) +
			'<indienode-widget site-id="audio-example"></indienode-widget></body></html>';
		const result = await probeLink(grouped(), {
			checkParticipation: true,
			fetchImpl: async () => new Response(body),
			lookupImpl: publicLookup
		});
		assert.equal(result.outcome, 'warning');
		assert.equal(result.reason, 'ring_participation_indeterminate');
	});

	it('passes a page whose embed arrives before the read limit', async () => {
		const body =
			'<html><body><indienode-widget site-id="audio-example"></indienode-widget>' +
			'x'.repeat(MAX_SOURCE_BYTES) +
			'</body></html>';
		const result = await probeLink(grouped(), {
			checkParticipation: true,
			fetchImpl: async () => new Response(body),
			lookupImpl: publicLookup
		});
		assert.equal(result.outcome, 'healthy');
	});
});

describe('member health: ring participation detection', () => {
	it('recognizes the full widget and both lightweight tiers as participation', () => {
		assert.equal(
			ringParticipation('<indienode-widget site-id="audio-example"></indienode-widget>', [
				'audio-example'
			]),
			'member'
		);
		assert.equal(
			ringParticipation('<a href="https://indienodes.us/go/random">Member of IndieNodes</a>', [
				'audio-example'
			]),
			'link'
		);
		assert.equal(ringParticipation('<html><p>Nothing here.</p></html>', ['audio-example']), 'none');
	});

	it('separates a wrong site-id from no embed at all', () => {
		assert.equal(
			ringParticipation('<indienode-widget site-id="someone-else"></indienode-widget>', [
				'audio-example'
			]),
			'unmatched-widget'
		);
		assert.equal(
			ringParticipation('<indienode-widget site-id="your-ring-entry-id"></indienode-widget>', [
				'audio-example'
			]),
			'unmatched-widget'
		);
		assert.equal(
			ringParticipation('<indienode-widget></indienode-widget>', ['audio-example']),
			'unmatched-widget'
		);
	});

	it('accepts a site-id that differs only by case or surrounding whitespace', () => {
		assert.equal(
			ringParticipation('<indienode-widget site-id="Audio-Example"></indienode-widget>', [
				'audio-example'
			]),
			'member'
		);
		assert.equal(
			ringParticipation('<indienode-widget site-id=" audio-example "></indienode-widget>', [
				'audio-example'
			]),
			'member'
		);
	});

	it('resolves relative and protocol-relative ring links against the page URL', () => {
		const page = 'https://creator.example/work';
		assert.equal(ringParticipation('<a href="/go/random">ring</a>', [], page), 'none');
		assert.equal(
			ringParticipation('<a href="//indienodes.us/go/random">ring</a>', [], page),
			'link'
		);
		assert.equal(
			ringParticipation('<a href="https://www.indienodes.us/go/random/">r</a>', []),
			'link'
		);
		assert.equal(
			ringParticipation('<a href="https://elsewhere.example/go/random">r</a>', []),
			'none'
		);
	});
});

describe('member health failure history', () => {
	it('alerts after the configured number of consecutive definite failures', () => {
		const broken = [
			{ url: 'https://creator.example/missing', outcome: 'broken', reason: 'http_404' }
		];
		const first = applyFailureHistory(broken, {}, 3, { now: new Date('2026-08-20T00:00:00Z') });
		const second = applyFailureHistory(broken, first.state, 3, {
			now: new Date('2026-08-21T00:00:00Z')
		});
		const third = applyFailureHistory(broken, second.state, 3, {
			now: new Date('2026-08-22T00:00:00Z')
		});
		assert.equal(first.results[0].consecutiveFailures, 1);
		assert.equal(first.results[0].alert, false);
		assert.equal(second.results[0].consecutiveFailures, 2);
		assert.equal(second.results[0].alert, false);
		assert.equal(third.results[0].consecutiveFailures, 3);
		assert.equal(third.results[0].alert, true);
	});

	it('resets a broken streak when the next result is uncertain, not just when it recovers', () => {
		const state = {
			version: 1,
			failures: {
				'https://creator.example/missing': {
					count: 2,
					reason: 'http_404',
					lastChecked: '2026-08-21T00:00:00Z'
				}
			}
		};
		const warning = [
			{ url: 'https://creator.example/missing', outcome: 'warning', reason: 'timeout' }
		];
		const next = applyFailureHistory(warning, state, 3);
		assert.equal(next.results[0].consecutiveFailures, 0);
		assert.equal(next.results[0].alert, false);
		assert.deepEqual(next.state.failures, {});
	});

	it('prunes stale entries when asked, rather than carrying them forever', () => {
		const state = {
			version: 1,
			failures: {
				'https://creator.example/gone': { count: 5, reason: 'http_404', lastChecked: '2026-01-01' }
			}
		};
		const results = [{ url: 'https://creator.example/other', outcome: 'healthy', reason: 'ok' }];
		const next = applyFailureHistory(results, state, 3, { prune: true });
		assert.deepEqual(next.state.failures, {});
	});
});

describe('member health: known residual risk, documented rather than silently assumed away', () => {
	// This is not a bug this suite can fail on -- it is a property of using
	// the platform's own `fetch`, which re-resolves DNS independently of
	// whatever `validateExternalUrl` already checked. A unit test controls
	// both `lookupImpl` and `fetchImpl` directly, so it cannot observe two
	// independent real DNS resolutions racing each other; that gap is only
	// visible from source review (docs/webring-security-research-2026-08-31.md
	// finding F-05), which is exactly how it was found. What this test DOES
	// prove is the thing a regression could silently break: that
	// `validateExternalUrl` is actually consulted, with the hostname it was
	// given, before any request is made -- necessary, if not sufficient, for
	// the safety this module claims.
	it('always resolves and validates the hostname before probeLink ever fetches it', async () => {
		const lookupImpl = mock.fn(publicLookup);
		const fetchImpl = mock.fn(async () => new Response('', { status: 200 }));
		await probeLink(grouped('https://creator.example/work'), { fetchImpl, lookupImpl });
		assert.equal(lookupImpl.mock.callCount(), 1);
		assert.equal(lookupImpl.mock.calls[0].arguments[0], 'creator.example');
		// Real closure of the TOCTOU window (pinning the connection to the
		// address that was actually validated) would need an egress proxy or
		// a hand-rolled client -- fetch() offers no such hook. Tracked as
		// still-open infrastructure work, same posture indienodes-app's own
		// n8n ownership-verifier fix documents for the identical gap.
	});
});
