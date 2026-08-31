#!/usr/bin/env node
import { writeFileSync } from 'node:fs';
import { loadMembers, RING_PATH, serializeRing } from './ring-files.js';

const members = loadMembers();
writeFileSync(RING_PATH, await serializeRing(members.map(({ entry }) => entry)));
console.log(`Generated ring.json from ${members.length} member files.`);
