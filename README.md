# EPUB CSS Validator

[![npm version](https://badge.fury.io/js/epub-css-validator.svg)](https://www.npmjs.com/package/epub-css-validator)

A command-line tool to validate CSS in EPUB files using the same [stylelint](https://stylelint.io/) rules as [Calibre](https://calibre-ebook.com/)'s Edit Book tool.

## Features

- ✅ Automatically fetches and updates Calibre stylelint rules from GitHub
- ✅ Validates CSS files or EPUB files (directory validation is in the library API)
- ✅ Multiple output formats (text, JSON, JUnit XML)
- ✅ Custom configuration support
- ✅ Easy CI/CD integration
- ✅ TypeScript with full type definitions for library use

## Installation

### Via npm (Recommended)

```bash
# Install globally
npm install -g epub-css-validator

# Or use npx without installation
npx epub-css-validator book.epub
```

### Requirements

- Node.js 20.19.0 or higher
- npm (comes with Node.js)

## Quick Start

```bash
# Validate a stylesheet or an EPUB (no install needed)
npx epub-css-validator stylesheet.css
npx epub-css-validator book.epub

# Calibre's rules are fetched and cached automatically on first run.
# Refresh them at any time with:
npx epub-css-validator --update-config
```

The exit code is `0` when no errors are found, `1` when errors are found or the
run fails, so the command can gate CI directly.

## Usage

```bash
# Basic validation (after npm install -g)
epub-css-validator stylesheet.css
epub-css-validator book.epub

# Or use npx without installation
npx epub-css-validator stylesheet.css

# Options
-f, --format <format>    Output: text, json, junit (default: text)
-u, --update-config      Refresh Calibre's config from GitHub
-c, --config <path>      Use custom config file
-v, --verbose            Print stack traces when a run fails
--cache-info             Show cached config info
-V, --version            Print the version
-h, --help               Show help
```

### Examples

```bash
# Check cached config
epub-css-validator --cache-info

# JSON output
epub-css-validator --format json book.epub

# JUnit output
epub-css-validator --format junit book.epub

# Custom config
epub-css-validator --config ./my-stylelint.js stylesheet.css
```

## Output

### Text Format (Default)

```
Validating CSS: examples/test.css

/path/to/examples/test.css
  9:14  ✖  Unexpected empty block (block-no-empty)  block-no-empty
  14:5  ✖  Unexpected unknown property "adobe-hyphenate" (property-no-unknown)  property-no-unknown
  19:1  ✖  Unexpected unknown type selector "toc1" (selector-type-no-unknown)  selector-type-no-unknown

✗ 3 error(s)
```

### JSON Format

```json
{
  "results": [
    {
      "source": "/path/to/examples/test.css",
      "errored": true,
      "warnings": [
        {
          "line": 9,
          "column": 14,
          "rule": "block-no-empty",
          "severity": "error",
          "text": "Unexpected empty block (block-no-empty)"
        }
      ]
    }
  ]
}
```

### JUnit Format

One `<testsuite>` per stylesheet, so an EPUB with several CSS files reports
each one separately:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<testsuites>
  <testsuite name="book.epub (styles/main.css)" tests="1" failures="1">
    <testcase name="block-no-empty - line 9">
      <failure message="Unexpected empty block (block-no-empty)" type="error"/>
    </testcase>
  </testsuite>
</testsuites>
```

With `--format json` or `--format junit`, stdout contains only the report;
progress messages go to stderr, so redirecting or piping the output is safe.
The exit code is still 1 when errors are found.

## Calibre's Rules

Uses the same stylelint configuration as Calibre's Edit Book tool, including:

- `property-no-unknown` - Unknown CSS properties
- `block-no-empty` - Empty CSS blocks
- `selector-type-no-unknown` - Unknown HTML element selectors
- `color-no-invalid-hex` - Invalid hex colors
- `declaration-block-no-duplicate-properties` - Duplicate properties
- `function-no-unknown` - Unknown CSS functions
- `unit-no-unknown` - Unknown CSS units

See [Calibre's stylelint.js](https://github.com/kovidgoyal/calibre/blob/master/resources/stylelint.js) for the complete list.

## How It Works

1. Fetches Calibre's `stylelint.js` from GitHub and caches it locally
2. Extracts rules from Calibre's JavaScript configuration
3. Validates CSS files using stylelint
4. For EPUB files, extracts and validates all CSS files

## CI/CD Integration

### GitHub Actions

No checkout of this project is needed — the published CLI is installed by `npx`:

```yaml
name: Validate EPUB CSS
on: [push, pull_request]
jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
        with:
          node-version: 22
      - run: npx epub-css-validator book.epub
```

The step fails the job when errors are reported (exit code 1). For a JUnit
report instead:

```yaml
      - run: npx epub-css-validator --format junit book.epub > report.xml
```

### GitLab CI

```yaml
validate-css:
  image: node:22
  script:
    - npx epub-css-validator --format junit book.epub > report.xml
  artifacts:
    when: always
    reports:
      junit: report.xml
```

## Troubleshooting

### "command not found: node"

Install Node.js from <https://nodejs.org/> (version 20.19.0+ required).

### "Cannot find module"

For a local checkout, run `npm install`. If the CLI is installed globally,
reinstall it with `npm install -g epub-css-validator`.

### "No cached config found"

```bash
epub-css-validator --update-config
```

### "Could not parse Calibre config"

Update the config again. If it persists, use a custom config:

```bash
epub-css-validator --config ./my-stylelint.js stylesheet.css
```

### "No stylelint rules could be loaded"

The config was found but contained no usable rules, so validation would have
checked nothing. For Calibre's config, refresh the cache with
`--update-config`. For a custom config, make sure it exports a `rules` object.

### Network Issues

Calibre's rules are cached next to the installed package, and
`epub-css-validator --cache-info` prints the exact path. If GitHub is
unreachable, place a copy there manually:

1. Download from <https://github.com/kovidgoyal/calibre/blob/master/resources/stylelint.js>
2. Save it in the directory printed by `--cache-info` as `calibre-stylelint.js`
3. Create `cache-info.json` in the same directory: `{"version":"manual","cachedAt":"2024-01-01T00:00:00.000Z","path":"calibre-stylelint.js"}`

## Development

```bash
git clone https://github.com/cusk-io/epub-css-validator.git
cd epub-css-validator
npm install
npm run update-config
npx tsx bin/epub-css-validator.ts examples/test.css
npm run type-check
npm run test:run
```

```
epub-css-validator/
├── .github/workflows/           # CI and tag-driven release
├── bin/epub-css-validator.ts    # CLI entry point
├── lib/core.ts                  # Core validation logic (library-ready)
├── tests/                       # Unit and integration tests
├── config/stylelintrc.js        # Example custom config
├── examples/test.css            # Test file
├── .cache/                      # Cached Calibre config (gitignored)
├── tsconfig.json                # TypeScript configuration
└── package.json
```

### Releasing

Releases are published by CI from a tag on `main`; npm authentication uses
GitHub OIDC trusted publishing, so no token is stored in the repository.

```bash
# 1. Bump the version (creates no commit or tag)
npm version patch --no-git-tag-version

# 2. Commit and merge to main, then tag the merge commit
git commit -am "chore: bump version to x.y.z"
git tag -a vX.Y.Z -m "vX.Y.Z"
git push github main
git push github vX.Y.Z
```

This repository calls the shared `npm-publish` workflow from
[`cusk-io/.github`](https://github.com/cusk-io/.github); it runs the suite on
Node 22 and 24 first, then checks that the tag is an ancestor of `main` and
matches `package.json`, and only then publishes with provenance and creates a
GitHub Release with generated notes. A tag from a feature branch is rejected.

## Library Usage

The package is ESM-only and exports its core validation functions with
TypeScript definitions:

```typescript
import { validateCSS, validateEPUB, validateDirectory } from 'epub-css-validator';

const result = await validateCSS('stylesheet.css');
console.log(`Errors: ${result.totalErrors}, Warnings: ${result.totalWarnings}`);

// Directory validation and EPUB validation are library-only conveniences
const all = await validateDirectory('./styles');
const book = await validateEPUB('book.epub');
```

`validateCSS` and `validateEPUB` return the raw stylelint `results` alongside
the counts; `validateDirectory` returns aggregate counts only.

## Contributing

Contributions welcome! Please feel free to submit a Pull Request.

## Acknowledgments

- [Calibre](https://calibre-ebook.com/) - CSS validation rules (GPLv3, Kovid Goyal)
- [stylelint](https://stylelint.io/) - CSS linter

## License

**GNU General Public License version 3 (GPLv3)**

See [LICENSE](LICENSE) for the full text.
