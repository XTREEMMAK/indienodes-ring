import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

export const DEFAULT_TIMEOUT_MS = 10_000;
export const DEFAULT_CONCURRENCY = 5;
export const DEFAULT_FAILURE_THRESHOLD = 3;
export const MAX_REDIRECTS = 5;
export const MAX_SOURCE_BYTES = 2_000_000;

/**
 * The one host this project's own hosting runs on. A `source_url` that
 * resolves here (no subdomains) is a page IndieNodes generated, which links
 * out to the member's actual site via a fixed `.link-primary` element in the
 * shared template -- see `extractDeepLinkUrl` and docs/member-link-health.md.
 */
export const DEEP_LINK_HOSTNAME = 'pages.kjnet.us';

const USER_AGENT = 'IndieNodesMemberHealth/1.0 (+https://indienodes.us)';

/**
 * @typedef {object} MemberLink
 * @property {string} url
 * @property {'source' | 'media'} kind
 * @property {string} memberId
 * @property {string} memberFile
 * @property {string} field
 * @property {string} verificationToken
 */

/**
 * @typedef {object} GroupedLink
 * @property {string} url
 * @property {boolean} includesSource
 * @property {Set<string>} verificationTokens
 * @property {MemberLink[]} references
 */

/**
 * @typedef {object} ProbeResult
 * @property {string} url
 * @property {'healthy' | 'broken' | 'warning'} outcome
 * @property {string} reason
 * @property {number} durationMs
 * @property {{ memberId: string, memberFile: string, field: string }[]} references
 * @property {number} [statusCode]
 * @property {string} [finalUrl]
 * @property {string} [detail]
 * @property {string} [deepLinkUrl]
 * @property {string} [participationUrl]
 * @property {number} [consecutiveFailures]
 * @property {boolean} [alert]
 */

/**
 * @typedef {object} FailureState
 * @property {number} [version]
 * @property {Record<string, { count: number, reason: string, lastChecked: string }>} [failures]
 */

/** @typedef {(hostname: string, options: { all: true, verbatim: true }) => Promise<{ address: string, family: number }[]>} LookupAll */

export class LinkHealthError extends Error {
	/** @param {string} code @param {string} message */
	constructor(code, message) {
		super(message);
		this.name = 'LinkHealthError';
		this.code = code;
	}
}

/** @param {Record<string, any>} entry @param {string} file @returns {MemberLink[]} */
export function collectMemberLinks(entry, file) {
	/** @type {MemberLink[]} */
	const links = [];
	/** @param {unknown} url @param {string} field @param {'source' | 'media'} kind */
	const add = (url, field, kind) => {
		if (typeof url !== 'string' || url.trim() === '') return;
		links.push({
			url: url.trim(),
			kind,
			memberId: entry.id || file.replace(/\.json$/i, ''),
			memberFile: file,
			field,
			verificationToken: kind === 'source' ? entry.verification_token || '' : ''
		});
	};

	add(entry.source_url, 'source_url', 'source');
	add(entry.thumb_url, 'thumb_url', 'media');
	add(entry.preview_url, 'preview_url', 'media');
	add(entry.trailer_url, 'trailer_url', 'media');
	for (const [index, track] of (entry.tracks || []).entries()) {
		add(track?.media_url, 'tracks[' + index + '].media_url', 'media');
	}
	for (const [index, page] of (entry.pages || []).entries()) {
		add(page?.image_url, 'pages[' + index + '].image_url', 'media');
	}
	for (const [index, artwork] of (entry.artworks || []).entries()) {
		add(artwork?.image_url, 'artworks[' + index + '].image_url', 'media');
		add(artwork?.external_url, 'artworks[' + index + '].external_url', 'media');
	}
	return links;
}

/** @param {MemberLink[][]} linkLists @returns {GroupedLink[]} */
export function groupLinksByUrl(linkLists) {
	/** @type {Map<string, GroupedLink>} */
	const grouped = new Map();
	for (const link of linkLists.flat()) {
		const existing = grouped.get(link.url);
		if (existing) {
			existing.references.push(link);
			if (link.verificationToken) existing.verificationTokens.add(link.verificationToken);
			if (link.kind === 'source') existing.includesSource = true;
			continue;
		}
		grouped.set(link.url, {
			url: link.url,
			includesSource: link.kind === 'source',
			verificationTokens: new Set(link.verificationToken ? [link.verificationToken] : []),
			references: [link]
		});
	}
	return [...grouped.values()];
}

