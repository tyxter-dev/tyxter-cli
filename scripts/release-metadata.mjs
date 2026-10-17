import { appendFileSync, readFileSync } from 'node:fs';

const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const ref = process.env.GITHUB_REF ?? '';
const numeric = '(0|[1-9][0-9]*)';
const identifier = '(?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*)';
const semver = new RegExp(`^${numeric}\\.${numeric}\\.${numeric}(?:-${identifier}(?:\\.${identifier})*)?(?:\\+[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*)?$`);
if (!semver.test(version)) throw new Error('package.json must contain a valid SemVer version');
if (ref.startsWith('refs/tags/') && ref !== `refs/tags/v${version}`) {
  throw new Error('Release tag must match v<package.json version>');
}
const stable = ref === `refs/tags/v${version}` && /^\d+\.\d+\.\d+$/.test(version);
const output = `stable=${stable}\n`;
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, output);
process.stdout.write(output);
