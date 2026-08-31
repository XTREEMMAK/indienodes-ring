/**
 * Points git at the repository's tracked hooks.
 *
 * `.git/hooks` is not version-controlled, so a hook committed to the repo does
 * nothing until each clone opts in. `core.hooksPath` is the opt-in, and running
 * it from `prepare` means `npm install` does it once rather than every
 * contributor being asked to remember a setup step they have no reason to know
 * about.
 *
 * **This never fails the install.** It exits 0 in every path, including when
 * git is missing, when this is not a work tree (a tarball, a vendored copy), or
 * when the config write is refused. A repository convenience is not worth
 * turning `npm ci` red over, and `prepare` runs during every install.
 *
 * That guarantee cannot live entirely in this file, which is why `prepare`
 * ends with `|| true`. The Dockerfile installs dependencies before copying the
 * source — `COPY package.json package-lock.json` then `RUN npm ci`, with
 * `COPY . .` after it for layer caching — so during that build this script does
 * not exist yet and node fails to load it before any guard in here can run.
 * Guarding inside the script covers every case except the one where the script
 * is absent, which is exactly the case Docker produces.
 *
 * It also does nothing in CI. The hooks guard a developer's push; a runner has
 * no push to guard, and `ci.yml` runs the same check directly.
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';

const quiet = { stdio: 'ignore' };

try {
	if (process.env.CI) process.exit(0);
	if (!existsSync('.githooks')) process.exit(0);

	// Not a work tree — an install from a tarball, or a vendored copy.
	execFileSync('git', ['rev-parse', '--is-inside-work-tree'], quiet);

	const current = (() => {
		try {
			return execFileSync('git', ['config', '--get', 'core.hooksPath'], {
				encoding: 'utf8'
			}).trim();
		} catch {
			return '';
		}
	})();

	// Someone pointing hooksPath somewhere of their own has made a decision;
	// silently overwriting it would be the wrong kind of helpful.
	if (current && current !== '.githooks') process.exit(0);
	if (current === '.githooks') process.exit(0);

	execFileSync('git', ['config', 'core.hooksPath', '.githooks'], quiet);
	console.log('Enabled repository git hooks (.githooks). Bypass one push with --no-verify.');
} catch {
	// Deliberately silent: see the note above about never failing an install.
}
process.exit(0);
