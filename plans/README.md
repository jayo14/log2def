# Super-Admin Audit Remediation Plans

These plans translate the six findings selected from the 2026-10-28 pre-implementation audit into bounded, testable work. They are implementation handoffs, not evidence that the fixes have been applied. The audit's reference baseline is commit `9597dcc` (2026-10-29 planning snapshot); each plan includes a drift check. Reconcile current code and preserve any pre-existing working-tree changes before implementation.

## Recommended execution order

| Order | Plan | Priority | Effort | Goal | In-scope paths |
|---:|---|---|---|---|---|
| 1 | [004 — Email retry regression tests](004-email-retry-tests.md) | P0 | S | Protect the current retry behavior against fabricated content and false success; tests only, preserving the existing local email-view change. | `backend/super_admin/tests.py` |
| 2 | [002 — Super-admin auth gate](002-super-admin-auth-gate.md) | P1 | S | Render the admin shell and children only after resolved superuser authorization. | `frontend/app/(super-admin)/layout.tsx`; focused frontend test |
| 3 | [003 — Login throttle hardening](003-login-throttle-hardening.md) | P1 | M | Honor the trusted proxy boundary and avoid one shared-IP login bucket locking out unrelated accounts. | `backend/core/throttling.py`; focused auth/throttle tests |
| 4 | [001 — Parent-role membership sync](001-parent-membership-sync.md) | P1 | M | Use valid Role defaults and reconcile a user's primary school membership after role changes. | `backend/accounts/models.py`; focused account tests |
| 5 | [005 — AI usage days validation](005-ai-usage-days-validation.md) | P2 | S | Return a client validation response rather than a 500 for malformed daily usage windows. | `backend/super_admin/views.py`; focused super-admin tests |
| 6 | [006 — Health error metric](006-health-error-metric.md) | P2 | S | Report recent failed email deliveries truthfully without implying a platform-wide error count. | `backend/super_admin/views.py`; focused tests; two health/dashboard labels |

The sequence puts regression coverage for the already-modified P0 retry path first, then the independent P1 security and authorization work, followed by the P2 API/metric corrections. Plans are otherwise independent and may be reordered if release risk or ownership requires it; observe each plan's STOP conditions.

## Scope and safeguards

- Only the six explicitly selected findings are planned here. The index does not reopen audit items already fixed in committed code, unselected findings, or broader authentication/session changes.
- Plans are not authorization to discard existing user changes, stage files, commit, push, deploy, change production data, or add dependencies. Each plan requires explicit approval for any such expansion.
- The email retry plan is intentionally tests-only and must preserve the pre-existing uncommitted change to `backend/super_admin/email_views.py`.
- The auth-gate plan records a pre-existing local edit to `frontend/app/(super-admin)/layout.tsx`; its executor must inspect and preserve that diff.
- Each plan defines the relevant files, tests, verification commands, done criteria, and conditions that require stopping for a decision.

## Plan status

All six plans are prepared; none of the planned implementation work is claimed complete.
