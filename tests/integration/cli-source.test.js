/**
 * EPUB CSS Validator - CLI Run From Sources Tests
 *
 * Copyright (C) 2026 Jeff Spiers
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * See LICENSE file for the full text of the GNU General Public License.
 */

import { describe, it, expect } from 'vitest';
import { execFile } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');

/**
 * Run the TypeScript CLI directly, as documented for development.
 * `node --import tsx` avoids depending on a globally installed tsx binary.
 */
function runFromSource(args) {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      ['--import', 'tsx', path.join(repoRoot, 'bin', 'epub-css-validator.ts'), ...args],
      { cwd: repoRoot },
      (error, stdout, stderr) => {
        resolve({
          stdout,
          stderr,
          code: error && typeof error.code === 'number' ? error.code : 0
        });
      }
    );
  });
}

describe('CLI run from TypeScript sources', () => {
  it('reports its version instead of failing to locate package.json', async () => {
    const { stdout, stderr, code } = await runFromSource(['--version']);
    const expectedVersion = JSON.parse(
      await fs.readFile(path.join(repoRoot, 'package.json'), 'utf-8')
    ).version;

    expect(code).toBe(0);
    expect(stderr).not.toMatch(/ENOENT/);
    expect(stdout.trim()).toBe(expectedVersion);
  }, 30000);

  it('validates a CSS file', async () => {
    const { stdout, code } = await runFromSource([path.join('examples', 'test.css')]);
    expect(code).toBe(1); // examples/test.css contains known errors
    expect(stdout).toMatch(/block-no-empty/);
  }, 30000);
});
