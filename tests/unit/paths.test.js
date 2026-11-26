/**
 * EPUB CSS Validator - Path Resolution Tests
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

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { findPackageRoot, CACHE_DIR } from '../../lib/core.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');

describe('findPackageRoot', () => {
  it('resolves the package root from the source directory', () => {
    expect(findPackageRoot(path.join(repoRoot, 'lib'))).toBe(repoRoot);
  });

  it('resolves the package root from compiled dist directories', () => {
    expect(findPackageRoot(path.join(repoRoot, 'dist', 'lib'))).toBe(repoRoot);
    expect(findPackageRoot(path.join(repoRoot, 'dist', 'bin'))).toBe(repoRoot);
  });

  it('walks up more than one level from deeply nested directories', () => {
    expect(findPackageRoot(path.join(repoRoot, 'tests', 'unit'))).toBe(repoRoot);
  });

  describe('with a temporary package layout', () => {
    let tempRoot;

    beforeEach(async () => {
      tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'epub-css-validator-'));
      await fs.writeFile(
        path.join(tempRoot, 'package.json'),
        JSON.stringify({ name: 'example', version: '9.9.9' })
      );
    });

    afterEach(async () => {
      await fs.rm(tempRoot, { recursive: true, force: true });
    });

    it('finds the nearest package.json when nested', async () => {
      const nested = path.join(tempRoot, 'dist', 'lib');
      await fs.mkdir(nested, { recursive: true });
      expect(findPackageRoot(nested)).toBe(tempRoot);
    });

    it('terminates and returns an ancestor (or the start) when no package.json exists below it', async () => {      const orphan = path.join(tempRoot, 'no-package-json');
      await fs.mkdir(orphan, { recursive: true });
      // Move the package.json out of the way for this assertion
      await fs.rm(path.join(tempRoot, 'package.json'));

      const root = findPackageRoot(orphan);
      const isSelfOrAncestor = root === orphan || orphan.startsWith(root + path.sep);
      expect(isSelfOrAncestor).toBe(true);
    });
  });
});

describe('cache location', () => {
  it('lives in the package-root .cache directory', () => {
    expect(CACHE_DIR).toBe(path.join(repoRoot, '.cache'));
  });

  it('is the same whether the code runs from dist or from the sources', () => {
    expect(CACHE_DIR).not.toContain(`${path.sep}dist${path.sep}`);
  });
});
