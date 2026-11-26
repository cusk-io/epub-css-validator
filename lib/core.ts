/**
 * EPUB CSS Validator - Core Validation Logic
 *
 * Copyright (C) 2026 Jeff Spiers
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program uses CSS validation rules from Calibre (https://calibre-ebook.com/),
 * which is licensed under the GNU General Public License v3.
 * Calibre Copyright (C) 2023 Kovid Goyal <kovid at kovidgoyal.net>
 *
 * See LICENSE file for the full text of the GNU General Public License.
 */

import stylelint from 'stylelint';
import axios from 'axios';
import fs from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import JSZip from 'jszip';
import { glob } from 'glob';
import os from 'os';

// ESM polyfills for __dirname and __filename
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Find the nearest directory containing a package.json, walking up from
 * `startDir`.
 *
 * Compiled code lives in `dist/lib` or `dist/bin`, so the package root is one
 * level further away than it is when running from the TypeScript sources.
 * Resolving it by searching instead of assuming a fixed depth keeps the CLI
 * working under both layouts.
 */
export function findPackageRoot(startDir: string = __dirname): string {
  const start = path.resolve(startDir);
  let dir = start;

  for (;;) {
    if (existsSync(path.join(dir, 'package.json'))) {
      return dir;
    }

    const parent = path.dirname(dir);
    if (parent === dir) {
      // Nothing found (e.g. running from a temp directory)
      return start;
    }
    dir = parent;
  }
}

const CALIBRE_REPO = 'kovidgoyal/calibre';
const CONFIG_PATH = 'resources/stylelint.js';

/**
 * Cache directory for Calibre's config.
 *
 * Resolved against the package root rather than `__dirname` so the cache lives
 * in one place (.cache/ in the project) whether the code runs from `dist/` or
 * straight from the TypeScript sources.
 */
export const CACHE_DIR = path.join(findPackageRoot(), '.cache');
export const CACHE_FILE = path.join(CACHE_DIR, 'calibre-stylelint.js');
export const CACHE_INFO_FILE = path.join(CACHE_DIR, 'cache-info.json');

/**
 * Type definitions for the validation results
 */
export interface ValidationResult {
  totalErrors: number;
  totalWarnings: number;
  results?: stylelint.LintResult[];
}

export interface ValidationOptions {
  format?: 'text' | 'json' | 'junit';
  config?: string;
  verbose?: boolean;
}

export interface CacheInfo {
  version: string;
  cachedAt: string;
  path: string;
}

export interface StylelintRules {
  [ruleName: string]: any;
}

/**
 * Fetch Calibre's stylelint config from GitHub
 */
export async function fetchCalibreConfig(): Promise<string> {
  const url = `https://raw.githubusercontent.com/${CALIBRE_REPO}/master/${CONFIG_PATH}`;
  const response = await axios.get(url);
  return response.data;
}

/**
 * Get cached Calibre config
 */
export async function getCachedConfig(): Promise<string | null> {
  try {
    return await fs.readFile(CACHE_FILE, 'utf-8');
  } catch (error) {
    return null;
  }
}

/**
 * Get cached config information
 */
export async function getCachedConfigInfo(): Promise<CacheInfo | null> {
  try {
    const info = await fs.readFile(CACHE_INFO_FILE, 'utf-8');
    return JSON.parse(info) as CacheInfo;
  } catch (error) {
    return null;
  }
}

/**
 * Update cached Calibre config
 */
export async function updateConfig(): Promise<string> {
  const config = await fetchCalibreConfig();

  // Create cache directory if it doesn't exist
  await fs.mkdir(CACHE_DIR, { recursive: true });

  // Save config
  await fs.writeFile(CACHE_FILE, config);

  // Save cache info with version
  const info: CacheInfo = {
    version: await getLatestCalibreVersion(),
    cachedAt: new Date().toISOString(),
    path: CACHE_FILE
  };
  await fs.writeFile(CACHE_INFO_FILE, JSON.stringify(info, null, 2));

  return config;
}

/**
 * Get latest Calibre version from GitHub API
 */
export async function getLatestCalibreVersion(): Promise<string> {
  try {
    const response = await axios.get(`https://api.github.com/repos/${CALIBRE_REPO}/commits/master`);
    return response.data.sha.substring(0, 7);
  } catch (error) {
    return 'unknown';
  }
}

/**
 * Matches the openings of a rules object literal in Calibre's config.
 *
 * Calibre has shipped two shapes over time:
 *   - older: `config: { rules: { ... } }`
 *   - newer: `var rules = { ... }` followed by `config: { rules: rules }`
 *
 * Both are matched here, and the `rules: rules` reference is not, since it has
 * no brace directly after the colon.
 */
