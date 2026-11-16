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

import { accessSync, constants, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Shared by the real Playwright config and manager runner. Never fall back when
// an explicit executable is invalid; only an unset variable selects the default.
export function getChromiumExecutablePath(env = process.env) {
  const executablePath = env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
  if (executablePath === undefined) return undefined;

  const variable = 'PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH';
  if (!path.isAbsolute(executablePath)) {
    throw new Error(`${variable} must be an absolute executable file path: ${JSON.stringify(executablePath)}`);
  }
  try {
    if (!statSync(executablePath).isFile()) throw new Error('not a regular file');
    accessSync(executablePath, constants.X_OK);
  } catch (cause) {
    throw new Error(`${variable} is not an executable file: ${JSON.stringify(executablePath)}`, { cause });
  }

  const cache = env.PLAYWRIGHT_BROWSERS_PATH;
  if (cache !== undefined && !path.isAbsolute(cache)) {
    throw new Error(`PLAYWRIGHT_BROWSERS_PATH must be an absolute cache directory in custom-browser mode: ${JSON.stringify(cache)}`);
  }
  return executablePath;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv[2] !== '--validate' || process.argv.length !== 3) {
      throw new Error('Usage: node scripts/playwright-browser.mjs --validate');
    }
    getChromiumExecutablePath();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
