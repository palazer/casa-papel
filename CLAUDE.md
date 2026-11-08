# Casa Papel

All UI work follows `DESIGN.md` (the design system shared with nfl-fantasy); extend it in the same commit as any UI change.
Before a commit run each check with its own guard: `npx tsc -b`, `npm run lint`, `npx vitest run`, `npm run build`, `npm run e2e`.
Never commit anything from `private/` or `tests/private/`; the pre-commit hook in `.githooks/` enforces it.
