# Plan 004: Prove Email Retry Uses Archived Content and Confirmed Send Results

> **Executor instructions**: This plan covers tests for existing local retry changes, not a rewrite of those changes. Preserve the uncommitted diff. Add tests first, run them against the current code, and update the plan status in `plans/README.md` when complete.
>
> **Drift check (run first)**: `git diff --stat 9597dcc..HEAD -- backend/super_admin/email_views.py backend/super_admin/tests.py backend/core/email.py` The retry implementation in `backend/super_admin/email_views.py` is already modified in the working tree; inspect and retain that user diff. If another change has replaced it, stop and reconcile.

## Status

- **Priority**: P0
- **Effort**: S
- **Risk**: LOW — tests only; mocks must match Django's email sender return contract
- **Depends on**: none
- **Category**: tests
- **Planned at**: commit `9597dcc`, 2026-10-29

## Why this matters

Email retries can send real messages containing sensitive student and financial data. The current uncommitted patch now refuses retries without archived rendered HTML and updates `sent` only when the mail backend returns a positive send count; these are critical behavior changes without regression coverage. Focused tests should prove no invented preview data is sent, backend rejection/exception never returns success, and a positive backend send count is the only success path.

## Current state

- `backend/super_admin/email_views.py:850-951` contains the current uncommitted `SuperAdminEmailDetailView.post` retry implementation. It reads `metadata.rendered_html`, returns HTTP 409 when absent, calls `EmailService.send_message_obj`, and sets `status="sent"` only if the returned sent count is truthy.
- `backend/super_admin/email_views.py:416-460` defines `SAMPLE_PREVIEW_CONTEXT`; it remains valid for preview/test-send paths, but must never become retry content.
- `backend/core/email.py:61-110` defines `EmailService.send_message_obj` as returning `(sent_count, message)` and raising if delivery paths fail.
- `backend/communications/models.py:147-185` defines `EmailDeliveryLog` including status, retry_count, error_message, sent_at, and metadata.
- `backend/super_admin/tests.py:15-110` contains `SuperAdminEmailCenterTests`, an authenticated super-admin client fixture and existing log setup. Extend this class.
- Current pre-existing test log metadata lacks `rendered_html`, making it a useful fixture for the no-archived-body case.

## Commands you will need

Run from `backend/`:

| Purpose | Command | Expected on success |
|---|---|---|
| Focused email tests | `DJANGO_DEBUG=true DJANGO_SECRET_KEY=test JWT_SECRET_KEY=test AI_PROVIDER_ENCRYPTION_KEY=0123456789abcdef0123456789abcdef python manage.py test super_admin.tests.SuperAdminEmailCenterTests --noinput` | Exit 0; all email center tests pass |
| Full backend suite | `DJANGO_DEBUG=true DJANGO_SECRET_KEY=test JWT_SECRET_KEY=test AI_PROVIDER_ENCRYPTION_KEY=0123456789abcdef0123456789abcdef python manage.py test --noinput` | Exit 0 |
| Diff hygiene | `git diff --check` | Exit 0 with no output |

No email provider call may be made during tests; mock `EmailService.send_message_obj` or use Django's in-memory backend.

## Scope

**In scope**:
- `backend/super_admin/tests.py`

**Out of scope**:
- Rewriting or reverting existing changes in `backend/super_admin/email_views.py`.
- Changes to retry semantics, email queue architecture, templates, provider settings, audit model, or migrations.
- Sending real email or changing project `.env` files.

## Git workflow

- Branch: `fix/phase-<n>-email-retry-tests` per `AGENTS.md`; do not guess an unknown phase.
- Do not commit/push unless explicitly asked. Preserve unrelated user changes.

## Steps

### Step 1: Add a no-archived-body regression

Add a test in `SuperAdminEmailCenterTests` which sets the superuser as the authenticated caller, uses the existing log row with no `rendered_html`, patches `EmailService.send_message_obj`, POSTs `{"action":"retry"}` to `reverse("superadmin-emails-detail", kwargs={"log_id": str(log.id)})`, and asserts:

- HTTP 409 and a failure message.
- The mock is not called.
- `retry_count` and status remain unchanged.
- No fabricated sample values/body are inserted into metadata or sent.

Run the focused suite and demonstrate this test fails before the test-only change is considered complete if the working-tree implementation regressed to the old behavior. With the current patch, this test is expected to pass immediately; therefore characterize it against `HEAD` in an isolated read-only comparison if practical, or report clearly that this is a test for existing working-tree behavior and cannot demonstrate a red run without discarding user changes. Never reset or edit the user patch to manufacture a failing test.

**Verify**: focused suite passes; the send mock remains uncalled.

### Step 2: Cover backend exception and zero-send result

Create an archived-body fixture by updating the log metadata with a unique harmless HTML string and body text. Add two tests:

1. Mock `send_message_obj` to raise a controlled exception; assert a non-2xx response, no success text, `status="failed"`, and a non-success audit row with the authenticated actor. Do not assert or expose provider exception details in the API response.
2. Mock `(0, message)`; assert failure response and stored failed status.

Do not introduce a mock that returns raw secrets or assert internal exception content to the client.

**Verify**: each test passes and response never claims `sent`.

### Step 3: Cover positive send count and exact archived body

Mock `send_message_obj` to return `(1, message)`. Assert exact HTML archived content, stored recipient, subject, and body passed to the sender; verify `status="sent"`, `sent_at` populated, retry count increments once, response reports success, and an `email.retry` AuditLog records the actor and `outcome="sent"`.

**Verify**: focused suite passes and asserts exact sender kwargs.

### Step 4: Run all backend tests and preserve scope

Run full backend tests and `git diff --check`. Review `git diff -- backend/super_admin/email_views.py` before and after to verify this plan did not modify the pre-existing implementation. Only the tests file may be changed by this plan; do not stage or commit anything.

**Verify**: all test commands pass; existing email view diff remains intact; only `backend/super_admin/tests.py` is newly modified by this plan.

## Test plan

- Extend `SuperAdminEmailCenterTests` with missing archived HTML, provider exception, zero send count, and successful send count cases.
- Mock at `super_admin.email_views.EmailService.send_message_obj` and assert no actual provider/network call occurs.
- Keep current tests for cancel, detail inspection, and template preview green.

## Done criteria

- [ ] No-context retry is 409 and does not call the sender or mutate retry status/count.
- [ ] Exception and zero-send paths never report success and persist failed status.
- [ ] Positive send count sends only archived HTML and confirms status/audit actor.
- [ ] Focused and full backend suites pass; diff check clean.
- [ ] No existing email implementation diff is altered or discarded.

## STOP conditions

Stop and report if:

- The current retry patch is changed before work begins; do not adapt by dropping the test or overwriting its author’s change.
- The current email sender contract no longer returns `(count, message)`.
- An email retry test would send externally or requires real provider credentials.
- Tests reveal that archived HTML contains template placeholders rather than the rendered original; report this data-contract issue instead of inventing context or silently rendering sample values.

## Maintenance notes

- The preview context is permitted for preview-only UI; code review should preserve a strict boundary between preview/test-send and a production retry.
- Provider acceptance is not proof of final inbox delivery. The API/UI may call this a successful submission only according to the project’s intended provider acceptance contract; do not imply inbox receipt.
- `EmailDeliveryLog.metadata` can contain message PII. Tests should use synthetic minimal bodies and avoid adding sensitive fixture data.
