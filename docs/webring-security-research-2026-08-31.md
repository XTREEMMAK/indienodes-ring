# WebRing security research and implementation review

**Date:** 2026-08-31  
**Ring repository revision:** `28737b8a9ffc31dfc1df0d3fbe0cf4ac53069a02`  
**Companion app revision reviewed:** `4214186e63b5ff657efd560ed2ea215e52ca8e2c`

## Executive summary

No critical vulnerability was confirmed in the two current entries or in the
published `ring.json`. The repository's publish validator passes, its locked
dependencies currently have no npm advisories, and several controls are already
well designed: strict JSON shapes, HTTPS-only URLs, redirect-by-redirect health
checks, private-address detection, response and time limits, output sanitization
in the official client, `noopener`/`noreferrer` navigation, a non-root static
server, and a reviewed emergency-removal path.

The WebRing is nevertheless **not yet a zero-trust embed**. The recommended
full widget is JavaScript loaded from IndieNodes and executed with the same
browser authority as each member's own JavaScript. Shadow DOM isolates CSS; it
does not isolate cookies, page content, forms, storage, or same-origin API calls.
If the IndieNodes origin, build pipeline, GitHub account, dependency graph, or
delivery path is compromised, every site using the script can be compromised in
turn. OWASP describes this exact third-party JavaScript risk as loss of control,
arbitrary code execution, and data leakage. This is the principal risk to member
sites and should be addressed before the script widget is promoted as the safest
or default integration.

The audit also found a high-impact CI trust issue: the auto-build workflow puts a
write-capable PAT into a checkout of a same-repository PR branch and then runs
that branch's `npm ci`, lifecycle code, Prettier, and ring builder. Compromise of
the branch-producing automation or a malicious same-repository branch can expose
the PAT. The data health checker has good SSRF defenses but resolves a hostname
once for validation and lets `fetch` resolve it again, leaving a DNS-rebinding
time-of-check/time-of-use gap. Unsafe/private URLs are warnings rather than
publish failures, even though those URLs are later delivered to visitors'
browsers.

The recommended posture is:

1. Make a sandboxed, cross-origin iframe or static link/badge the default member
   integration.
2. If the script remains available, publish immutable content-addressed builds
   with Subresource Integrity (SRI), a documented security contract, and a
   revocation process.
3. Remove write credentials from any job that executes PR-controlled code.
4. Treat every ring field and URL as untrusted at every consumer, including the
   official widget; validate at runtime and fail closed.
5. Make public-address failures publish-blocking and put automated URL fetches
   behind DNS-pinned, network-restricted egress.

## Scope and method

This was a source and configuration review, not an exploit attempt or full
penetration test. It covered:

- this repository's member files, generated ring document, JSON Schemas,
  validators, URL health checker, GitHub Actions, publishing workflow, and
  operating documentation;
- the public `XTREEMMAK/indienodes-app` companion repository, especially the
  custom-element widget, ring loader, HTML sanitization, redirect page, Caddy
  headers, and build configuration;
- current OWASP guidance, browser security standards, GitHub Actions guidance,
  historical WebRing CVEs, and current npm advisory data;
- a limited live check of the public artifact endpoints on 2026-08-31.

Commands run locally included `npm run validate:publish`, `npm audit --json` in
this repository, and both full and production-only npm audits in the companion
app. No member site was subjected to payloads, port scanning, authentication
testing, or destructive requests.

## System and trust boundaries

| Flow                            | Data/code owner                 | Where it executes or is consumed                 | Main risk                                                                  |
| ------------------------------- | ------------------------------- | ------------------------------------------------ | -------------------------------------------------------------------------- |
| `members/*.json` → `ring.json`  | Member + curator + CI           | Every client of the public ring                  | Stored untrusted text and URLs become a shared distribution channel        |
| `embed.v1.js` → member page     | IndieNodes build/delivery chain | **Inside the member page's origin and JS realm** | A compromise gains the host page's script privileges                       |
| Widget → `ring.json`            | IndieNodes                      | Browser on a member site                         | Mutable remote data controls outbound navigation                           |
| App → member media URLs         | Individual creators             | Visitor's browser                                | Tracking, content replacement, resource exhaustion, local-address requests |
| Health job → member URLs        | Members/DNS operators           | GitHub or Semaphore runner                       | SSRF, DNS rebinding, oversized/slow responses                              |
| PR branch → auto-build workflow | Automation or a writer          | GitHub runner holding a PAT                      | CI credential theft and repository write                                   |

