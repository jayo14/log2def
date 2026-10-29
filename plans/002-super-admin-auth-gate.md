# Plan 002: Gate the Super-Admin Shell on Resolved Authorization

> **Executor instructions**: Follow the plan step by step and verify each gate. Stop and report on any condition listed below. Update the status row in `plans/README.md` when complete.
>
> **Drift check (run first)**: `git diff --stat 9597dcc..HEAD -- 'frontend/app/(super-admin)/layout.tsx' frontend/lib/auth-context.tsx frontend/tests` The current layout has an uncommitted local change in this file at the time of planning; preserve it and reconcile the current-state excerpt before editing. If the change is from another task or the file differs from the excerpt, stop and report rather than overwrite it.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: MED — auth loading and stale stored user semantics could otherwise create redirect loops or a visible flash
- **Depends on**: none
- **Category**: security
- **Planned at**: commit `9597dcc`, 2026-10-29

## Why this matters

The super-admin layout is a client component and authorization state initializes as `{ user: null, isLoading: true }`. Rendering the admin layout or nested page children while that state is unresolved can briefly expose privileged operational UI to an unauthenticated or non-admin browser, even though the backend remains the actual security boundary. The layout should render only a neutral verification state while loading, and render the admin shell/children only after a resolved authenticated user is confirmed as a superuser.

## Current state

- `frontend/app/(super-admin)/layout.tsx` renders the shell and `{children}` unless `user && !user.is_superuser`; thus `user === null` during loading is not gated in the committed version (`9597dcc`, lines 62-95).
- `frontend/lib/auth-context.tsx:20-24,101-106` provides `user`, `isLoading`, and `isAuthenticated`. `AuthProvider` begins loading and resolves auth in `useEffect` around lines 188-204; it may use cached user data when no token is usable, so the shell must also require `isAuthenticated` and a current resolved user if the auth contract can supply it.
- The current working tree has an uncommitted edit to the same layout that adds a loading branch and `router.replace` during render. Do not discard or overwrite it. During execution, inspect `git diff` and incorporate only changes needed to satisfy this plan; move side effects out of render and require the resolved auth state.
- Repo frontend commands from `AGENTS.md`: `npx tsc --noEmit`, `npx eslint . --max-warnings=<current baseline>`, `npm run build` from `frontend/`. `frontend/package.json` has no component-test command; existing lightweight checks use Node assertions under `frontend/tests/` (`sidebar-mobile-toggle.test.mjs`).
- UX intent in `docs/super-admin-dashboard-ux-strategy.md`: use clear recovery paths and truthful async states. Keep any loading state neutral and use semantic theme tokens. Backend `IsSuperAdmin` remains mandatory and must not be weakened.

## Commands you will need

Run from `frontend/`:

| Purpose | Command | Expected on success |
|---|---|---|
| Typecheck | `npx tsc --noEmit` | Exit 0, no type errors |
| Lint | `npx eslint 'app/(super-admin)/layout.tsx'` | Exit 0 |
| Build | `npm run build` | Exit 0 |
| Contract regression | `node tests/super-admin-layout-auth.test.mjs` | Exit 0, assertions confirm gate ordering and redirect handling |

No dependency installation is in scope. A full browser test harness is not currently configured; do not add one for this small change.

## Scope

**In scope**:
- `frontend/app/(super-admin)/layout.tsx`
- `frontend/tests/super-admin-layout-auth.test.mjs` (create if no better existing test location)

**Out of scope**:
- Backend authorization/permission changes.
- Refactoring `AuthProvider`, localStorage/JWT migration, unrelated frontend routes, UI redesign, or changes to token/session semantics.
- Removing or resetting existing user changes in either in-scope file.

## Git workflow

- Branch: `fix/phase-<n>-super-admin-auth-gate` per `AGENTS.md`; do not guess phase number if unknown.
- Do not commit or push unless explicitly asked.

## Steps

### Step 1: Add a regression contract check

Create a focused Node assertion test in `frontend/tests/super-admin-layout-auth.test.mjs`, matching the existing `sidebar-mobile-toggle.test.mjs` approach. Check that the layout reads `isLoading`, presents a non-sensitive loading state before the shell, returns a denial/redirect for unauthenticated or non-superuser users, and places `{children}` only in the authorized shell. Avoid brittle exact markup snapshots; assert control-flow order and that redirect side effects are performed from an effect, not during render.

**Verify**: `node tests/super-admin-layout-auth.test.mjs` fails against the committed behavior from `9597dcc` due to children rendering without resolved auth.

### Step 2: Gate shell content after auth is resolved

In `frontend/app/(super-admin)/layout.tsx`:

- Keep the current auth provider API; do not change auth initialization.
- While `isLoading`, return only a neutral verification/loading view; do not render navigation, account data, or children.
- After loading, require `isAuthenticated`, a non-null `user`, and `user.is_superuser === true` before returning the shell with children.
- For a resolved unauthenticated user, redirect to `/login` from `useEffect` or use an existing route convention; do not call router navigation during render. While redirecting, show only the neutral denial/loading state.
- For an authenticated non-superuser, preserve the existing access-denied experience and never render children.
- Preserve backend checks and existing theme/accessibility conventions. If the current uncommitted edit conflicts, retain its unrelated intent but do not reproduce side effects during render.

**Verify**: rerun the Node contract test; it exits 0 and confirms that the authorized shell condition encloses `{children}`.

### Step 3: Run frontend gates and inspect scope

Run typecheck, focused lint, and production build. Inspect the final diff against both `HEAD` and the original uncommitted layout diff to confirm no unrelated user edits were lost. Do not run a formatter that rewrites unrelated files.

**Verify**: all three frontend commands exit 0; `git diff --check` is clean; only the layout and new test are attributable to the plan, with pre-existing changes preserved.

## Test plan

- Add one focused static regression test at `frontend/tests/super-admin-layout-auth.test.mjs`, matching the lightweight Node test convention.
- It must prove: children are below the authenticated superuser branch; unresolved auth renders no children; non-admin does not render children; unauthenticated redirect is not invoked during render.
- No backend test is required because backend permissions remain unchanged.

## Done criteria

- [ ] Loading state renders no super-admin shell or route children.
- [ ] Only resolved authenticated superusers render children.
- [ ] Non-superusers retain denial UI; unauthenticated users are redirected outside render.
- [ ] New regression test and TypeScript, lint, build gates pass.
- [ ] No auth provider, backend, dependency, or unrelated route changes.

## STOP conditions

Stop and report if:

- `AuthProvider` cannot reliably establish `isAuthenticated` or `user` after successful token resolution without changing its contract.
- The existing working-tree layout edit belongs to an active task and cannot be safely merged without choosing between user intents.
- The only way to satisfy the gate requires changing backend permissions or session/token architecture.
- The Node regression test becomes brittle enough to depend on exact markup rather than auth control flow.

## Maintenance notes

- The frontend gate is defense-in-depth and UI confidentiality; backend `IsSuperAdmin` remains the security boundary for every API call.
- If the auth provider changes its boot-time refresh semantics, retest both stale/expired and valid-token flows.
- An end-to-end auth test can be added later if the repository adopts a browser test runner; do not add that infrastructure here.