/** @param {string} address */
export function isPublicIpAddress(address) {
	const family = isIP(address);
	if (family === 4) {
		const [a, b, c] = address.split('.').map(Number);
		if (a === 0 || a === 10 || a === 127) return false;
		if (a === 100 && b >= 64 && b <= 127) return false;
		if (a === 169 && b === 254) return false;
		if (a === 172 && b >= 16 && b <= 31) return false;
		if (a === 192 && (b === 0 || b === 168)) return false;
		if (a === 198 && (b === 18 || b === 19)) return false;
		if (a === 192 && b === 0 && c === 2) return false;
		if (a === 198 && b === 51 && c === 100) return false;
		if (a === 203 && b === 0 && c === 113) return false;
		return a < 224;
	}
	if (family === 6) {
		const normalized = address.toLowerCase().split('%')[0];
		if (normalized === '::' || normalized === '::1') return false;
		// Checked before the blanket `::`-prefix rejection below: an IPv4-mapped
		// address (::ffff:x.x.x.x, or the deprecated ::x.x.x.x form) also starts
		// with `::`, and unwrapping it to re-check the embedded IPv4 address is
		// the whole point of this branch. Ordered after that rejection instead,
		// it would catch every mapped address first and this line could never
		// run -- which is exactly the bug this comment replaces: every mapped
		// address, including a plainly public one like ::ffff:93.184.216.34,
		// was being rejected outright rather than unwrapped and re-checked.
		const mapped = normalized.match(/^(?:::ffff:|::)(\d+\.\d+\.\d+\.\d+)$/);
		if (mapped) return isPublicIpAddress(mapped[1]);
		if (normalized.startsWith('::')) return false;
		if (/^f[cd]/.test(normalized)) return false;
		if (/^fe[89ab]/.test(normalized)) return false;
		if (/^ff/.test(normalized)) return false;
		if (/^2001:db8(?::|$)/.test(normalized)) return false;
		if (/^2001:2(?::|$)/.test(normalized)) return false;
		return true;
	}
	return false;
}

/**
 * The safety checks decidable from a URL string alone, with no DNS lookup.
 *
 * Split out of `validateExternalUrl` below so `validate-ring.js`'s publish
 * gate can reuse exactly this rule rather than a second, hand-copied version
 * of the private-IP-range table -- two implementations of one rule is
 * exactly the kind of drift this project has already been bitten by once
 * (see docs/decisions.md's account of `src/lib/slug.js` and
 * `build_workflows.py` independently implementing the same id rule and
 * diverging). A publish-time gate has no business making a network call per
 * URL anyway, and the thing it needs to catch -- a URL naming a private IP or
 * embedding credentials -- is visible in the string itself.
 * @param {string | URL} input
 * @returns {{ url: URL, hostname: string }} `hostname` is fully normalized
 *   (unbracketed, no trailing dot), for a caller that wants to skip a DNS
 *   lookup on it: `isIP(hostname)` answers that only correctly using this
 *   value, not `url.hostname`, which keeps IPv6 literals bracketed.
 */
export function assertStaticallySafeUrl(input) {
	let url;
	try {
		url = input instanceof URL ? new URL(input.href) : new URL(input);
	} catch {
		throw new LinkHealthError('invalid_url', 'URL could not be parsed.');
	}
	if (url.protocol !== 'http:' && url.protocol !== 'https:') {
		throw new LinkHealthError('unsafe_url', 'Only HTTP and HTTPS URLs can be checked.');
	}
	if (url.username || url.password) {
		throw new LinkHealthError('unsafe_url', 'URLs containing credentials are not checked.');
	}

	const rawHostname = url.hostname.toLowerCase();
	const unbracketedHostname =
		rawHostname.startsWith('[') && rawHostname.endsWith(']')
			? rawHostname.slice(1, -1)
			: rawHostname;
	const hostname = unbracketedHostname.endsWith('.')
		? unbracketedHostname.slice(0, -1)
		: unbracketedHostname;
	const blockedNames = new Set(['localhost', 'metadata.google.internal', 'instance-data']);
	if (
		blockedNames.has(hostname) ||
		['.localhost', '.local', '.internal', '.home.arpa'].some((suffix) => hostname.endsWith(suffix))
	) {
		throw new LinkHealthError('unsafe_url', 'Local and internal hostnames are not checked.');
	}
	if (isIP(hostname) && !isPublicIpAddress(hostname)) {
		throw new LinkHealthError('unsafe_url', 'Private and reserved IP addresses are not checked.');
	}
	return { url, hostname };
}

