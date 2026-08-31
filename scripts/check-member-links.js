#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadMembers, ROOT } from './ring-files.js';
import {
	applyFailureHistory,
	collectMemberLinks,
	DEFAULT_CONCURRENCY,
	DEFAULT_FAILURE_THRESHOLD,
	DEFAULT_TIMEOUT_MS,
	groupLinksByUrl,
	mapConcurrent,
	probeLink
} from './member-health.js';

const DEFAULT_STATE_PATH = resolve(ROOT, '.member-health-state.json');

function usage() {
	return [
		'Usage: npm run members:health -- [options] [members/<id>.json ...]',
		'',
		'Checks every public URL in canonical member files. Placeholder entries are skipped.',
		'',
		'Options:',
		'  --check-tokens          Also confirm source pages retain their verification meta tag',
		'  --no-participation-check Skip the continuing ring participation check',
		'  --concurrency <count>   Maximum simultaneous requests (default: ' +
			DEFAULT_CONCURRENCY +
			')',
		'  --failure-threshold <n> Alert after consecutive 404/410 runs (default: ' +
			DEFAULT_FAILURE_THRESHOLD +
			')',
		'  --json                  Emit one machine-readable JSON report',
		'  --no-state              Do not read or write consecutive-failure state',
		'  --state <path>          State file (default: .member-health-state.json)',
		'  --timeout-ms <ms>       Total timeout per URL (default: ' + DEFAULT_TIMEOUT_MS + ')',
		'  --help                  Show this help',
		'',
		'Exit codes: 0 = no alert, 1 = repeated broken links, 2 = checker/configuration error.'
	].join('\n');
}

export function parseArgs(argv) {
	const options = {
		checkTokens: false,
		checkParticipation: true,
		concurrency: DEFAULT_CONCURRENCY,
		failureThreshold: DEFAULT_FAILURE_THRESHOLD,
		json: false,
		statePath: DEFAULT_STATE_PATH,
		timeoutMs: DEFAULT_TIMEOUT_MS,
		files: [],
		help: false
	};
	const integer = (value, flag, minimum, maximum) => {
		const parsed = Number(value);
		if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
			throw new Error(flag + ' must be an integer from ' + minimum + ' to ' + maximum + '.');
		}
		return parsed;
	};

	for (let index = 0; index < argv.length; index++) {
		const argument = argv[index];
		if (argument === '--check-tokens') options.checkTokens = true;
		else if (argument === '--no-participation-check') options.checkParticipation = false;
		else if (argument === '--json') options.json = true;
		else if (argument === '--no-state') options.statePath = null;
		else if (argument === '--help' || argument === '-h') options.help = true;
		else if (argument === '--concurrency') {
			options.concurrency = integer(argv[++index], argument, 1, 20);
		} else if (argument === '--failure-threshold') {
			options.failureThreshold = integer(argv[++index], argument, 1, 100);
		} else if (argument === '--timeout-ms') {
			options.timeoutMs = integer(argv[++index], argument, 500, 120_000);
		} else if (argument === '--state') {
			const path = argv[++index];
			if (!path || path.startsWith('--')) throw new Error('--state requires a file path.');
			options.statePath = resolve(path);
		} else if (argument.startsWith('--')) {
			throw new Error('Unknown option: ' + argument);
		} else {
			options.files.push(argument);
		}
	}
	if (!options.statePath && options.failureThreshold > 1) {
		throw new Error('--no-state requires --failure-threshold 1.');
	}
	return options;
}

function readState(statePath) {
	if (!statePath || !existsSync(statePath)) return { version: 1, failures: {} };
	const state = JSON.parse(readFileSync(statePath, 'utf8'));
	if (state?.version !== 1 || typeof state.failures !== 'object' || !state.failures) {
		throw new Error('Unsupported member-health state file: ' + statePath);
	}
	return state;
}

function writeState(statePath, state) {
	if (!statePath) return;
	mkdirSync(dirname(statePath), { recursive: true });
	const temporary = statePath + '.tmp-' + process.pid;
	writeFileSync(temporary, JSON.stringify(state, null, 2) + '\n');
	renameSync(temporary, statePath);
}

function selectMembers(members, files) {
	if (!files.length) return members;
	const requested = new Set(files.map((file) => basename(file)));
	const known = new Set(members.map(({ file }) => file));
	const missing = [...requested].filter((file) => !known.has(file));
	if (missing.length) throw new Error('Unknown member file(s): ' + missing.join(', '));
	return members.filter(({ file }) => requested.has(file));
}