const RULES_OBJECT_PATTERN_SOURCE = '\\brules\\s*[=:]\\s*\\{';

/**
 * Index of the closing brace matching the brace at `openIndex`, skipping over
 * string literals and comments so that braces inside them are not counted.
 * Returns -1 if the object literal is unterminated.
 */
function findClosingBrace(source: string, openIndex: number): number {
  let depth = 0;

  for (let i = openIndex; i < source.length; i++) {
    const char = source[i];
    const next = source[i + 1];

    if (char === '/' && next === '/') {
      const newline = source.indexOf('\n', i + 2);
      if (newline === -1) return -1;
      i = newline;
      continue;
    }

    if (char === '/' && next === '*') {
      const end = source.indexOf('*/', i + 2);
      if (end === -1) return -1;
      i = end + 1;
      continue;
    }

    if (char === '"' || char === "'" || char === '`') {
      let j = i + 1;
      while (j < source.length) {
        if (source[j] === '\\') {
          j += 2;
          continue;
        }
        if (source[j] === char) break;
        j++;
      }
      if (j >= source.length) return -1;
      i = j;
      continue;
    }

    if (char === '{') {
      depth++;
    } else if (char === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }

  return -1;
}

/**
 * Extract rules from Calibre's config content
 */
export function extractRules(configContent: string): StylelintRules {
  // Calibre's config is wrapped in a browser-style IIFE, so walk every
  // `rules = {` / `rules: {` opening and use the first one that parses into a
  // non-empty object. Looking for `rules:` alone missed the newer upstream
  // format, where the rules are declared with `var rules = { ... }` and only
  // referenced later as `config: { rules: rules }`.
  const pattern = new RegExp(RULES_OBJECT_PATTERN_SOURCE, 'g');
  let foundRulesOpening = false;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(configContent)) !== null) {
    foundRulesOpening = true;

    const openIndex = match.index + match[0].lastIndexOf('{');
    const closeIndex = findClosingBrace(configContent, openIndex);
    if (closeIndex === -1) {
      continue;
    }

    const rulesStr = configContent.slice(openIndex, closeIndex + 1);

    try {
      const rules = new Function(`return (${rulesStr});`)() as StylelintRules | null;
      if (rules && typeof rules === 'object' && !Array.isArray(rules) && Object.keys(rules).length > 0) {
        return rules;
      }
      // An empty literal (or a non-object) is a decoy such as a nested
      // `rules: {}` placeholder; keep looking.
    } catch (error) {
      if (process.env.DEBUG) {
        console.warn('Error parsing Calibre rules object:', (error as Error).message);
      }
    }
  }

  if (!foundRulesOpening) {
    // No rules section at all - nothing to validate against
    return {};
  }

  console.warn('Warning: Could not parse Calibre config, using default rules');
  if (process.env.DEBUG) {
    console.warn('Error details: no rules object could be extracted from the config');
  }
  return getDefaultRules();
}

/**
 * Get default stylelint rules (fallback)
 */
export function getDefaultRules(): StylelintRules {
  return {
    'property-no-unknown': true,
    'block-no-empty': true,
    'selector-type-no-unknown': [true, { ignore: ['custom-elements'] }],
    'color-no-invalid-hex': true,
    'declaration-block-no-duplicate-properties': true,
    'function-no-unknown': true,
    'unit-no-unknown': true,
  };
}

/**
 * Guard against running stylelint with no rules: it would report no problems at
 * all, which is indistinguishable from a genuinely clean stylesheet.
 */
function requireRules(rules: StylelintRules, source: string, hint: string): StylelintRules {
  if (!rules || Object.keys(rules).length === 0) {
    throw new Error(
      `No stylelint rules could be loaded from ${source}, so nothing would be checked. ${hint}`
    );
  }
  return rules;
}

/**
 * Validate a CSS file (core function - no console output)
 */
