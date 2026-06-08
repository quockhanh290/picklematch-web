# Typecheck Remediation

## Current Baseline

The tracked `typecheck-baseline.json` records TypeScript errors by file and error code.
It intentionally ignores line numbers so normal code movement does not create false regressions.

Run:

```sh
npm run typecheck:guard
```

The guard allows existing error groups to decrease or disappear. It fails when:

- a new file and error-code group appears
- an existing file and error-code group increases

## Updating The Baseline

Only update the baseline after an intentional remediation phase has passed all verification gates:

```sh
npm run typecheck:baseline
```

Review the baseline diff before committing it. The total error count must not increase.

## Required Verification

Run after every remediation phase:

```sh
npm run verify:typecheck-fix
```

This command runs:

1. Typecheck regression guard
2. Encoding check
3. Git whitespace check
4. Production web build

Run feature-specific tests in addition to this command when a phase changes behavior.

## Remediation Rules

- Do not add `@ts-ignore` or broad `as any` casts to hide errors.
- Do not exclude source files from `tsconfig.json` to reduce the count.
- Do not run whole-repository formatting or encoding rewrites.
- Do not change Vietnamese text while fixing types.
- Prefer fixing shared contracts before adding local casts.
- Keep each remediation commit focused on one contract or error family.

The final completion gate remains:

```sh
npm run typecheck
```

It must exit successfully with zero TypeScript errors.
