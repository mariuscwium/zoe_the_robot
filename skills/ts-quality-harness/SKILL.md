---
name: ts-quality-harness
description: >
  Set up a strict TypeScript quality harness for any project — ESLint with
  typescript-eslint strict + SonarJS, Vitest with v8 coverage thresholds,
  strict tsconfig, and a pre-push git hook that blocks secrets and PII.
  Use this skill whenever the user wants to add linting, testing, type checking,
  code quality gates, coverage enforcement, or a quality pipeline to a TypeScript
  project. Also trigger when the user says things like "set up CI checks",
  "add a quality gate", "make this project strict", "add eslint and vitest",
  or "enforce code quality". This skill assumes a greenfield setup and is
  heavily opinionated — it installs everything from scratch.
---

# TypeScript Quality Harness

Set up a four-layer quality gate for a TypeScript project:

1. **Strict TypeScript** — `tsc --noEmit` with maximal strictness
2. **ESLint** — `typescript-eslint` strict + stylistic presets, SonarJS plugin, complexity limits
3. **Vitest** — test runner with v8 coverage thresholds at 90/85/90/90
4. **Pre-push hook** — scans commits for leaked secrets and PII before pushing

The gate runs as a single command: `npm run quality` (typecheck → lint → test:coverage).

## Step 1: Install dependencies

First, ensure `package.json` has `"type": "module"` — this is required for ESM imports in `eslint.config.js` and `vitest.config.ts`. If it doesn't, add it.

```bash
npm install -D typescript eslint typescript-eslint eslint-plugin-sonarjs vitest @vitest/coverage-v8 prettier
```

No need for `@typescript-eslint/parser` or `@typescript-eslint/eslint-plugin` separately — the `typescript-eslint` package bundles both.

## Step 2: tsconfig.json

Ask the user what their source directories are (e.g., `src/`, `lib/`, `api/`). Default to `src/` if they don't specify. Then create:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "bundler",
    "lib": ["ES2022"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "noUncheckedIndexedAccess": true,
    "outDir": "./dist",
    "rootDir": "."
  },
  "include": ["<source-dirs>/**/*.ts"],
  "exclude": ["node_modules", "dist", "coverage"]
}
```

Key choices and why:
- `noUncheckedIndexedAccess` catches undefined-at-runtime bugs from array/object indexing — the single most impactful strict flag beyond `strict: true`
- `noUnusedLocals` / `noUnusedParameters` prevents dead code from accumulating
- `isolatedModules` ensures compatibility with tools like esbuild, swc, and Vitest that transpile files individually
- `bundler` moduleResolution works with modern toolchains without requiring `.js` extensions in imports

## Step 3: eslint.config.js

Use the flat config format (ESLint 9+). This is the most opinionated piece — it enforces code complexity limits that keep functions small and readable.

```js
// @ts-check
import tseslint from "typescript-eslint";
import sonarjs from "eslint-plugin-sonarjs";

// eslint-disable-next-line @typescript-eslint/no-deprecated
export default tseslint.config(
  {
    ignores: ["node_modules/", "dist/", "coverage/"],
  },
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: ["eslint.config.js", "vitest.config.ts"],
        },
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    plugins: {
      sonarjs,
    },
    rules: {
      // Complexity — these limits force decomposition into small, testable units
      "complexity": ["error", 10],
      "max-lines-per-function": ["error", { max: 60, skipBlankLines: true, skipComments: true }],
      "max-lines": ["error", { max: 200, skipBlankLines: true, skipComments: true }],
      "max-depth": ["error", 3],
      "max-params": ["error", 4],

      // SonarJS — catches code smells that slip past basic linting
      "sonarjs/cognitive-complexity": ["error", 12],
      "sonarjs/no-duplicate-string": ["error", { threshold: 3 }],
      "sonarjs/no-identical-functions": "error",
      "sonarjs/no-nested-template-literals": "error",

      // TypeScript strict — no escape hatches
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
      "@typescript-eslint/restrict-template-expressions": "error",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],

      // General
      "no-console": "error",
      "eqeqeq": ["error", "always"],
      "prefer-const": "error",
    },
  },
  {
    files: ["**/*.test.ts", "tests/**/*.ts"],
    rules: {
      // Tests need flexibility — long setup, repeated strings, dynamic assertions
      "max-lines-per-function": "off",
      "max-lines": "off",
      "sonarjs/no-duplicate-string": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-call": "off",
    },
  },
);
```

Why these complexity limits:
- **60 lines per function** keeps functions focused on one thing — if you can't fit it in 60 lines (excluding blanks and comments), it needs decomposition
- **complexity 10** caps cyclomatic complexity — deeply branching logic is hard to test and reason about
- **max-depth 3** prevents arrow-code (nested if/for/try blocks)
- **max-params 4** signals that a function is doing too much or needs an options object
- **200 lines per file** encourages single-responsibility modules

## Step 4: vitest.config.ts

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["**/*.test.ts"],
    exclude: ["node_modules", "dist"],
    coverage: {
      provider: "v8",
      include: ["<source-dirs>/**/*.ts"],
      exclude: ["**/*.test.ts", "tests/**"],
      thresholds: {
        statements: 90,
        branches: 85,
        functions: 90,
        lines: 90,
      },
    },
    testTimeout: 10000,
  },
});
```

Replace `<source-dirs>` with the same directories from tsconfig. Branches threshold is 85% (not 90%) because branch coverage is inherently harder to achieve — error handling paths and edge cases in third-party integrations often can't be fully exercised.