/**
 * The status code is the headline only when it is what went wrong. A
 * participation or token warning carries `statusCode: 200` — the page fetched
 * fine, something about its content did not — so leading with "HTTP 200" buried
 * the actual finding in the detail line and left the reason code visible only
 * under --json.
 */
function describeResult(item) {
	const statusIsTheFinding = item.outcome === 'broken' || /^http_\d+$/.test(item.reason);
	const status =
		item.statusCode && statusIsTheFinding
			? 'HTTP ' + item.statusCode
			: item.reason.replaceAll('_', ' ');
	const references = item.references
		.map(({ memberFile, field }) => memberFile + ':' + field)
		.join(', ');
	if (item.outcome === 'broken') {
		return (
			(item.alert ? 'BROKEN' : 'PENDING') +
			' ' +
			item.consecutiveFailures +
			' failure(s): ' +
			status +
			'\n  ' +
			references +
			'\n  ' +
			item.url
		);
	}
	return (
		'WARNING: ' +
		status +
		'\n  ' +
		references +
		'\n  ' +
		item.url +
		(item.detail ? '\n  ' + item.detail : '')
	);
}

function printHumanReport(report) {
	console.log(
		'Member link health: ' +
			report.summary.healthy +
			' healthy, ' +
			report.summary.broken +
			' broken, ' +
			report.summary.warnings +
			' warning(s); ' +
			report.summary.urlsChecked +
			' unique URL(s) across ' +
			report.summary.membersChecked +
			' member(s).'
	);
	if (report.summary.placeholdersSkipped) {
		console.log(report.summary.placeholdersSkipped + ' placeholder member(s) skipped.');
	}
	for (const item of report.results.filter(({ outcome }) => outcome !== 'healthy')) {
		console.log('\n' + describeResult(item));
	}
	if (report.summary.pendingBroken > 0) {
		console.log(
			'\n' +
				report.summary.pendingBroken +
				' definite failure(s) have not yet reached the ' +
				report.failureThreshold +
				'-run alert threshold.'
		);
	}
}

export async function run(options, dependencies = {}) {
	const allMembers = loadMembers();
	const selected = selectMembers(allMembers, options.files);
	const placeholders = selected.filter(({ entry }) => entry?._placeholder === true);
	const members = selected.filter(({ entry }) => entry?._placeholder !== true);
	const links = groupLinksByUrl(members.map(({ entry, file }) => collectMemberLinks(entry, file)));
	const rawResults = await mapConcurrent(links, options.concurrency, (link) =>
		probeLink(link, {
			timeoutMs: options.timeoutMs,
			checkTokens: options.checkTokens,
			checkParticipation: options.checkParticipation,
			fetchImpl: dependencies.fetchImpl,
			lookupImpl: dependencies.lookupImpl
		})
	);
	const history = applyFailureHistory(
		rawResults,
		readState(options.statePath),
		options.failureThreshold,
		{ prune: options.files.length === 0, now: dependencies.now }
	);
	writeState(options.statePath, history.state);

	const summary = {
		membersChecked: members.length,
		placeholdersSkipped: placeholders.length,
		urlsChecked: history.results.length,
		healthy: history.results.filter(({ outcome }) => outcome === 'healthy').length,
		broken: history.results.filter(({ outcome }) => outcome === 'broken').length,
		warnings: history.results.filter(({ outcome }) => outcome === 'warning').length,
		alerts: history.results.filter(({ alert }) => alert).length,
		pendingBroken: history.results.filter(({ outcome, alert }) => outcome === 'broken' && !alert)
			.length
	};
	return {
		checkedAt: (dependencies.now ?? new Date()).toISOString(),
		failureThreshold: options.failureThreshold,
		checkTokens: options.checkTokens,
		checkParticipation: options.checkParticipation,
		summary,
		results: history.results
	};
}

async function main() {
	let options;
	try {
		options = parseArgs(process.argv.slice(2));
		if (options.help) {
			console.log(usage());
			return;
		}
		const report = await run(options);
		if (options.json) console.log(JSON.stringify(report));
		else printHumanReport(report);
		if (report.summary.alerts > 0) process.exitCode = 1;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		if (options?.json || process.argv.includes('--json')) {
			console.log(JSON.stringify({ ok: false, error: message }));
		} else {
			console.error('Member link health check failed: ' + message + '\n\n' + usage());
		}
		process.exitCode = 2;
	}
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