The most important distinction is between **style isolation** and **authority
isolation**. The widget uses an open shadow root, which is helpful for CSS and
component encapsulation, but the bundle is still an ordinary script in the
member page. The browser does not give it a separate security principal.

## WebRing-specific vulnerability research

No dedicated OWASP WebRing category, cheat sheet, or WebRing-specific Top 10
entry was found. That is expected: a WebRing is an application pattern, while
OWASP classifies the underlying failure modes.

Historical vulnerability databases do contain product-specific WebRing issues:

- [CVE-2007-1328](https://cve.mitre.org/cgi-bin/cvename.cgi?name=CVE-2007-1328)
  was stored/reflected XSS in the submission interface of BJ Webring.
- [CVE-2006-4129](https://app.opencve.io/cve/CVE-2006-4129) was remote PHP file
  inclusion/code execution in an old Joomla Webring component.

Neither product nor codebase is used here, so these CVEs do **not** apply to
IndieNodes. They are useful precedent: WebRing software tends to accept member
input, render shared listings, redirect users, and historically include remote
code. Those surfaces map directly to ordinary injection, redirect, dependency,
and supply-chain controls.

The relevant current OWASP Top 10:2025 categories are:

| OWASP area                                                                                                  | Application here                                                                                                  |
| ----------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| [A01 Broken Access Control](https://owasp.org/Top10/2025/0x00_2025-Introduction/)                           | SSRF is included in A01 in the 2025 list; the health/verifier egress boundary is in scope                         |
| [A02 Security Misconfiguration](https://owasp.org/Top10/2025/0x00_2025-Introduction/)                       | Browser headers, CORS, workflow permissions, branch protection, cache policy, and iframe sandboxing               |
| [A03 Software Supply Chain Failures](https://owasp.org/Top10/2025/A03_2025-Software_Supply_Chain_Failures/) | Remotely served widget JS, npm dependencies, mutable Actions tags, PAT-bearing CI, build provenance               |
| [A05 Injection](https://owasp.org/Top10/2025/A05_2025-Injection/)                                           | Member HTML/text rendered by clients, URL attributes, generated markup, workflow inputs                           |
| A06 Insecure Design                                                                                         | Giving a third-party script full member-origin authority when the feature only needs isolated navigation controls |
| A08 Software or Data Integrity Failures                                                                     | Clients trusting mutable `ring.json` without runtime schema/protocol validation                                   |
| A09 Logging and Alerting Failures                                                                           | Detecting widget artifact change, domain takeover, CI credential misuse, and malicious-member incidents           |

## Detailed findings

### F-01 — High: the script widget has full authority over every member page

**Evidence.** The documented integration loads
`https://indienodes.us/embed.v1.js` as a module. The bundle registers a Svelte
custom element with an open shadow root. It fetches `ring.json` and uses
`window.open` for navigation. There is no iframe or other browser security
boundary.

**Impact.** A malicious or compromised future widget can read or modify the
page DOM, observe form values and keystrokes, read non-HttpOnly same-origin
cookies and Web Storage, call same-origin APIs with the visitor's credentials,
alter links, and exfiltrate any data available to page JavaScript. One
IndieNodes compromise could therefore become a many-site compromise.

OWASP calls compromise of the third-party JavaScript server the greatest risk
in this model and notes that the remote code executes with the host
application's privileges. See the [OWASP Third Party JavaScript Management
Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Third_Party_Javascript_Management_Cheat_Sheet.html).

The current code is intentionally small and does not contain tracking, DOM
scraping, `eval`, `innerHTML`, or `postMessage`; that reduces today's
probability but does not reduce the authority available after a future build or
compromise.

**Required action.** Prefer a static `<a>`/badge for the lowest-risk tier. For
the interactive tier, serve a purpose-built document from an origin that has no
application cookies or sensitive APIs and embed it as a sandboxed cross-origin
iframe. Start with no sandbox capabilities and add only those necessary, likely
`allow-scripts allow-popups allow-popups-to-escape-sandbox`; omit
`allow-same-origin`, forms, downloads, top navigation, and storage access unless
a demonstrated requirement exists. OWASP recommends sandboxed frames for
untrusted widgets, and [MDN documents the exact iframe sandbox
semantics](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/iframe).

### F-02 — High: `embed.v1.js` is version-labelled but mutable and has no SRI

**Evidence.** The widget build writes `embed.js` and copies the same bytes to
`embed.v1.js`. “v1” pins a contract/major version, not content. Member snippets
contain neither an `integrity` hash nor `crossorigin="anonymous"`.

**Impact.** Any deployment can silently replace the bytes executed across all
member origins. HTTPS protects transit to the currently authenticated server;
it does not protect against a compromised server, deployment credential, CDN,
or build.

**Required action.** Publish content-addressed immutable assets such as
`embed.v1.<sha256>.js`, retain old versions, and provide snippets with a
SHA-384 SRI value and `crossorigin="anonymous"`. The [W3C SRI
Recommendation](https://www.w3.org/TR/SRI/) explicitly targets the case where
a third-party service or CDN is compromised. SRI is operationally incompatible
with silently replacing `embed.v1.js`; a new build requires a new immutable URL
and member opt-in. Self-hosting the reviewed widget bundle is another valid
option.

This is defense in depth, not a substitute for iframe isolation: a legitimately
reviewed script with a valid hash still receives full host-page authority.

### F-03 — High: PR-controlled execution occurs in a job holding a write PAT

**Evidence.** `.github/workflows/build-ring.yml` triggers for same-repository
member PRs, checks out the PR head using `RING_BUILD_PAT`, and then executes
`npm ci`, the repository's `prepare` lifecycle, `npx prettier`, and
`npm run ring:build`. Checkout normally persists its credential so later `git
push` works.

**Attack path.** Someone able to influence a same-repository branch—or an
attacker who compromises the automation that creates that branch—adds a member
file to trigger the workflow and changes `package.json`, a dependency, a
lifecycle script, Prettier configuration/plugin, or the builder. That code can
read the persisted Git credential and send it out before the workflow reaches
`git push`.

The current path filter does not constrain what other files the triggering
commit may change. Restricting fork PRs is good but does not protect a bot branch
or compromised collaborator. GitHub warns that PR-controlled code is untrusted,
recommends least privilege, and states that a full commit SHA is the only
immutable way to pin an Action; see [GitHub's secure-use
reference](https://docs.github.com/en/actions/reference/security/secure-use).

**Required action.** Split generation from writing:

1. Run validation/generation with `permissions: contents: read`, no PAT, npm
   lifecycle scripts disabled where feasible, and toolchain code taken from a
   trusted base revision.
2. Upload the generated artifact or patch.
3. In a separately authorized job, verify the artifact contains changes only
   under the exact allowed paths, then use a short-lived GitHub App token to
   commit it. Do not execute PR code in this job.
4. Set `persist-credentials: false` everywhere except the minimal write step.
5. Do not reuse one PAT between Actions and n8n; use distinct, expiring,
   narrowly scoped identities so one compromise does not cross systems.

Also pin `actions/checkout`, `actions/setup-node`, and Pages actions to reviewed
full commit SHAs and enable the repository policy requiring SHA-pinned actions.

### F-04 — High: canonical data permits HTML but does not make sanitization a contract

**Evidence.** `schema/ring.schema.json` calls excerpt text “Sanitized HTML” but
only checks that it is a nonempty string. This ring repository does not sanitize
or reject active markup. The README explicitly allows clients other than the
official app. The official app currently does the right thing: it sanitizes
with a narrow DOMPurify tag/attribute allowlist before persistence and again at
every `{@html}` render.

**Impact.** A direct PR, compromised publisher, future import, or validation
mistake can put active HTML into canonical data. A third-party client that trusts
the schema description and inserts it with `innerHTML` can suffer stored XSS.
The official client is protected at the reviewed revision, and the member-site
widget does not render excerpts, so this is chiefly a data-contract/ecosystem
risk rather than a confirmed XSS in the current widget.

OWASP recommends treating untrusted data according to its output context,
avoiding dangerous DOM sinks, validating URL schemes, and using a maintained
HTML sanitizer when HTML is intentionally supported. See [Cross-Site Scripting
Prevention](https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.html)
and [DOM-based XSS Prevention](https://cheatsheetseries.owasp.org/cheatsheets/DOM_based_XSS_Prevention_Cheat_Sheet.html).

**Required action.** Choose and document one of two contracts:

- safest: canonical excerpts are plain text or a constrained structured-rich-
  text format, never HTML; or
- supported HTML: canonicalize through one maintained sanitizer during build,
  publish an exact allowlist and sanitizer/version metadata, and still require
  every client to sanitize at its final output sink.

Add malicious fixture tests for scripts, event handlers, `javascript:` and
`data:` URLs, SVG/MathML, malformed nesting, DOM clobbering names, and mutation
XSS. Consider Trusted Types plus CSP in the main web client.

### F-05 — Medium/High: DNS validation is separated from the actual connection

**Evidence.** `validateExternalUrl` resolves all hostname answers and rejects
non-public IPs. `probeLink` then calls ordinary `fetch(checkedUrl)`, which
performs its own resolution. Redirects are manual and each target is validated,
which is good, but each hop retains the validation/fetch race.

**Impact.** An attacker-controlled DNS name can return a public address during
validation and an internal/reserved address when `fetch` resolves it. The
request can then reach cloud metadata, localhost, or services visible only to a
self-hosted/Semaphore runner. The consequence depends heavily on runner network
placement and credentials.

OWASP explicitly warns about DNS pinning/rebinding in its [SSRF Prevention
Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html).

**Required action.** Route requests through a purpose-built egress proxy that
resolves once, rejects every non-public answer, connects to the validated IP
while preserving TLS SNI/hostname verification, repeats the process at every
redirect, restricts methods/ports/protocols, limits decompressed bytes, and
blocks access to all internal network ranges at the network layer. Run the
checker without cloud credentials and away from sensitive internal networks.

### F-06 — Medium: unsafe URL findings do not block publication

**Evidence.** The schema accepts any syntactically valid lowercase `https://`
URL, including credentials, loopback/private IP literals, and local names. The
health checker correctly classifies these as `unsafe_url`, but that is a
warning. Its CLI exits nonzero only for repeated `404`/`410` alerts, so the PR
workflow succeeds on unsafe URLs.

**Impact.** Canonical data can cause visitors' browsers to make GET requests to
localhost or private-network services through image, audio, video, or navigation
elements. Same-origin policy normally prevents reading the response, but it does
not prevent the request or every possible side effect. It also creates a poor
foundation for future clients that may proxy or server-fetch these URLs.

**Required action.** Make `invalid_url`, `unsafe_url`, embedded credentials,
non-HTTPS redirects, and final destinations on non-public IP space hard publish
failures for new/changed entries. Apply the same URL policy in submission,
canonical validation, the official client's runtime parser, and every server-
side fetcher. A DNS check can expire; retain network-layer egress denial too.

### F-07 — Medium: clients trust the published document more than the repository does

**Evidence.** The repository validates a versioned envelope and rejects unknown
properties before publishing. The companion app revision reviewed still serves
a legacy bare array and `loadRing` merely calls `response.json()` followed by
`entries.map(normalizeEntry)`. It performs no runtime schema validation, size
check, content-type check, recognized-version decision, or URL revalidation.
The new canonical repository publishes `{ "version": "1.0", "entries": [...] }`.

**Impact.** Directly switching the widget to the canonical endpoint will fail
because an object has no `.map`. More importantly, a corrupted or compromised
endpoint can bypass the repository's build-time guarantees and supply malformed
or dangerous URLs. The widget only uses the data after a user clicks, and opens
with `noopener,noreferrer`, which limits impact, but the official app renders
many more fields and media resources.

**Required action.** Before cutover, update the client to accept the envelope,
enforce a maximum response size and timeout, require JSON content, recognize the
document version, validate every entry with the published schema or an
equivalent hand-written runtime parser, re-check URL protocols, and discard
invalid entries. A bad entry should not take down the entire ring. Keep a
last-known-good signed or bundled snapshot for availability.

### F-08 — Medium: schema bounds are incomplete, enabling data/UI exhaustion

**Evidence.** `creator`, `why`, tags, captions, excerpt HTML, titles, tokens,
and most other strings have no `maxLength`. `tags` and comic `pages` have no
`maxItems`; the document has no maximum entry count or serialized-size policy.
The schema notes that `why` is capped in the client but deliberately does not
enforce that cap here. Direct repository contributions bypass client-only
rules.

**Impact.** A malicious or accidental entry can bloat `ring.json`, consume
browser memory, create excessive media requests, degrade rendering and
accessibility, enlarge generated artifacts, and make health checks expensive.
This is not likely to bypass review unnoticed today, but automation and future
clients make limits part of the security boundary.

**Required action.** Put conservative `maxLength`, `maxItems`, `uniqueItems`,
and aggregate byte/entry limits in the canonical validator. Enforce per-resource
dimensions/duration/byte budgets in clients, since JSON Schema cannot verify
remote content.

### F-09 — Medium: creator-hosted media and domains can change after approval

**Evidence.** Images/audio/video remain on creator-controlled origins. Health
checks test reachability, participation, and optionally the public verification
token; they do not pin content, verify MIME type, scan malware, detect a domain
ownership change, or moderate replacement content. The scheduled GitHub check
does not check tokens by default.

**Impact.** An approved image can become a tracking pixel, abusive content, a
very large file, or a browser-parser exploit delivery vehicle. An expired or
compromised member domain can become a phishing/malware destination while
retaining the trusted ring position. Every media request exposes at least the
visitor IP and request metadata to the media host. With the current
`strict-origin-when-cross-origin` policy, cross-origin requests can disclose the
IndieNodes origin; per-element `no-referrer` is stricter.

**Required action.** Document that media and member destinations are untrusted
third-party content. Add `referrerpolicy="no-referrer"` to external images,
links, iframes, and scripts where compatible, and use the equivalent fetch
option. Lazy-load media, stop autoplay, cap decoded dimensions/duration, and
provide click-to-load for heavier third-party embeds. Monitor unexpected final-
origin changes, certificate/domain expiry, and reputation feeds; create a rapid
takedown/security-report channel. OWASP's third-party script guidance explicitly
calls out abandoned-domain takeover, and [MDN documents granular referrer
policy](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Referrer-Policy).

Do not silently proxy all media through IndieNodes unless the privacy,
copyright, caching, malware-scanning, and bandwidth consequences are accepted;
that would move the risk rather than remove it.

### F-10 — Low/Medium: workflow dependencies are mutable and advisory checks are not gated

**Evidence.** GitHub Actions are referenced by mutable major tags (`@v4`,
`@v5`, etc.), not full commit SHAs. CI runs `npm ci` from a lockfile, which is
good, but no committed workflow makes dependency/advisory status a visible
security gate. The repository `prepare` script runs during installs; npm
documents that `npm ci` runs lifecycle scripts unless configured otherwise.

**Current advisory snapshot.** On 2026-08-31:

- this repository: **0** known advisories across the locked dependency graph;
- companion app production dependencies: **0** known advisories under
  `npm audit --omit=dev`;
- companion app full graph: **6** development-tool findings (3 low, 3 moderate)
  through SvelteKit's `cookie` chain and Capacitor CLI's `xcode`/`uuid` chain.
  The reported automatic fixes were breaking/downgrade changes and should not
  be applied blindly.

An advisory scan is a point-in-time registry result, not proof that code is
safe.

**Required action.** Pin Actions by full SHA, use Dependabot/Renovate for
reviewed updates, add scheduled `npm audit` or OSV scanning, generate an SBOM,
and consider provenance/attestation for the widget artifact. Use
`npm ci --ignore-scripts` in jobs that do not need lifecycle scripts, then run
only the specific reviewed build command. The [npm `ci`
documentation](https://docs.npmjs.com/cli/commands/npm-ci/) explains the
lifecycle behavior; OWASP's [Software Supply Chain Security Cheat
Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Software_Supply_Chain_Security_Cheat_Sheet.html)
covers lockfiles, build hardening, provenance, least privilege, and monitoring.

### F-11 — Low: live widget availability currently obscures header verification

At approximately 04:52 UTC on 2026-08-31, both
`https://indienodes.us/embed.v1.js` and `https://indienodes.us/ring.json`
returned Cloudflare HTTP 502. The canonical
`https://ring.indienodes.us/ring.json` returned HTTP 200 with
`Access-Control-Allow-Origin: *`, a ten-minute cache policy, and the versioned
envelope.

The 502 is an availability observation, not evidence of compromise, and may be
transient. It means this review could not confirm the deployed widget's actual
MIME type, CSP-related headers, SRI compatibility, cache behavior, or whether
the deployed bytes match the reviewed source. Add an external synthetic check
for widget status, MIME (`text/javascript` or a valid JS MIME), CORS, content
hash, and ring parseability.

## Positive controls already present

- Entry and document schemas use `additionalProperties: false` and require a
  constrained ID and type.
- Canonical URLs are HTTPS-only at the schema level; YouTube trailers use a
  narrow URL pattern.
- The aggregate is deterministically regenerated and compared byte-for-byte.
- `validate:publish` rejects placeholders and currently passes for both members.
- Member IDs are unique and tied to filenames.
- The health checker rejects URL credentials, local names, and many private,
  special, documentation, multicast, and mapped address forms.
- Redirects are manual, limited to five, and each target is revalidated.
- Source-page bodies are limited to 2 MB; checks have total timeouts and bounded
  concurrency; non-source media probes request one byte.
- The official client sanitizes rich text at ingestion and render time using a
  narrow allowlist.
- The current widget renders no member-controlled HTML or display text.
- External navigation uses `noopener,noreferrer`, and the widget opens a new tab
  only after a button click.
- The widget has no analytics, `postMessage`, `eval`, host-DOM traversal, or
  same-origin API calls in the reviewed source.
- Caddy runs as a static server with baseline `nosniff`, referrer,
  permissions-policy, and framing headers; the container is designed to run
  non-root.
- CORS `*` is appropriate for the public, credential-free ring and embed
  resources. It would become unsafe if personalized or secret data were ever
  served from those routes.
- Emergency removal uses input validation, a protected Environment, a PR, and
  ordinary review/checks rather than an unreviewed direct push.
- Scheduled health checks and continuing-participation checks reduce unnoticed
  link rot.

These controls should be retained while the gaps above are fixed.

## Recommended target architecture

### Member integration tiers

| Tier                   | Recommended implementation                                       | Security property                                                    |
| ---------------------- | ---------------------------------------------------------------- | -------------------------------------------------------------------- |
| Safest/default         | Plain HTTPS link or locally hosted 88×31 image wrapped in a link | No IndieNodes JavaScript on the member origin                        |
| Interactive/default    | Sandboxed iframe on a dedicated cookieless widget origin         | Browser-enforced authority separation                                |
| Compatibility/advanced | Self-hosted or immutable SRI-pinned script                       | Reviewed bytes are fixed, but script still has host-origin authority |
| Avoid                  | Mutable remote script without SRI                                | Central compromise propagates to every member site                   |

For an iframe deployment, use a dedicated origin such as
`widget.indienodes.us` that has no session cookies, administration endpoints,
or shared service-worker scope. Give the iframe its own restrictive CSP,
including `default-src 'none'`, narrowly scoped `script-src`, `connect-src`,
`img-src`, `style-src`, `base-uri 'none'`, `form-action 'none'`, and an explicit
`frame-ancestors` policy appropriate for public embedding. Start CSP in
report-only mode and promote it after real-world validation. OWASP's [CSP Cheat
Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Content_Security_Policy_Cheat_Sheet.html)
is the appropriate implementation guide.

### Data consumption rules

Every client should be required to:

1. impose a fetch timeout and response-byte ceiling;
2. require the expected JSON media type and supported document version;
3. validate the envelope and each entry at runtime;
4. treat failure per-entry where possible;
5. use text nodes for plain fields, never HTML interpolation;
6. sanitize allowed rich text immediately before its final HTML sink;
7. allow only `https:` URLs, reject credentials/local/private targets, and
   constrain provider-specific embeds;
8. use `noopener`, `noreferrer`, and `referrerpolicy="no-referrer"` for external
   navigation/resources where possible;
9. lazy-load and budget remote media;
10. never give ring data control of script URLs, event handlers, CSS, iframe
    `srcdoc`, `postMessage` targets, or dynamic property names.

## Remediation plan

### P0 — before recommending the full widget to third-party sites

- Ship the sandboxed iframe tier and make it the primary interactive snippet,
  or make the static link/badge the default until the iframe exists.
- Publish immutable widget artifacts with SRI for anyone retaining the script
  tier; document its stronger trust requirement.
- Redesign `build-ring.yml` so no PR-controlled process can access a write PAT.
- Make unsafe/private URL results hard publication failures.
- Update the companion loader for the versioned envelope and runtime validation
  before switching `RING_JSON_URL` to `ring.indienodes.us`.
- Publish a member-facing security statement explaining exactly what each embed
  can access, how updates work, and how to remove/revoke it.

### P1 — near term

- Put health and ownership-verification fetches behind DNS-pinned restricted
  egress.
- Add schema and aggregate size limits plus adversarial fixtures.
- Formalize the HTML/sanitization contract and add XSS regression tests.
- Add no-referrer handling and remote-media budgets in the official client.
- Pin Actions to full SHAs and add automated advisory/SBOM reporting.
- Add deployed content-hash, CORS, MIME, parse, and availability monitoring for
  widget and ring endpoints.

### P2 — operational maturity

- Use a GitHub App with short-lived installation tokens instead of a shared PAT.
- Add artifact provenance/attestation and retain prior immutable widget builds.
- Monitor domain/final-origin drift and establish a security contact,
  vulnerability disclosure policy, and malicious-member takedown SLA.
- Periodically exercise emergency removal, credential rotation, compromised
  widget rollback, and canonical-ring recovery from last-known-good data.
- Re-audit the n8n verifier, deployed reverse proxy, DNS/CDN, branch protection,
  environments, and organization settings; source alone cannot prove those
  controls are configured.

## Member-site guidance to publish with the embed

Member sites should be told, plainly:

- The static link/badge executes no IndieNodes JavaScript and is the safest
  option.
- A sandboxed iframe isolates the widget from the member page; members should
  not add extra sandbox permissions unless documented.
- A script widget runs with the member site's own JavaScript privileges. Use
  only an immutable URL plus the supplied SRI hash, or self-host reviewed bytes.
- Restrict IndieNodes in the member site's CSP to only the directive needed by
  the selected tier (`frame-src` for iframe; `script-src` and `connect-src` for
  script). Do not add broad wildcards or `unsafe-inline` for the widget.
- The widget should not require cookies, form data, analytics, storage, camera,
  microphone, geolocation, or access to the host DOM. Any future request for
  those capabilities is a security-significant contract change.
- Removal is immediate: delete the iframe/script/link markup. No account token
  or remote uninstall step should be required.

## Bottom line

The current widget source itself is narrow and avoids obvious XSS sinks, but the
delivery architecture asks every member to trust the entire IndieNodes software
supply chain with their site's JavaScript authority. That is disproportionate
to a Previous/Random/Next control. A static link or sandboxed cross-origin iframe
provides the same WebRing function with a materially smaller blast radius.

The canonical repository is in comparatively good shape for a young data
project. Its next security gains should come from making the trust boundaries
enforceable: isolate the embed, remove credentials from PR execution, pin DNS at
the network connection, make unsafe URLs fail closed, bound the data, and define
the untrusted-content contract for every client.

## Primary references

- [OWASP Third Party JavaScript Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Third_Party_Javascript_Management_Cheat_Sheet.html)
- [OWASP Cross-Site Scripting Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.html)
- [OWASP DOM-based XSS Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/DOM_based_XSS_Prevention_Cheat_Sheet.html)
- [OWASP SSRF Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html)
- [OWASP Unvalidated Redirects and Forwards Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Unvalidated_Redirects_and_Forwards_Cheat_Sheet.html)
- [OWASP Content Security Policy Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Content_Security_Policy_Cheat_Sheet.html)
- [OWASP Software Supply Chain Security Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Software_Supply_Chain_Security_Cheat_Sheet.html)
- [OWASP Top 10:2025](https://owasp.org/Top10/)
- [W3C Subresource Integrity](https://www.w3.org/TR/SRI/)
- [GitHub Actions secure-use reference](https://docs.github.com/en/actions/reference/security/secure-use)
- [MDN iframe reference and sandbox controls](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/iframe)
- [MDN Referrer-Policy](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Referrer-Policy)
- [MDN Cross-Origin Resource Sharing](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CORS)
- [npm `ci` documentation](https://docs.npmjs.com/cli/commands/npm-ci/)
- [CVE-2007-1328: BJ Webring XSS](https://cve.mitre.org/cgi-bin/cvename.cgi?name=CVE-2007-1328)
- [CVE-2006-4129: Joomla Webring component remote file inclusion](https://app.opencve.io/cve/CVE-2006-4129)
