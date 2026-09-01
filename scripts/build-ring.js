#!/usr/bin/env node
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
	formatMemberJson,
	loadMembers,
	MEMBERS_DIR,
	RING_PATH,
	serializeRing,
	stampJoinedAt
} from './ring-files.js';

const members = loadMembers();
const touched = stampJoinedAt(members);
for (const { file, entry } of touched) {
	writeFileSync(join(MEMBERS_DIR, file), await formatMemberJson(entry));
}

writeFileSync(RING_PATH, await serializeRing(members.map(({ entry }) => entry)));
console.log(
	`Generated ring.json from ${members.length} member files.` +
		(touched.length
			? ` Stamped joined_at on ${touched.length} member file(s): ${touched.map((m) => m.file).join(', ')}.`
			: '')
);
