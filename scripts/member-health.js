import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

export const DEFAULT_TIMEOUT_MS = 10_000;
export const DEFAULT_CONCURRENCY = 5;
export const DEFAULT_FAILURE_THRESHOLD = 3;
export const MAX_REDIRECTS = 5;
export const MAX_SOURCE_BYTES = 2_000_000;

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
		if (normalized.startsWith('::')) return false;
		if (/^f[cd]/.test(normalized)) return false;
		if (/^fe[89ab]/.test(normalized)) return false;
		if (/^ff/.test(normalized)) return false;
		if (/^2001:db8(?::|$)/.test(normalized)) return false;
		if (/^2001:2(?::|$)/.test(normalized)) return false;
		const mapped = normalized.match(/^(?:::ffff:|::)(\d+\.\d+\.\d+\.\d+)$/);
		if (mapped) return isPublicIpAddress(mapped[1]);
		return true;
	}
	return false;
}

/** @param {string | URL} input @param {LookupAll} [lookupImpl] @returns {Promise<URL>} */
export async function validateExternalUrl(input, lookupImpl = lookup) {
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
	if (isIP(hostname)) {
		if (!isPublicIpAddress(hostname)) {
			throw new LinkHealthError('unsafe_url', 'Private and reserved IP addresses are not checked.');
		}
		return url;
	}

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
 * @typedef {'member' | 'link' | 'unmatched-widget' | 'none'} RingParticipation
 */

/**
 * Reports which supported ring tier a source page carries, if any. The
 * lightweight badge and text tiers intentionally have no member id, so their
 * canonical /go/random destination is the participation marker.
 *
 * This returns four states rather than a boolean because two of them are
 * different problems with different fixes. `unmatched-widget` means the member
 * *is* carrying an embed and only its `site-id` is wrong — the common cause
 * being the `your-ring-entry-id` placeholder that `/widget` hands out verbatim,
 * which `Widget.svelte` renders happily by falling back to a random index, so
 * the member has no way to notice. Reporting that as "no embed found" sends a
 * maintainer looking for something that is already on the page.
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

	const links = html.match(/<a\b[^>]*>/gi) || [];
	const hasRingLink = links.some((tag) => {
		const href = tag.match(/\bhref\s*=\s*["']([^"']+)["']/i)?.[1];
		if (!href) return false;
		try {
			const url = new URL(href, pageUrl);
			return (
				(url.hostname === 'indienodes.us' || url.hostname === 'www.indienodes.us') &&
				url.pathname.replace(/\/+$/, '') === '/go/random'
			);
		} catch {
			return false;
		}
	});
	if (hasRingLink) return 'link';

	return widgetTags.length ? 'unmatched-widget' : 'none';
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
 * @param {GroupedLink} link
 * @param {{ timeoutMs?: number, checkTokens?: boolean, checkParticipation?: boolean, fetchImpl?: typeof fetch, lookupImpl?: LookupAll }} [options]
 * @returns {Promise<ProbeResult>}
 */
export async function probeLink(link, options = {}) {
	const startedAt = Date.now();
	const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
	const checkTokens = options.checkTokens ?? false;
	const checkParticipation = options.checkParticipation ?? false;
	const fetchImpl = options.fetchImpl ?? fetch;
	const lookupImpl = options.lookupImpl ?? lookup;
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), timeoutMs);

	try {
		let current = link.url;
		for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects++) {
			let checkedUrl;
			try {
				checkedUrl = await validateExternalUrl(current, lookupImpl);
			} catch (error) {
				const code = error instanceof LinkHealthError ? error.code : 'network_error';
				return makeResult(link, 'warning', code, startedAt, {
					detail: safeErrorMessage(error),
					finalUrl: current
				});
			}

			const needsSourceBody =
				link.includesSource &&
				(checkParticipation || (checkTokens && link.verificationTokens.size > 0));
			let response;
			try {
				response = await fetchImpl(checkedUrl, {
					method: 'GET',
					redirect: 'manual',
					signal: controller.signal,
					headers: {
						Accept: needsSourceBody ? 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.1' : '*/*',
						...(needsSourceBody ? {} : { Range: 'bytes=0-0' }),
						'User-Agent': USER_AGENT
					}
				});
			} catch (error) {
				const reason = controller.signal.aborted ? 'timeout' : 'network_error';
				return makeResult(link, 'warning', reason, startedAt, {
					detail: safeErrorMessage(error),
					finalUrl: checkedUrl.href
				});
			}

			if (response.status >= 300 && response.status < 400) {
				const location = response.headers.get('location');
				await response.body?.cancel();
				if (!location) {
					return makeResult(link, 'warning', 'redirect_without_location', startedAt, {
						statusCode: response.status,
						finalUrl: checkedUrl.href
					});
				}
				if (redirects === MAX_REDIRECTS) {
					return makeResult(link, 'warning', 'too_many_redirects', startedAt, {
						statusCode: response.status,
						finalUrl: checkedUrl.href
					});
				}
				try {
					current = new URL(location, checkedUrl).href;
				} catch {
					return makeResult(link, 'warning', 'invalid_redirect', startedAt, {
						statusCode: response.status,
						finalUrl: checkedUrl.href
					});
				}
				continue;
			}

			if (response.status === 404 || response.status === 410) {
				await response.body?.cancel();
				return makeResult(link, 'broken', 'http_' + response.status, startedAt, {
					statusCode: response.status,
					finalUrl: checkedUrl.href
				});
			}
			if (response.status < 200 || response.status >= 300) {
				await response.body?.cancel();
				return makeResult(link, 'warning', 'http_' + response.status, startedAt, {
					statusCode: response.status,
					finalUrl: checkedUrl.href
				});
			}

			if (needsSourceBody) {
				const { text, truncated } = await readBodyUpTo(response.body, MAX_SOURCE_BYTES);
				if (checkParticipation) {
					const memberIds = [
						...new Set(
							link.references
								.filter(({ kind }) => kind === 'source')
								.map(({ memberId }) => memberId)
						)
					];
					const participation = ringParticipation(text, memberIds, checkedUrl.href);
					if (participation === 'unmatched-widget') {
						return makeResult(link, 'warning', 'ring_widget_site_id_unmatched', startedAt, {
							statusCode: response.status,
							finalUrl: checkedUrl.href,
							detail:
								'The page carries an <indienode-widget>, but its site-id matches no member. ' +
								'Expected ' +
								memberIds.map((id) => '"' + id + '"').join(' or ') +
								'. The widget still renders, so the member cannot see this; the fix is one attribute.'
						});
					}
					if (participation === 'none' && truncated) {
						return makeResult(link, 'warning', 'ring_participation_indeterminate', startedAt, {
							statusCode: response.status,
							finalUrl: checkedUrl.href,
							detail:
								'The page exceeded the ' +
								MAX_SOURCE_BYTES.toLocaleString('en-US') +
								'-byte read limit before any ring embed was found. Embeds are usually in the ' +
								'footer, which is last, so this is not evidence of absence. Confirm by hand.'
						});
					}
					if (participation === 'none') {
						return makeResult(link, 'warning', 'ring_participation_missing', startedAt, {
							statusCode: response.status,
							finalUrl: checkedUrl.href,
							detail: 'No supported ring embed was found in the page.'
						});
					}
				}
				if (checkTokens) {
					const missingTokens = [...link.verificationTokens].filter(
						(token) => !hasVerificationToken(text, token)
					);
					if (missingTokens.length) {
						return makeResult(link, 'warning', 'verification_token_missing', startedAt, {
							statusCode: response.status,
							finalUrl: checkedUrl.href,
							detail: truncated
								? 'Token was not found in the first 2 MB of the page.'
								: 'Token was not found in the page.'
						});
					}
				}
			} else {
				await response.body?.cancel();
			}
			return makeResult(link, 'healthy', 'ok', startedAt, {
				statusCode: response.status,
				finalUrl: checkedUrl.href
			});
		}
	} finally {
		clearTimeout(timeout);
	}
	return makeResult(link, 'warning', 'unknown', startedAt);
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