export async function validateCSS(filePath: string, options: ValidationOptions = {}): Promise<ValidationResult> {
  let config: stylelint.Config;

  if (options.config) {
    // Use custom config
    const customConfigContent = await fs.readFile(options.config, 'utf-8');
    const rules = requireRules(
      extractRules(customConfigContent),
      `custom config ${options.config}`,
      'Provide a config that defines a "rules" object.'
    );
    config = { rules };
  } else {
    // Use Calibre's config
    const calibreConfig = await getCachedConfig() || await updateConfig();
    const rules = requireRules(
      extractRules(calibreConfig),
      `Calibre's stylelint config (cached at ${CACHE_FILE})`,
      'Run with --update-config to refresh the cached copy.'
    );
    config = { rules };
  }

  const result = await stylelint.lint({
    files: filePath,
    config: config
  } as stylelint.LinterOptions);

  // Filter out "Unknown rule" warnings (deprecated rules in Calibre's config).
  // Filter the returned results as well as the counts: the JSON and JUnit
  // reports are built from these results, so keeping the warnings here would
  // make them report failures that the summary and exit code do not.
  const filteredResults = result.results.map(fileResult => {
    const warnings = fileResult.warnings.filter(w => !w.text.includes('Unknown rule'));
    return {
      ...fileResult,
      warnings,
      errored: warnings.some(w => w.severity === 'error')
    };
  });

  const filteredWarnings = filteredResults.flatMap(fileResult => fileResult.warnings);

  const errorCount = filteredWarnings.filter(w => w.severity === 'error').length;
  const warningCount = filteredWarnings.filter(w => w.severity === 'warning').length;

  return {
    totalErrors: errorCount,
    totalWarnings: warningCount,
    results: filteredResults
  };
}

/**
 * Validate all CSS files in a directory
 */
export async function validateDirectory(dirPath: string, options: ValidationOptions = {}): Promise<ValidationResult> {
  const cssFiles = glob.sync('**/*.css', {
    cwd: dirPath,
    absolute: true
  });

  let totalErrors = 0;
  let totalWarnings = 0;

  for (const file of cssFiles) {
    const result = await validateCSS(file, options);
    totalErrors += result.totalErrors;
    totalWarnings += result.totalWarnings;
  }

  return { totalErrors, totalWarnings };
}

/**
 * Validate CSS in an EPUB file (core function - no console output)
 */
export async function validateEPUB(epubPath: string, options: ValidationOptions = {}): Promise<ValidationResult> {
  const data = await fs.readFile(epubPath);
  const zip = await JSZip.loadAsync(data);

  const cssFiles: JSZip.JSZipObject[] = [];
  zip.forEach((relativePath, file) => {
    if (relativePath.endsWith('.css') && !file.dir) {
      cssFiles.push(file);
    }
  });

  let totalErrors = 0;
  let totalWarnings = 0;
  const allResults: stylelint.LintResult[] = [];

  if (cssFiles.length === 0) {
    return { totalErrors: 0, totalWarnings: 0 };
  }

  for (const file of cssFiles) {
    const content = await file.async('string');
    const cssPath = file.name; // Original CSS path in EPUB

    // Write to temp file for stylelint (use system temp directory)
    const tempFile = path.join(os.tmpdir(), `epub-css-validator-${Date.now()}.css`);
    await fs.writeFile(tempFile, content);

    try {
      const result = await validateCSS(tempFile, options);
      totalErrors += result.totalErrors;
      totalWarnings += result.totalWarnings;
      if (result.results) {
        // Update the source to show the original CSS path from EPUB
        result.results.forEach(r => {
          r.source = `${epubPath} (${cssPath})`;
        });
        allResults.push(...result.results);
      }
    } finally {
      // Clean up temp file
      await fs.unlink(tempFile).catch(() => {});
    }
  }

  return { totalErrors, totalWarnings, results: allResults };
}

/**
 * Escape a string for use in XML text or a double-quoted attribute value.
 */
function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Format results as JUnit XML
 */
export function formatJUnit(result: ValidationResult, filePath: string): string {
  const testCases: Array<{ name: string; failure: { message: string; type: string } }> = [];

  if (result.results) {
    for (const fileResult of result.results) {
      for (const warning of fileResult.warnings) {
        testCases.push({
          name: `${warning.rule} - line ${warning.line}`,
          failure: {
            message: warning.text,
            type: warning.severity
          }
        });
      }
    }
  }

  // Stylelint messages routinely contain double quotes (for example
  // 'Unexpected duplicate selector "p"'), and file paths may contain '&', so
  // everything interpolated here has to be escaped or the report is not XML.
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<testsuites>
  <testsuite name="${escapeXml(filePath)}" tests="${testCases.length}" failures="${testCases.length}">
${testCases.map(tc => `    <testcase name="${escapeXml(tc.name)}">
      <failure message="${escapeXml(tc.failure.message)}" type="${escapeXml(tc.failure.type)}"/>
    </testcase>`).join('\n')}
  </testsuite>
</testsuites>`;

  return xml;
}
