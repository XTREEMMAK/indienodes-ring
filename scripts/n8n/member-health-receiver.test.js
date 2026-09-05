import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const workflow = JSON.parse(
	readFileSync(new URL('./backups/member-health-receiver.json', import.meta.url))
);
const node = (name) => workflow.nodes.find((n) => n.name === name);
function run(name, input, state) {
	return new Function('$input', '$getWorkflowStaticData', node(name).parameters.jsCode)(
		{ first: () => ({ json: input }) },
		() => state
	)[0].json;
}
const result = (outcome, reason) => ({
	url: 'https://example.com/',
	outcome,
	reason,
	references: [{ memberFile: 'members/example.json', field: 'source_url' }]
});
function receive(results, state) {
	return run(
		'Track streaks',
		{
			body: {
				results,
				summary: {
					membersChecked: 1,
					urlsChecked: results.length,
					healthy: results.filter((r) => r.outcome === 'healthy').length,
					broken: results.filter((r) => r.outcome === 'broken').length,
					warnings: results.filter((r) => r.outcome === 'warning').length
				}
			}
		},
		state
	);
}
function render(report, state) {
	return run(
		'Build report page',
		{ query: { token: new URL(report.reportUrl).searchParams.get('token') } },
		state
	).html;
}
test('warnings and healthy runs each produce one linked summary without the threshold gate', () => {
	const state = {};
	for (const reason of [
		'ring_participation_missing',
		'ring_widget_site_id_unmatched',
		'ring_participation_indeterminate',
		'http_503'
	]) {
		const report = receive([result('warning', reason)], state);
		assert.equal(report.alerts.length, 0);
		assert.match(render(report, state), new RegExp(reason));
	}
	const report = receive([result('healthy', 'http_200')], state);
	assert.match(render(report, state), /No issues found/);
	assert.equal(workflow.connections['Track streaks'].main[0].length, 1);
	assert.equal(workflow.connections['Track streaks'].main[0][0].node, 'Alert via Gotify');
	assert.equal(node('Any over threshold?'), undefined);
	const expression = node('Alert via Gotify').parameters.message;
	const message = new Function('$json', 'return ' + expression.slice(3, -2))(report);
	assert.match(message, /1 healthy, 0 broken, 0 warning/);
	assert.ok(message.includes('\n\n[Full member health report]'));
});
test('dead links appear immediately, reach threshold at three and reset on a warning', () => {
	const state = {};
	for (let count = 1; count <= 3; count++) {
		const report = receive([result('broken', 'http_404')], state);
		assert.equal(report.alerts.length, count === 3 ? 1 : 0);
		assert.match(render(report, state), /http_404/);
		assert.equal(state.streaks['https://example.com/'], count);
	}
	receive([result('warning', 'ring_participation_missing')], state);
	assert.equal(state.streaks['https://example.com/'], 0);
});
test('report escapes findings, rejects unsafe links, supports old reports and expires them', () => {
	const state = {};
	const report = receive(
		[
			{
				...result('warning', 'http_503'),
				url: 'javascript:alert(1)',
				detail: '<script>alert(1)</script>'
			}
		],
		state
	);
	const html = render(report, state);
	assert.ok(!html.includes('href="javascript:'));
	assert.ok(!html.includes('<script>'));
	assert.match(html, /&lt;script&gt;/);
	state.reports.legacy = {
		alerts: [{ ...result('broken', 'http_410'), streak: 3 }],
		summary: {},
		createdAt: new Date().toISOString()
	};
	assert.match(run('Build report page', { query: { token: 'legacy' } }, state).html, /http_410/);
	state.reports.legacy.createdAt = '2000-01-01';
	assert.match(
		run('Build report page', { query: { token: 'legacy' } }, state).html,
		/Report not found or expired/
	);
	receive([], state);
	assert.equal(state.reports.legacy, undefined);
});
