import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

execFileSync('pnpm', ['build'], { stdio: 'inherit' });
const result = JSON.parse(execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], { encoding: 'utf8' }));
const pack = Array.isArray(result) ? result[0] : Object.values(result)[0];
const files = pack.files.map((file) => file.path);
assert(files.includes('dist/main.js'), 'package must contain the executable');
assert(files.includes('dist/state.js'), 'package must contain imported modules');
assert(files.every((file) => file === 'package.json' || file === 'README.md' || /^dist\/[^/]+\.(?:js(?:\.map)?|d\.ts)$/.test(file)), 'package contains unexpected files');
assert(!files.some((file) => file.includes('.test.')), 'package must not contain tests');
console.log(`Package contains ${files.length} runtime and documentation files`);
