#!/usr/bin/env node
// Writes a published copy of ring.json carrying generated_at, without ever
// touching the committed file. Used only by publish-pages.yml, after
// validate-ring.js's freshness check (ring.json must already match a fresh
// `ring:build`) has already passed -- this runs later in the same job and
// writes to _site/, not back into the repo. See ring-files.js's
// withGeneratedAt for why the committed artifact itself stays untouched.
//
//   node scripts/stamp-generated-at.mjs _site/ring.json

import { readFileSync, writeFileSync } from 'node:fs';
import { RING_PATH, withGeneratedAt } from './ring-files.js';

const outPath = process.argv[2];
if (!outPath) {
	console.error('usage: stamp-generated-at.mjs <output-path>');
	process.exit(1);
}

const document = JSON.parse(readFileSync(RING_PATH, 'utf8'));
writeFileSync(outPath, JSON.stringify(withGeneratedAt(document), null, '\t') + '\n');
console.log(`wrote ${outPath} with generated_at stamped at publish time.`);
