import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

const schema = JSON.parse(readFileSync(new URL('../schema/ring.schema.json', import.meta.url)));
const ajv = new Ajv2020({ allErrors: true });
addFormats(ajv);
const validate = ajv.compile(schema);

/** @param {number} count @param {string | null} caption */
function pages(count, caption = 'Full piece, 24 x 36 in') {
	return Array.from({ length: count }, (_, i) => ({
		image_url: `https://maker.example/img/${i}.png`,
		...(caption === null ? {} : { caption })
	}));
}

/** @param {string} type @param {object} extra */
function entry(type, extra) {
	return {
		id: `${type}-example`,
		creator: 'Example Maker',
		type,
		why: 'One-line framing',
		source_url: 'https://maker.example/',
		tags: ['example'],
		verification_token: 'abc123',
		joined_at: '2026-09-01T00:00:00.000Z',
		...extra
	};
}

test('craft accepts one to five captioned pages', () => {
	assert.equal(validate(entry('craft', { pages: pages(1) })), true);
	assert.equal(validate(entry('craft', { pages: pages(5) })), true);
});

test('craft rejects six pages, zero pages, or no pages', () => {
	assert.equal(validate(entry('craft', { pages: pages(6) })), false);
	assert.equal(validate(entry('craft', { pages: [] })), false);
	assert.equal(validate(entry('craft', {})), false);
});

test('craft requires a non-empty caption on every page', () => {
	assert.equal(validate(entry('craft', { pages: pages(2, null) })), false);
	assert.equal(validate(entry('craft', { pages: pages(2, '') })), false);
});

test('comic stays capped at three pages and keeps optional captions', () => {
	assert.equal(validate(entry('comic', { pages: pages(3, null) })), true);
	assert.equal(validate(entry('comic', { pages: pages(4) })), false);
});
