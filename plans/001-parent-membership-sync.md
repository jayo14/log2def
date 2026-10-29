# Plan 001: Keep Role Capabilities and School Memberships Synchronized

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving on. If a "STOP condition" occurs, stop and report; do not improvise. Update this plan's status row in `plans/README.md` when complete.
>
> **Drift check (run first)**: `git diff --stat 9597dcc..HEAD -- backend/accounts/models.py backend/accounts/tests_owner_and_permissions.py backend/accounts/tests.py` If any in-scope file changed since this plan was written, compare the current-state excerpts below with live code; on mismatch, stop and report.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED — role synchronization controls school permissions and may affect existing memberships
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `9597dcc`, 2026-10-29

## Why this matters

Creating a parent user with an attached school currently attempts to create a `Role` with two capability names that do not exist on `Role`, causing a `TypeError` and aborting user creation. Separately, changing a user's role or school does not reliably update an already linked membership's role, leaving permissions stale. This plan makes role defaults valid and makes the user's primary school membership converge to the current user role without modifying unrelated memberships.

## Current state

- `backend/accounts/models.py` defines `User._sync_school_membership` and is the only code this plan changes for behavior.
- `backend/accounts/models.py:138-200` currently builds `role_caps`; the `parent` entry contains `can_view_child_reports` and `can_view_child_fees`, neither present on `Role` (`models.py:317-332`). Those similarly named capabilities belong to the legacy `User` capability map around lines 273-275.
- The method calls `Role.objects.get_or_create(slug=role_slug, school=self.school, defaults=defaults)` and then creates a membership only if none exists; an existing membership is only updated when `role_id` is empty (`models.py:183-200`).
- `User.save` calls synchronization only when `update_fields` is absent or contains `role` or `school` (`models.py:132-136`). This is the intended hook; preserve it unless a test proves it inadequate.
- Test conventions: `backend/accounts/tests_owner_and_permissions.py` uses Django `TestCase`, `User.objects.create_user`, and assertions against `SchoolMembership`; see `UserEntityModelAndRoleTests.test_save_auto_syncs_school_membership_for_owner` around lines 81-93.
- Project invariant from `AGENTS.md`: tenant isolation is a hard boundary and IDs from another school must behave as 404. This plan does not change access/query scoping.

## Commands you will need

Run from `backend/` with the local Python environment and test settings in `AGENTS.md`:

| Purpose | Command | Expected on success |
|---|---|---|
| Focused tests | `DJANGO_DEBUG=true DJANGO_SECRET_KEY=test JWT_SECRET_KEY=test AI_PROVIDER_ENCRYPTION_KEY=0123456789abcdef0123456789abcdef python manage.py test accounts.tests_owner_and_permissions.UserEntityModelAndRoleTests --noinput` | Exit 0; all tests in the class pass |
| Full backend tests | `DJANGO_DEBUG=true DJANGO_SECRET_KEY=test JWT_SECRET_KEY=test AI_PROVIDER_ENCRYPTION_KEY=0123456789abcdef0123456789abcdef python manage.py test --noinput` | Exit 0; full suite passes |
| Model consistency | `DJANGO_DEBUG=true DJANGO_SECRET_KEY=test JWT_SECRET_KEY=test AI_PROVIDER_ENCRYPTION_KEY=0123456789abcdef0123456789abcdef python manage.py makemigrations --check --dry-run` | Exit 0; no model changes detected |

The focused command assumes the project's standard test environment is available; use its established backend venv if needed. Do not install packages as part of this plan.

## Scope

**In scope**:
- `backend/accounts/models.py`
- `backend/accounts/tests_owner_and_permissions.py`

**Out of scope**:
- `Role` schema or migrations; do not add the parent-only capabilities to the Role model without a separate product/security decision.
- School tenant queryset permissions, super-admin controls, frontend, throttle, or unrelated account flows.
- Backfilling historical memberships or migrating user.school semantics.

## Git workflow

- Branch: `fix/phase-<n>-parent-role-sync` per `AGENTS.md`'s phase naming convention; confirm phase number with the operator if unknown rather than guessing.
- Keep the change small and test-first; use an imperative one-line commit subject only if the operator separately asks for a commit.
- Do not commit, push, or open a PR unless instructed.

