// This file is part of midnightntwrk/midnight-did-resolver.
// Copyright (C) Midnight Foundation
// SPDX-License-Identifier: Apache-2.0
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { getChromiumExecutablePath } from './playwright-browser.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const fixture = mkdtempSync(path.join(os.tmpdir(), 'resolver-playwright-browser-'));
after(() => rmSync(fixture, { recursive: true, force: true }));
const executable = path.join(fixture, 'packaged chromium');
const linkedExecutable = path.join(fixture, 'chromium link');
const nonExecutable = path.join(fixture, 'not executable');
const cache = path.join(fixture, 'isolated cache');
const log = path.join(fixture, 'npm.jsonl');
const bin = path.join(fixture, 'bin');
mkdirSync(bin);
writeFileSync(executable, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
writeFileSync(nonExecutable, 'not executable\n');
chmodSync(nonExecutable, 0o644);
symlinkSync(executable, linkedExecutable);
writeFileSync(path.join(bin, 'docker'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
writeFileSync(path.join(bin, 'npm'), `#!${process.execPath}
import { appendFileSync } from 'node:fs';
const args = process.argv.slice(2);
appendFileSync(process.env.FIXTURE_LOG, JSON.stringify({
  args,
  cache: process.env.PLAYWRIGHT_BROWSERS_PATH ?? null,
  executable: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ?? null,
}) + '\\n');
if (process.env.FAIL_NPM_MATCH && args.join(' ').includes(process.env.FAIL_NPM_MATCH)) process.exit(23);
`, { mode: 0o755 });

const cleanEnv = () => {
  const env = { ...process.env };
  for (const key of ['PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH', 'PLAYWRIGHT_BROWSERS_PATH',
    'SKIP_LONG_RUNNING', 'SKIP_LINT_FIX', 'FAIL_NPM_MATCH', 'MIDNIGHT_DID_RESOLVER_DRY_RUN']) delete env[key];
  return env;
};
const loadConfig = (env = {}) => spawnSync(process.execPath, ['--input-type=module', '-e',
  "const { default: config } = await import('./did-manager-service/playwright.config.ts'); console.log(JSON.stringify(config));"],
{ cwd: root, encoding: 'utf8', env: { ...cleanEnv(), ...env } });

const runManager = (env = {}, throughRun = false) => {
  rmSync(log, { force: true });
  const result = spawnSync('bash', throughRun ? ['./run.sh', 'manager', '--strict'] : ['./run-manager.sh'], {
    cwd: root,
    encoding: 'utf8',
    env: { ...cleanEnv(), PATH: `${bin}${path.delimiter}${process.env.PATH}`, FIXTURE_LOG: log,
      PROOF_SERVER_IMAGE: 'regression-fixture-no-docker', ...env },
  });
  const calls = (() => { try { return readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse); }
    catch (error) { if (error.code === 'ENOENT') return []; throw error; } })();
  return { ...result, calls };
};
const browserCalls = result => result.calls.filter(c => c.args.some(a => /playwright|test:e2e/u.test(a)));
const customEnv = { PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH: executable, PLAYWRIGHT_BROWSERS_PATH: cache };

test('unset browser retains default config and all diagnostic/time-out settings', () => {
  assert.equal(getChromiumExecutablePath({}), undefined);
  const result = loadConfig();
  assert.equal(result.status, 0, result.stderr);
  const config = JSON.parse(result.stdout);
  assert.equal(config.testDir, './src/e2e');
  assert.equal(config.timeout, 180_000);
  assert.deepEqual(config.expect, { timeout: 30_000 });
  assert.equal(config.fullyParallel, false);
  assert.equal(config.workers, 1);
  assert.deepEqual(config.use, {
    headless: true, trace: 'retain-on-failure', screenshot: 'only-on-failure', video: 'retain-on-failure',
  });
  assert.deepEqual(config.reporter, [['list'], ['html', { open: 'never' }]]);
});

for (const target of [executable, linkedExecutable]) {
  test(`actual config honors valid explicit executable including spaces/symlinks: ${path.basename(target)}`, () => {
    const result = loadConfig({ ...customEnv, PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH: target });
    assert.equal(result.status, 0, result.stderr);
    const configured = JSON.parse(result.stdout);
    const original = JSON.parse(loadConfig().stdout);
    assert.deepEqual(configured, { ...original, use: { ...original.use, launchOptions: { executablePath: target } } });
  });
}

const invalidExecutables = [
  ['empty', ''], ['relative', './chromium'], ['missing', path.join(fixture, 'missing')],
  ['directory', fixture], ['not executable', nonExecutable],
];
for (const [name, target] of invalidExecutables) {
  test(`invalid explicit browser fails helper/config/wrapper without fallback: ${name}`, () => {
    const env = { ...customEnv, PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH: target };
    assert.throws(() => getChromiumExecutablePath(env), /PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH/u);
    const config = loadConfig(env);
    assert.notEqual(config.status, 0);
    assert.match(config.stderr, /PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH/u);
    const runner = runManager(env);
    assert.notEqual(runner.status, 0);
    assert.match(runner.stderr, /PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH/u);
    assert.deepEqual(runner.calls, [], 'invalid input must fail before any npm command');
  });
}

test('actual default wrapper keeps managed Chromium install and unsets caller cache for both browser commands', () => {
  const result = runManager({ PLAYWRIGHT_BROWSERS_PATH: cache });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(browserCalls(result), [
    { args: ['run', 'playwright:install', '-w', '@midnight-ntwrk/midnight-did-manager-service'], cache: null, executable: null },
    { args: ['run', 'test:e2e:standalone', '-w', '@midnight-ntwrk/midnight-did-manager-service'], cache: null, executable: null },
  ]);
});

test('actual strict run.sh manager wrapper selects ffmpeg only and preserves isolated cache and executable', () => {
  const result = runManager(customEnv, true);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(browserCalls(result), [
    { args: ['exec', '-w', '@midnight-ntwrk/midnight-did-manager-service', '--', 'playwright', 'install', 'ffmpeg'],
      cache, executable },
    { args: ['run', 'test:e2e:standalone', '-w', '@midnight-ntwrk/midnight-did-manager-service'], cache, executable },
  ]);
});

test('custom wrapper defaults to clone-local cache, never global cache', () => {
  const result = runManager({ PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH: executable });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(browserCalls(result).length, 2);
  for (const call of browserCalls(result)) assert.equal(call.cache, path.join(root, 'node_modules/.cache/ms-playwright'));
});

for (const invalidCache of ['', 'relative/cache', '0']) {
  test(`invalid explicit custom cache fails config/wrapper without redirect: ${JSON.stringify(invalidCache)}`, () => {
    const env = { ...customEnv, PLAYWRIGHT_BROWSERS_PATH: invalidCache };
    const config = loadConfig(env);
    assert.notEqual(config.status, 0);
    assert.match(config.stderr, /PLAYWRIGHT_BROWSERS_PATH/u);
    const result = runManager(env);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /PLAYWRIGHT_BROWSERS_PATH/u);
    assert.deepEqual(result.calls, []);
  });
}

for (const [mode, env, install] of [
  ['managed', {}, 'playwright:install'], ['custom', customEnv, 'playwright install ffmpeg'],
]) {
  test(`${mode} install failure propagates and prevents E2E`, () => {
    const result = runManager({ ...env, FAIL_NPM_MATCH: install });
    assert.equal(result.status, 23, result.stderr);
    assert.equal(browserCalls(result).length, 1);
  });
  test(`${mode} E2E failure propagates without fallback/retry`, () => {
    const result = runManager({ ...env, FAIL_NPM_MATCH: 'test:e2e:standalone' });
    assert.equal(result.status, 23, result.stderr);
    assert.equal(browserCalls(result).length, 2);
  });
}

test('light manager mode still skips browser installation and E2E', () => {
  const result = runManager({ ...customEnv, SKIP_LONG_RUNNING: '1' });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(browserCalls(result), []);
});
