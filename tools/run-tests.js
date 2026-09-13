#!/usr/bin/env node
// Runs the compiled test files with node's built-in test runner.
//
// We resolve the file list here instead of passing `out-test/test/*.test.js`
// to `node --test`: npm runs scripts through cmd.exe on Windows, which leaves
// the glob unexpanded, and node only learned to expand globs itself in v22.
// Explicit paths behave identically on every supported node and OS.

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const testDir = path.join(__dirname, '..', 'out-test', 'test');

function collect(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return collect(full);
    }
    return entry.isFile() && entry.name.endsWith('.test.js') ? [full] : [];
  });
}

if (!fs.existsSync(testDir)) {
  console.error(`No compiled tests found at ${testDir}. Run "npm run build-tests" first.`);
  process.exit(1);
}

const files = collect(testDir).sort();
if (files.length === 0) {
  console.error(`No *.test.js files found in ${testDir}.`);
  process.exit(1);
}

const result = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit' });
if (result.error) {
  throw result.error;
}
process.exit(result.status === null ? 1 : result.status);