/** @param {string | URL} input @param {LookupAll} [lookupImpl] @returns {Promise<URL>} */
export async function validateExternalUrl(input, lookupImpl = lookup) {
	const { url, hostname } = assertStaticallySafeUrl(input);
	if (isIP(hostname)) return url; // A literal IP: already checked above, nothing left to resolve.

	let addresses;
	try {
		addresses = await lookupImpl(hostname, { all: true, verbatim: true });
	} catch (error) {
		throw new LinkHealthError('dns_error', safeErrorMessage(error));
	}
	if (!addresses.length) {
		throw new LinkHealthError('dns_error', 'The hostname returned no addresses.');
	}
	if (addresses.some(({ address }) => !isPublicIpAddress(address))) {
		throw new LinkHealthError(
			'unsafe_url',
			'The hostname resolves to a private or reserved address.'
		);
	}
	return url;
}

/** @param {string} html @param {string} token */
export function hasVerificationToken(html, token) {
	const tags = html.match(/<meta\b[^>]*>/gi) || [];
	return tags.some((tag) => {
		if (!/name=["']indienode-verification["']/i.test(tag)) return false;
		const content = tag.match(/content=["']([^"']*)["']/i);
		return content?.[1] === token;
	});
}

/**
 * Every host a ring embed can legitimately point at. `app.indienodes.us` is
 * the one indienodes-app actually hands out (its `SITE_ORIGIN`), so every
 * snippet a member copies from /widget names it; the bare and www hosts are
 * kept so older and hand-written embeds still count. Missing the app host was
 * why the 2026-09-14 report failed every member despite each carrying an
 * embed.
 */
export const RING_HOSTNAMES = new Set(['indienodes.us', 'www.indienodes.us', 'app.indienodes.us']);

/**
 * Resolves a raw href/src and returns it only if it points at a ring host.
 * @param {string | undefined} raw
 * @param {string} [pageUrl]
 * @returns {URL | null}
 */
function ringUrl(raw, pageUrl) {
	if (!raw) return null;
	try {
		const url = new URL(raw, pageUrl);
		return RING_HOSTNAMES.has(url.hostname) ? url : null;
	} catch {
		return null;
	}
}

/** @param {URL} url */
function ringPath(url) {
	return url.pathname.replace(/\/+$/, '');
}

/**
 * @param {string} html
 * @param {string} tagName
 * @param {string} attribute
 * @returns {string[]}
 */
function attributeValues(html, tagName, attribute) {
	const pattern = new RegExp('\\b' + attribute + '\\s*=\\s*["\']([^"\']+)["\']', 'i');
	return (html.match(new RegExp('<' + tagName + '\\b[^>]*>', 'gi')) || []).flatMap((tag) => {
		const value = tag.match(pattern)?.[1];
		return value ? [value] : [];
	});
}

/**
 * @typedef {'member' | 'link' | 'unmatched-widget' | 'none'} RingParticipation
 */

/**
 * Reports which supported ring tier a source page carries, if any. The
 * lightweight badge and text tiers intentionally have no member id, so their
 * canonical /go/random destination is the participation marker -- or, for the
 * badge, the badge image itself, which members do rewrap: a badge inside a
 * `<span>`, linked to the app's home page rather than /go/random, is still
 * unmistakably the ring's badge. A bare link to the home page is not counted,
 * since an ordinary mention of IndieNodes looks exactly like that.
 *
 * The script tier (`embed.v1.js` plus `<indienode-widget>`) is matched by the
 * element alone: the element carries the site-id, and the script's own host
 * says nothing about which member it is.
 *
 * Three embed tiers count, not two. Besides the full `<indienode-widget>`, an
 * `<iframe>` pointing at /embed-frame?site-id=<id> is a first-class tier and is
 * the one webring-security-research-2026-08-31.md recommends as the *default*
 * member integration, because a sandboxed cross-origin frame cannot reach the
 * host page the way the script widget can. It carries a member id in its query
 * string, so it is matched exactly like the widget rather than like the
 * id-less link tiers.
 *
 * This returns four states rather than a boolean because two of them are
 * different problems with different fixes. `unmatched-widget` means the member
 * *is* carrying an embed — widget or frame — and only its `site-id` is wrong,
 * the common cause being the `your-ring-entry-id` placeholder that `/widget`
 * hands out verbatim, which `Widget.svelte` renders happily by falling back to
 * a random index, so the member has no way to notice. Reporting that as "no
 * embed found" sends a maintainer looking for something already on the page.
 *
 * The `<a>` fallback cannot rescue an unmatched widget, incidentally: the full
 * widget builds its /go/random link at runtime, so it is never in the served
 * markup this reads.
 *
 * @param {string} html
 * @param {string[]} memberIds
 * @param {string} [pageUrl] the page's own final URL, used to resolve relative
 *   and protocol-relative hrefs. Without it, only absolute hrefs can match.
 * @returns {RingParticipation}
 */
export function ringParticipation(html, memberIds = [], pageUrl = undefined) {
	const wanted = memberIds.map((id) => id.trim().toLowerCase());
	const widgetTags = html.match(/<indienode-widget\b[^>]*>/gi) || [];
	const hasMemberWidget = widgetTags.some((tag) => {
		const siteId = tag.match(/\bsite-id\s*=\s*["']([^"']+)["']/i)?.[1];
		if (!siteId) return false;
		return wanted.includes(siteId.trim().toLowerCase());
	});
	if (hasMemberWidget) return 'member';

	const embedFrames = attributeValues(html, 'iframe', 'src').flatMap((src) => {
		const url = ringUrl(src, pageUrl);
		return url && ringPath(url) === '/embed-frame' ? [url] : [];
	});
	const hasMemberFrame = embedFrames.some((url) => {
		const siteId = url.searchParams.get('site-id');
		if (!siteId) return false;
		return wanted.includes(siteId.trim().toLowerCase());
	});
	if (hasMemberFrame) return 'member';

	const hasRingLink = attributeValues(html, 'a', 'href').some((href) => {
		const url = ringUrl(href, pageUrl);
		return url !== null && ringPath(url) === '/go/random';
	});
	if (hasRingLink) return 'link';

	const hasBadge = attributeValues(html, 'img', 'src').some((src) => {
		const url = ringUrl(src, pageUrl);
		return url !== null && url.pathname.startsWith('/badges/') && /\.svg$/i.test(url.pathname);
	});
	if (hasBadge) return 'link';

	return widgetTags.length || embedFrames.length ? 'unmatched-widget' : 'none';
}

/**
 * Finds the outbound "member's own site" link on a `DEEP_LINK_HOSTNAME` page,
 * generated by the shared IndieNodes page template. Not a general-purpose
 * link finder: it looks for exactly one fixed marker, the `link-primary`
 * class on an `<a>`, the same way `ringParticipation` above looks for exactly
 * one fixed widget/iframe/link shape rather than crawling for "a link
 * somewhere." Absence is not an error -- some generated pages are the
 * member's only presence and carry no such link.
 * @param {string} html
 * @param {string} [pageUrl] the page's own final URL, used to resolve a
 *   relative href.
 * @returns {string | null}
 */
export function extractDeepLinkUrl(html, pageUrl = undefined) {
	const links = html.match(/<a\b[^>]*>/gi) || [];
	for (const tag of links) {
		const className = tag.match(/\bclass\s*=\s*["']([^"']*)["']/i)?.[1] || '';
		if (!className.split(/\s+/).includes('link-primary')) continue;
		const href = tag.match(/\bhref\s*=\s*["']([^"']+)["']/i)?.[1];
		if (!href) continue;
		try {
			return new URL(href, pageUrl).href;
		} catch {
			continue;
		}
	}
	return null;
}

/** @param {ReadableStream<Uint8Array> | null} body @param {number} limit */
async function readBodyUpTo(body, limit) {
	if (!body) return { text: '', truncated: false };
	const reader = body.getReader();
	const decoder = new TextDecoder();
	let size = 0;
	let text = '';
	while (true) {
		const { value, done } = await reader.read();
		if (done) break;
		size += value.byteLength;
		if (size > limit) {
			const allowed = value.subarray(0, Math.max(0, value.byteLength - (size - limit)));
			text += decoder.decode(allowed, { stream: true });
			await reader.cancel();
			return { text: text + decoder.decode(), truncated: true };
		}
		text += decoder.decode(value, { stream: true });
	}
	return { text: text + decoder.decode(), truncated: false };
}

/** @param {unknown} error */
function safeErrorMessage(error) {
	if (error instanceof Error && error.message) return error.message.slice(0, 240);
	return 'Request failed.';
}

/**
 * @typedef {object} FetchedPage
 * @property {true} ok
 * @property {URL} checkedUrl
 * @property {number} statusCode
 * @property {{ text: string, truncated: boolean } | null} body
 */

/**
 * @typedef {object} FetchFailure
 * @property {false} ok
 * @property {'broken' | 'warning'} outcome
 * @property {string} reason
 * @property {{ statusCode?: number, finalUrl?: string, detail?: string }} details
 */

/**
 * GETs a URL the only way this module ever does: every hop re-validated
 * against private and reserved addresses before it is requested, redirects
 * followed by hand up to MAX_REDIRECTS, one timeout over the whole chain and
 * the body read, and the body capped at MAX_SOURCE_BYTES. Shared by the source
 * page and its site-root fallback, so the second request cannot quietly be a
 * weaker copy of the first.
 * @param {string} startUrl
 * @param {{ timeoutMs: number, fetchImpl: typeof fetch, lookupImpl: LookupAll, wantsBody: (url: URL) => boolean }} options
 * @returns {Promise<FetchedPage | FetchFailure>}
 */
async function fetchValidated(startUrl, { timeoutMs, fetchImpl, lookupImpl, wantsBody }) {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), timeoutMs);
	/**
	 * @param {'broken' | 'warning'} outcome
	 * @param {string} reason
	 * @param {FetchFailure['details']} details
	 * @returns {FetchFailure}
	 */
	const fail = (outcome, reason, details) => ({ ok: false, outcome, reason, details });

	try {
		let current = startUrl;
		for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects++) {
			let checkedUrl;
			try {
				checkedUrl = await validateExternalUrl(current, lookupImpl);
			} catch (error) {
				const code = error instanceof LinkHealthError ? error.code : 'network_error';
				return fail('warning', code, { detail: safeErrorMessage(error), finalUrl: current });
			}

			const needsBody = wantsBody(checkedUrl);
			let response;
			try {
				response = await fetchImpl(checkedUrl, {
					method: 'GET',
					redirect: 'manual',
					signal: controller.signal,
					headers: {
						Accept: needsBody ? 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.1' : '*/*',
						...(needsBody ? {} : { Range: 'bytes=0-0' }),
						'User-Agent': USER_AGENT
					}
				});
			} catch (error) {
				const reason = controller.signal.aborted ? 'timeout' : 'network_error';
				return fail('warning', reason, {
					detail: safeErrorMessage(error),
					finalUrl: checkedUrl.href
				});
			}

			const statusDetails = { statusCode: response.status, finalUrl: checkedUrl.href };
			if (response.status >= 300 && response.status < 400) {
				const location = response.headers.get('location');
				await response.body?.cancel();
				if (!location) return fail('warning', 'redirect_without_location', statusDetails);
				if (redirects === MAX_REDIRECTS)
					return fail('warning', 'too_many_redirects', statusDetails);
				try {
					current = new URL(location, checkedUrl).href;
				} catch {
					return fail('warning', 'invalid_redirect', statusDetails);
				}
				continue;
			}

			if (response.status === 404 || response.status === 410) {
				await response.body?.cancel();
				return fail('broken', 'http_' + response.status, statusDetails);
			}
			if (response.status < 200 || response.status >= 300) {
				await response.body?.cancel();
				return fail('warning', 'http_' + response.status, statusDetails);
			}

			if (!needsBody) {
				await response.body?.cancel();
				return { ok: true, checkedUrl, statusCode: response.status, body: null };
			}
			const body = await readBodyUpTo(response.body, MAX_SOURCE_BYTES);
			return { ok: true, checkedUrl, statusCode: response.status, body };
		}
	} finally {
		clearTimeout(timeout);
	}
	return fail('warning', 'unknown', {});
}

/** @typedef {RingParticipation | 'indeterminate'} PageParticipation */

/**
 * How good a participation result is, for choosing between the source page
 * and its site root. `member` and `link` both pass; `indeterminate` outranks
 * `none` because it is not a claim of absence.
 * @type {Record<PageParticipation, number>}
 */
const PARTICIPATION_RANK = { none: 0, indeterminate: 1, 'unmatched-widget': 2, link: 3, member: 3 };

/**
 * @param {{ text: string, truncated: boolean }} body
 * @param {string[]} memberIds
 * @param {string} pageUrl
 * @returns {PageParticipation}
 */
function pageParticipation(body, memberIds, pageUrl) {
	const found = ringParticipation(body.text, memberIds, pageUrl);
	return found === 'none' && body.truncated ? 'indeterminate' : found;
}

/**
 * The site root to look at when a source page carries no ring embed, or null
 * when there is no separate, member-owned root to try.
 *
 * Members do put the ring on their home page rather than the page they
 * submitted (comic-nori-jammy's footer link is on frammyjammy.com/, not on
 * /suzu-and-jack/), and failing them for it reported a participating member
 * as absent. This is one fixed hop to the same origin's `/`, not a crawl: the
 * URL comes from the already-validated source URL, never from page content.
 *
 * pages.kjnet.us is excluded because its root is shared by every generated
 * page: an id-less badge there would count for all of them at once.
 * @param {URL} pageUrl the source page's final, validated URL
 * @returns {string | null}
 */
export function siteRootFallbackUrl(pageUrl) {
	if (pageUrl.hostname === DEEP_LINK_HOSTNAME) return null;
	if (pageUrl.pathname === '/') return null;
	return new URL('/', pageUrl).href;
}

/** @param {string} hostname */
function siteHostname(hostname) {
	return hostname.replace(/^www\./, '');
}

/**
 * @param {GroupedLink} link
 * @param {{ timeoutMs?: number, checkTokens?: boolean, checkParticipation?: boolean, checkDeepLinks?: boolean, fetchImpl?: typeof fetch, lookupImpl?: LookupAll }} [options]
 * @returns {Promise<ProbeResult>}
 */
export async function probeLink(link, options = {}) {
	const startedAt = Date.now();
	const checkTokens = options.checkTokens ?? false;
	const checkParticipation = options.checkParticipation ?? false;
	const checkDeepLinks = options.checkDeepLinks ?? false;
	const fetchOptions = {
		timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
		fetchImpl: options.fetchImpl ?? fetch,
		lookupImpl: options.lookupImpl ?? lookup
	};
	/** @param {URL} url */
	const isDeepLinkPage = (url) =>
		link.includesSource && checkDeepLinks && url.hostname === DEEP_LINK_HOSTNAME;

	const page = await fetchValidated(link.url, {
		...fetchOptions,
		wantsBody: (url) =>
			link.includesSource &&
			(checkParticipation ||
				(checkTokens && link.verificationTokens.size > 0) ||
				isDeepLinkPage(url))
	});
	if (!page.ok) return makeResult(link, page.outcome, page.reason, startedAt, page.details);

	const { checkedUrl, statusCode, body } = page;
	if (!body) {
		return makeResult(link, 'healthy', 'ok', startedAt, { statusCode, finalUrl: checkedUrl.href });
	}

	const deepLinkUrl = isDeepLinkPage(checkedUrl)
		? extractDeepLinkUrl(body.text, checkedUrl.href)
		: null;
	/** @type {Record<string, any>} */
	let details = { statusCode, finalUrl: checkedUrl.href, ...(deepLinkUrl ? { deepLinkUrl } : {}) };

	if (checkParticipation) {
		const memberIds = [
			...new Set(
				link.references.filter(({ kind }) => kind === 'source').map(({ memberId }) => memberId)
			)
		];
		let participation = pageParticipation(body, memberIds, checkedUrl.href);
		let participationUrl = checkedUrl.href;
		let rootNote = '';

		const rootUrl =
			PARTICIPATION_RANK[participation] < PARTICIPATION_RANK.link
				? siteRootFallbackUrl(checkedUrl)
				: null;
		if (rootUrl) {
			const root = await fetchValidated(rootUrl, { ...fetchOptions, wantsBody: () => true });
			if (!root.ok) {
				rootNote =
					' The site root (' +
					rootUrl +
					') was also tried but could not be read: ' +
					root.reason.replaceAll('_', ' ') +
					'.';
			} else if (siteHostname(root.checkedUrl.hostname) !== siteHostname(checkedUrl.hostname)) {
				// A root that redirects to another site (a link-in-bio page, a
				// platform profile) is not the member's own site, so an embed
				// there is not counted.
				rootNote =
					' The site root (' +
					rootUrl +
					') redirects off-site to ' +
					root.checkedUrl.href +
					', so it was not counted.';
			} else {
				const atRoot = pageParticipation(
					root.body ?? { text: '', truncated: false },
					memberIds,
					root.checkedUrl.href
				);
				if (PARTICIPATION_RANK[atRoot] > PARTICIPATION_RANK[participation]) {
					participation = atRoot;
					participationUrl = root.checkedUrl.href;
				} else {
					rootNote = ' The site root (' + root.checkedUrl.href + ') was also checked.';
				}
			}
		}

		const foundAtRoot = participationUrl !== checkedUrl.href;
		const where = foundAtRoot ? 'The site root (' + participationUrl + ')' : 'The page';
		if (foundAtRoot) details = { ...details, participationUrl };

		if (participation === 'unmatched-widget') {
			return makeResult(link, 'warning', 'ring_widget_site_id_unmatched', startedAt, {
				...details,
				detail:
					where +
					' carries a ring embed (widget, script, or /embed-frame iframe), but its ' +
					'site-id matches no member. Expected ' +
					memberIds.map((id) => '"' + id + '"').join(' or ') +
					'. The embed still renders, so the member cannot see this; the fix is one attribute.' +
					rootNote
			});
		}
		if (participation === 'indeterminate') {
			return makeResult(link, 'warning', 'ring_participation_indeterminate', startedAt, {
				...details,
				detail:
					where +
					' exceeded the ' +
					MAX_SOURCE_BYTES.toLocaleString('en-US') +
					'-byte read limit before any ring embed was found. Embeds are usually in the ' +
					'footer, which is last, so this is not evidence of absence. Confirm by hand.' +
					rootNote
			});
		}
		if (participation === 'none') {
			return makeResult(link, 'warning', 'ring_participation_missing', startedAt, {
				...details,
				detail: 'No supported ring embed was found in the page.' + rootNote
			});
		}
	}

	if (checkTokens) {
		// Always the source page: the token proves ownership of that URL, and
		// finding the embed on the site root does not move that proof there.
		const missingTokens = [...link.verificationTokens].filter(
			(token) => !hasVerificationToken(body.text, token)
		);
		if (missingTokens.length) {
			return makeResult(link, 'warning', 'verification_token_missing', startedAt, {
				...details,
				detail: body.truncated
					? 'Token was not found in the first 2 MB of the page.'
					: 'Token was not found in the page.'
			});
		}
	}
	return makeResult(link, 'healthy', 'ok', startedAt, details);
}

/**
 * @param {GroupedLink} link
 * @param {'healthy' | 'broken' | 'warning'} outcome
 * @param {string} reason
 * @param {number} startedAt
 * @param {Record<string, any>} [details]
 * @returns {ProbeResult}
 */
function makeResult(link, outcome, reason, startedAt, details = {}) {
	return {
		url: link.url,
		outcome,
		reason,
		durationMs: Date.now() - startedAt,
		references: link.references.map(({ memberId, memberFile, field }) => ({
			memberId,
			memberFile,
			field
		})),
		...details
	};
}

/**
 * @template T, R
 * @param {T[]} items
 * @param {number} concurrency
 * @param {(item: T, index: number) => Promise<R>} worker
 * @returns {Promise<R[]>}
 */
export async function mapConcurrent(items, concurrency, worker) {
	const output = new Array(items.length);
	let cursor = 0;
	const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
		while (cursor < items.length) {
			const index = cursor++;
			output[index] = await worker(items[index], index);
		}
	});
	await Promise.all(workers);
	return output;
}

/**
 * @param {Array<{ url: string, outcome: string, reason: string, [key: string]: any }>} results
 * @param {FailureState} state
 * @param {number} threshold
 * @param {{ prune?: boolean, now?: Date }} [options]
 */
export function applyFailureHistory(results, state, threshold, options = {}) {
	const now = (options.now ?? new Date()).toISOString();
	const previous = state?.version === 1 && state.failures ? state.failures : {};
	/** @type {Record<string, { count: number, reason: string, lastChecked: string }>} */
	const failures = options.prune ? {} : { ...previous };
	const enriched = results.map((item) => {
		if (item.outcome !== 'broken') {
			delete failures[item.url];
			return { ...item, consecutiveFailures: 0, alert: false };
		}
		const count = (previous[item.url]?.count || 0) + 1;
		failures[item.url] = { count, reason: item.reason, lastChecked: now };
		return { ...item, consecutiveFailures: count, alert: count >= threshold };
	});
	return { results: enriched, state: { version: 1, failures } };
}
