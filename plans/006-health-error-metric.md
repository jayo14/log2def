# Plan 006: Make the Recent Error Health Metric Truthful

> **Executor instructions**: Keep the change narrowly scoped to defining and reporting the existing `recent_errors_24h` health signal. Add endpoint tests first. Stop if a broader error-event source is required. Update this plan's status in `plans/README.md` when complete.
>
> **Drift check (run first)**: `git diff --stat 9597dcc..HEAD -- backend/super_admin/views.py backend/super_admin/tests.py backend/communications/models.py 'frontend/app/(super-admin)/super-admin/health/page.tsx' 'frontend/app/(super-admin)/super-admin/page.tsx'` Stop if endpoint/field semantics have changed.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW — query semantics and UI wording change, but the metric is currently structurally unable to count
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `9597dcc`, 2026-10-29

## Why this matters

The health endpoint reports `recent_errors_24h` by counting `AuditLog.action` values containing `"fail"`, but the audit action choices have no such values and the known writers do not emit error actions. The value is therefore misleadingly fixed at zero, while the health UI calls it recorded errors. The existing `EmailDeliveryLog` provides a concrete persisted source for email delivery failures, so the smallest truthful scope is to count failed deliveries over the last 24 hours and explicitly label the UI as delivery failures rather than platform-wide failures.

## Current state

- `backend/super_admin/views.py:626-629`: `SystemHealthView.status` queries `AuditLog.action__contains="fail"` in the last 24 hours.
- `backend/super_admin/models.py:22-41`: `AuditLog.ACTION_CHOICES` includes school/user/role/AI/email mutation actions but no failure action.
- `backend/communications/models.py:147-193`: `EmailDeliveryLog` has `status` with a `failed` choice, plus `created_at` from `TimestampedModel`; the model also has `sent_at`.
- `frontend/app/(super-admin)/super-admin/health/page.tsx:49-54` labels this field “Recorded errors” / “Error-related audit actions”; the dashboard `super-admin/page.tsx` also labels it as “Recorded errors.”
- `backend/super_admin/tests.py` has no health endpoint test currently. URL route is registered by `detail_router` in `backend/super_admin/urls.py:40`; the action route is under `/api/v1/super-admin/health/status/`.
- Product intent in `docs/super-admin-dashboard-ux-strategy.md`: status must describe live or stored data and never imply a subsystem is healthy merely because a page exists.

## Commands you will need

Run from `backend/`:

| Purpose | Command | Expected on success |
|---|---|---|
| Focused tests | `DJANGO_DEBUG=true DJANGO_SECRET_KEY=test JWT_SECRET_KEY=test AI_PROVIDER_ENCRYPTION_KEY=0123456789abcdef0123456789abcdef python manage.py test super_admin.tests.SuperAdminHealthMetricTests --noinput` | Exit 0 |
| Full backend tests | `DJANGO_DEBUG=true DJANGO_SECRET_KEY=test JWT_SECRET_KEY=test AI_PROVIDER_ENCRYPTION_KEY=0123456789abcdef0123456789abcdef python manage.py test --noinput` | Exit 0 |
| Backend check | `DJANGO_DEBUG=true DJANGO_SECRET_KEY=test JWT_SECRET_KEY=test AI_PROVIDER_ENCRYPTION_KEY=0123456789abcdef0123456789abcdef python manage.py check` | Exit 0 |

Run from `frontend/` for UI wording:

| Purpose | Command | Expected on success |
|---|---|---|
| Typecheck | `npx tsc --noEmit` | Exit 0 |
| Focused lint | `npx eslint 'app/(super-admin)/super-admin/health/page.tsx' 'app/(super-admin)/super-admin/page.tsx'` | Exit 0 |

## Scope

**In scope**:
- `backend/super_admin/views.py`
- `backend/super_admin/tests.py`
- `frontend/app/(super-admin)/super-admin/health/page.tsx`
- `frontend/app/(super-admin)/super-admin/page.tsx`

**Out of scope**:
- Adding global exception tracking, login failure logs, Sentry/monitoring dependencies, or new database tables.
- Renaming the response field `recent_errors_24h` (client compatibility); keep it as the count of recent failed email deliveries and document that contract.
- Changes to email retry behavior or `AuditLog` schema.

## Git workflow

- Branch: `fix/phase-<n>-health-error-metric`; ask for the phase number when not explicit.
- Do not commit/push unless instructed.

## Steps

### Step 1: Add API-level regression tests

Create `SuperAdminHealthMetricTests` in `backend/super_admin/tests.py`. Create/authenticate a superuser and call `/api/v1/super-admin/health/status/`. Add failed, sent, and queued email logs with controlled `created_at` values; assert only failed deliveries created within the last 24 hours contribute. Also assert old failures and non-failed statuses do not count. Add an unauthenticated/non-superuser denial check if it fits the class without duplicating existing common coverage.

Run the focused test against the old audit-action implementation; verify it fails when the failed delivery is present but `recent_errors_24h` remains zero.

**Verify**: focused test reproduces the mismatch before implementation.

### Step 2: Query failed delivery logs and correct copy

In `SystemHealthView.status`, use `EmailDeliveryLog.objects.filter(status="failed", created_at__gte=timezone.now() - timedelta(hours=24)).count()` (import the model at module top or follow existing local import conventions). Keep the response field name stable. Change both health page and dashboard copy to “Failed email deliveries” and describe the 24-hour stored delivery-log window; do not imply it represents all platform errors.

**Verify**: endpoint returns the expected count for in-window failed deliveries; TypeScript and focused lint pass.

### Step 3: Run backend and frontend gates

Run the focused and full backend tests, backend system check, frontend typecheck, and focused lint. Inspect `git diff --check`; only listed paths should be touched.

**Verify**: all commands exit 0; UI labels match the metric's actual scope.

## Test plan

- Add endpoint tests for count inclusion/exclusion by status and 24-hour cutoff.
- Reuse the `EmailDeliveryLog` fields from `backend/communications/models.py` and existing super-admin APIClient test conventions.
- No database migration is expected; if Django detects one, stop and investigate rather than commit a generated migration.

## Done criteria

- [ ] In-window failed email deliveries are counted.
- [ ] Old failures and sent/queued/suppressed rows are excluded.
- [ ] Field response name is unchanged; UI accurately labels it as email delivery failures.
- [ ] Backend tests/check and frontend typecheck/lint pass.
- [ ] No monitoring dependency, schema, or unrelated health changes.

## STOP conditions

Stop and report if:

- `EmailDeliveryLog.created_at` is not a trustworthy failure timestamp for retry updates; determine whether `updated_at` or a dedicated failure timestamp is appropriate before proceeding.
- The product requirement is platform-wide failures rather than email delivery failures; that needs an identified persisted source and likely a separate design.
- The health metric has been repurposed by frontend/client code after the planned commit.
- Any schema migration or external monitoring provider becomes necessary.

## Maintenance notes

- This metric is intentionally narrow: failed email delivery logs, not all platform exceptions or failed user logins.
- If a future error-event store is introduced, migrate the metric and UI wording together, preserving or versioning the response contract deliberately.
- Recent retries update the same log row; this count uses the row's creation timestamp. If operations need failure-time rather than original-message-time counts, add an explicit timestamp in a separate migration plan.