## Step 5: package.json scripts

Add these scripts to `package.json`:

```json
{
  "scripts": {
    "typecheck": "tsc --noEmit",
    "lint": "eslint . --max-warnings=0",
    "lint:fix": "eslint . --fix",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage",
    "quality": "npm run typecheck && npm run lint && npm run test:coverage"
  }
}
```

`--max-warnings=0` is critical — it means ESLint warnings are treated as failures. Without this, warnings accumulate silently and the lint step is theater.

## Step 6: Pre-push git hook

Create `.githooks/pre-push` and make it executable. This hook scans the diff of commits being pushed for common secret patterns and PII.

```bash
#!/bin/bash
# Pre-push hook: block pushes containing secrets or PII.
set -euo pipefail

RED='\033[0;31m'
NC='\033[0m'

PATTERNS=(
  'sk-ant-[a-zA-Z0-9_-]+'                    # Anthropic API keys
  'sk-[a-zA-Z0-9]{20,}'                      # OpenAI API keys
  'AAAA[a-zA-Z0-9_-]{30,}'                   # Telegram bot tokens (second part)
  '[0-9]+:AA[A-Za-z0-9_-]{30,}'              # Full Telegram bot token
  'AX[a-zA-Z0-9]{20,}'                       # Upstash Redis tokens
  'GOCSPX-[a-zA-Z0-9_-]+'                    # Google OAuth client secrets
  '1//0[a-zA-Z0-9_-]{30,}'                   # Google refresh tokens
  'ghp_[a-zA-Z0-9]{36}'                      # GitHub personal access tokens
  'gho_[a-zA-Z0-9]{36}'                      # GitHub OAuth tokens
  'xox[bpsa]-[a-zA-Z0-9-]+'                  # Slack tokens
  'eyJ[a-zA-Z0-9_-]{20,}\.'                  # JWT tokens
  '\$2[aby]\$[0-9]{2}\$[./A-Za-z0-9]{53}'    # bcrypt hashes
  'PRIVATE KEY-----'                          # Private keys
)

PII_PATTERNS=(
  '[a-zA-Z0-9._%+-]+@[a-zA-Z0-9-]+\.[a-zA-Z]{2,}'   # Email addresses
  '\+?[0-9]{1,3}[-. (]?[0-9]{2,4}[-. )]?[0-9]{3,4}[-. ]?[0-9]{3,5}' # Phone numbers
)

PII_ALLOWLIST='example\.com|test\.com|localhost|noreply@|\.apps\.googleusercontent'

COMBINED=$(printf '%s|' "${PATTERNS[@]}")
COMBINED="${COMBINED%|}"

while read -r local_ref local_sha remote_ref remote_sha; do
  if [ "$local_sha" = "0000000000000000000000000000000000000000" ]; then
    continue
  fi

  if [ "$remote_sha" = "0000000000000000000000000000000000000000" ]; then
    range="$local_sha --not --remotes"
  else
    range="$remote_sha..$local_sha"
  fi

  # shellcheck disable=SC2086
  diff_output=$(git diff $range -- . ':!package-lock.json' ':!.env.example' ':!.githooks/' 2>/dev/null || true)

  matches=$(echo "$diff_output" | grep -nE "$COMBINED" 2>/dev/null || true)
  if [ -n "$matches" ]; then
    echo -e "${RED}PUSH BLOCKED: Potential secrets detected${NC}"
    echo ""
    echo "$matches" | head -20
    echo ""
    echo "If these are false positives, push with: git push --no-verify"
    exit 1
  fi

  PII_COMBINED=$(printf '%s|' "${PII_PATTERNS[@]}")
  PII_COMBINED="${PII_COMBINED%|}"
  pii_matches=$(echo "$diff_output" | grep -nE "$PII_COMBINED" 2>/dev/null | \
    grep -vE "$PII_ALLOWLIST" 2>/dev/null || true)
  if [ -n "$pii_matches" ]; then
    echo -e "${RED}PUSH BLOCKED: Potential personal info detected${NC}"
    echo ""
    echo "$pii_matches" | head -20
    echo ""
    echo "If these are false positives, push with: git push --no-verify"
    exit 1
  fi
done

exit 0
```

After creating the hook:

```bash
chmod +x .githooks/pre-push
git config core.hooksPath .githooks
```

The hook covers common API key formats (Anthropic, OpenAI, GitHub, Slack, Google, Upstash, Telegram), JWTs, bcrypt hashes, private keys, emails, and phone numbers. The user should customize the patterns and PII allowlist for their specific project — add their own API key prefixes and allowlist any test/example values.

## Step 7: Verify

Run the full quality gate to confirm everything is wired up:

```bash
npm run quality
```

If there are no source files or tests yet, the typecheck and lint will pass but coverage may fail due to thresholds. In that case, let the user know they can temporarily lower thresholds or add `--passWithNoTests` until they have code to cover.

## Checklist

After setup, confirm with the user:
- [ ] `npm run typecheck` passes
- [ ] `npm run lint` passes (or shows fixable issues via `npm run lint:fix`)
- [ ] `npm test` runs (even if no tests yet)
- [ ] `npm run quality` runs all three in sequence
- [ ] `.githooks/pre-push` is executable and configured
- [ ] `package.json` has `"type": "module"` (required for ESM imports in eslint.config.js)
