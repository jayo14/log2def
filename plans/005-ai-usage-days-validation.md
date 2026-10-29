# Plan 005: Validate the AI Usage Daily Window

> **Executor instructions**: Add a regression test first and prove it fails against current behavior; then make the narrow validation change. Stop on any condition below. Update the index status when complete.
>
> **Drift check (run first)**: `git diff --stat 9597dcc..HEAD -- backend/super_admin/views.py backend/super_admin/tests.py backend/super_admin/serializers.py` Stop if the `daily` endpoint has changed from the excerpt below.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW — invalid input behavior changes from server error to client validation response
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `9597dcc`, 2026-10-29

## Why this matters

The super-admin AI usage daily endpoint calls `int()` directly on an untrusted query parameter. A non-integer `days` value raises `ValueError` and becomes HTTP 500, creating noisy server errors and an unstable client contract. Validate the parameter at the API boundary and return a clear 400 for malformed or unreasonable windows while preserving the default 30-day behavior.

## Current state

- `backend/super_admin/views.py:574-577`: `AiUsageSummaryView.daily` currently does `days = int(request.query_params.get("days", 30))`, then subtracts that many days.
- The same view's `_filter_qs` parses days defensively in a separate path; prefer a shared validation helper only if it is small and avoids behavior drift.
- `backend/super_admin/urls.py:39` registers the view under `ai/usage-summary`; the action path is `/api/v1/super-admin/ai/usage-summary/daily/`.
- Tests are in `backend/super_admin/tests.py`, with AI usage cases under `SuperAdminAiConfigurationTests` (around line 150 onward); the class fixture creates and authenticates a superuser.
- Backend testing commands are listed in `AGENTS.md` and must be run from `backend/`.

## Commands you will need

Run from `backend/`:

| Purpose | Command | Expected on success |
|---|---|---|
| Focused tests | `DJANGO_DEBUG=true DJANGO_SECRET_KEY=test JWT_SECRET_KEY=test AI_PROVIDER_ENCRYPTION_KEY=0123456789abcdef0123456789abcdef python manage.py test super_admin.tests.SuperAdminAiConfigurationTests --noinput` | Exit 0 |
| Full backend suite | `DJANGO_DEBUG=true DJANGO_SECRET_KEY=test JWT_SECRET_KEY=test AI_PROVIDER_ENCRYPTION_KEY=0123456789abcdef0123456789abcdef python manage.py test --noinput` | Exit 0 |
| Model check | `DJANGO_DEBUG=true DJANGO_SECRET_KEY=test JWT_SECRET_KEY=test AI_PROVIDER_ENCRYPTION_KEY=0123456789abcdef0123456789abcdef python manage.py check` | Exit 0 |

## Scope

**In scope**:
- `backend/super_admin/views.py`
- `backend/super_admin/tests.py`

**Out of scope**:
- Other usage endpoints or frontend filter behavior.
- Database changes, pagination, analytics semantics, or arbitrary maximum-window product choices beyond a reasonable defensive cap.

## Git workflow

- Branch: `fix/phase-<n>-usage-days-validation`; ask rather than invent a phase number if none is specified.
- Do not commit or push unless the operator instructs it.

## Steps

### Step 1: Add boundary tests

In `SuperAdminAiConfigurationTests`, add API tests to the daily action for:

- `days=abc` and `days=1.5` returning HTTP 400, not 500.
- Missing `days` preserving the 30-day default.
- A valid positive integer returning HTTP 200 and only records in the requested time window.
- Zero/negative and excessively large windows returning a deliberate 400 if the implementation adopts bounds. Select a finite maximum (e.g. one year) only if consistent with adjacent API contracts; otherwise do not add an arbitrary cap.

Use existing model fixtures/method patterns. First run the malformed-value tests against existing behavior and confirm the `abc` case fails with an internal error.

**Verify**: focused test run reproduces the current malformed-input failure before the implementation step.

### Step 2: Validate and apply the range

At the boundary of `daily`, validate that `days` is a base-10 positive integer; return DRF `ValidationError` with a stable field-level message for invalid values. Preserve the default of 30 when absent. Reject zero and negative values. If a maximum is added, document the bound in the endpoint error message and tests. Do not silently replace malformed input with 30, as that hides client errors.

**Verify**: malformed/valid tests pass; invalid queries return 400 and valid window queries return 200.

### Step 3: Run backend gates

Run the focused test class, full backend test suite, and `manage.py check`; inspect `git diff --check` and changed paths.

**Verify**: all commands exit 0, diff check clean, and only the two in-scope paths are changed.

## Test plan

- Add malformed, fractional, missing/default, valid, non-positive, and (if implemented) over-maximum cases to `SuperAdminAiConfigurationTests`.
- Follow the existing APIClient and superuser setup in that class; assert status codes and response shape, not Django exception internals.

## Done criteria

- [ ] Malformed `days` never raises an uncaught exception.
- [ ] Invalid ranges return HTTP 400 with a useful validation error.
- [ ] Default remains 30 days; valid positive integer still filters the series.
- [ ] Focused/full backend tests and system check pass.
- [ ] No unrelated API behavior changes.

## STOP conditions

Stop and report if:

- The UI depends on malformed values being silently treated as all-time or another implicit range.
- `daily` semantics are changed elsewhere and this plan's assumption is stale.
- A safe maximum depends on product policy; omit the maximum and report the decision needed rather than inventing one.
- Any required change touches frontend files or a schema migration.

## Maintenance notes

- The AI usage frontend should pass and label time windows consistently; that work is separate from server input validation.
- Keep the daily series date cutoff and `_filter_qs` date behavior aligned if shared parsing logic is extracted.