## Steps

### Step 1: Add regressions for parent creation and role/school changes

In `backend/accounts/tests_owner_and_permissions.py`, add tests next to `test_save_auto_syncs_school_membership_for_owner`:

1. Creating a parent `User` with a school succeeds and produces a primary membership whose role is the school-specific `parent` role. Assert the resulting role has only schema-supported capability fields; do not assert nonexistent Role fields.
2. Changing an existing user's role from `teacher` to `parent` with `save(update_fields=["role"])` updates the existing membership's role to the school-specific parent role.
3. Changing the user's school updates the user's own primary membership to the new school/role while preserving memberships at any other school. If current domain rules do not support preserving other-school memberships after changing the legacy singular `user.school`, stop and ask for a decision rather than deleting them.
4. Changing role to `admin` (which clears school/synchronization by existing model rules) does not create a school membership with stale privileges.

Run the focused class command; the parent creation regression must fail on the current `TypeError` before any implementation change.

**Verify**: focused class command returns a failure for the new parent-role test before the fix, specifically attributable to invalid Role defaults or stale membership behavior.

### Step 2: Use only actual Role fields and reconcile the intended membership

Update `User._sync_school_membership` in `backend/accounts/models.py`:

- Remove capability defaults not defined by `Role`; parent capability decisions should continue to be represented by the existing legacy capability map unless the product separately adds real Role fields.
- Ensure role lookup uses the current `role_slug` and current `self.school`.
- For the membership at `self.school`, update its role to the resolved role whenever the role is stale, and ensure the correct primary flag without blindly changing unrelated school memberships.
- Preserve owner/teacher/student default role grants that are already supported by Role fields.
- Treat role/school transitions with care: do not delete other memberships, and avoid overwriting a school-specific custom Role's capability values merely because a user record is saved.

Rerun the focused tests and require all new parent/transition assertions to pass.

**Verify**: focused class command exits 0.

### Step 3: Run account-wide and repository gates

Run the full backend suite and `makemigrations --check --dry-run`. Inspect `git diff --check` and `git status --short`; only the two in-scope files may be changed by this plan.

**Verify**: both backend commands exit 0; `git diff --check` has no output; `git status --short` contains only allowed paths (pre-existing unrelated user changes may remain untouched and must not be attributed to this plan).

## Test plan

- Add the parent-creation regression, role-change membership reconciliation, school-change preservation, and admin transition cases in `backend/accounts/tests_owner_and_permissions.py`, following `UserEntityModelAndRoleTests` conventions.
- The required red/green proof is the new parent test failing before the code change and passing after it.
- Existing account tests must remain green through the full backend suite.

## Done criteria

- [ ] A parent account with a school can be saved without a `TypeError`.
- [ ] Membership role follows a changed User role for the same school.
- [ ] Changing legacy `User.school` does not delete unrelated memberships.
- [ ] No nonexistent capability is passed to `Role.objects.get_or_create`.
- [ ] Focused class, full backend suite, `makemigrations --check --dry-run`, and `git diff --check` pass.
- [ ] No out-of-scope files are changed; update the plan status row in `plans/README.md`.

## STOP conditions

Stop and report rather than improvising if:

- Parent capabilities are found to have been intentionally added to a different Role schema or migration after the planned commit.
- The actual membership policy requires removing or demoting memberships outside the legacy `User.school` school.
- Any regression fix requires a schema migration, a cross-app permission behavior change, or touching files outside the in-scope list.
- A verification failure is unrelated to this plan or cannot be explained after one focused investigation.

## Maintenance notes

- Future role-capability additions should use fields that actually exist on `Role`; tests should keep parent defaults covered.
- The model signal is a compatibility synchronization path between legacy `User.role`/`User.school` and the membership source of truth. Keep behavior consistent with `SchoolMembership` creation flows and avoid treating the legacy FK as the complete membership set.
- This plan deliberately does not decide whether users can have multiple schools while retaining a single legacy school field.
