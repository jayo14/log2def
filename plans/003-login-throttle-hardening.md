# Plan 003: Harden Login Throttling Against Spoofed Forwarding Headers

> **Executor instructions**: Implement only the bounded throttle changes below. Add regression tests first and demonstrate them failing before editing implementation. Stop on any condition listed below. Update the status row in `plans/README.md` when complete.
>
> **Drift check (run first)**: `git diff --stat 9597dcc..HEAD -- backend/core/throttling.py backend/core/settings.py backend/accounts/auth.py backend/accounts/tests.py backend/core/tests.py` If relevant files differ from current excerpts, stop and report.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED — throttling is shared by login and password reset; proxy hop interpretation and cache key behavior affect availability
- **Depends on**: none
- **Category**: security
- **Planned at**: commit `9597dcc`, 2026-10-29

## Why this matters

`LoginRateThrottle` currently trusts the first value of `X-Forwarded-For`, which the application may receive from an untrusted client, while settings already define DRF's trusted proxy count. A caller can therefore rotate a spoofed first address to bypass a five-attempt-per-minute limit. The same IP-only throttle also counts successful requests and is shared by login, forgot-password, and reset-password views, which can lock out unrelated users behind a shared NAT. The implementation should honor the configured proxy trust boundary and add account-scoped limiting without disclosing which accounts exist.

## Current state

- `backend/core/throttling.py:18-60`: `AttemptRateThrottle` builds a cache key from `scope` and `md5(scope + _get_client_ip(request))`; `_get_client_ip` returns the first XFF value if present, otherwise `REMOTE_ADDR`; `allow_request` increments before the view runs, so successful requests count.
- `backend/accounts/auth.py:64-74`: `LoginView` uses `LoginRateThrottle`; `ForgotPasswordView` and `ResetPasswordView` also use it around lines 250-299.
- `backend/core/settings.py:259`: `REST_FRAMEWORK.NUM_PROXIES` already comes from `TRUSTED_PROXY_COUNT`, default 1. Do not invent a second proxy-count environment setting.
- No deployment topology is verified here. The executor must preserve secure behavior for the configured count and document the operator requirement that Django must only receive forwarded headers from the trusted proxy chain.
- Tests convention: Django tests use `TestCase`/`APITestCase` under `backend/accounts/tests.py`, `backend/schools/tests.py`, and `backend/super_admin/tests.py`. Throttle-specific registration tests live in `backend/schools/tests.py:151-190`.
- Backend test commands and env requirements are in root `AGENTS.md`; use the backend venv and run from `backend/`.

## Commands you will need

Run from `backend/`:

| Purpose | Command | Expected on success |
|---|---|---|
| Focused tests | `DJANGO_DEBUG=true DJANGO_SECRET_KEY=test JWT_SECRET_KEY=test AI_PROVIDER_ENCRYPTION_KEY=0123456789abcdef0123456789abcdef python manage.py test core.tests accounts.tests --noinput` | Exit 0; all named tests pass |
| Full backend tests | `DJANGO_DEBUG=true DJANGO_SECRET_KEY=test JWT_SECRET_KEY=test AI_PROVIDER_ENCRYPTION_KEY=0123456789abcdef0123456789abcdef python manage.py test --noinput` | Exit 0 |
| System check | `DJANGO_DEBUG=true DJANGO_SECRET_KEY=test JWT_SECRET_KEY=test AI_PROVIDER_ENCRYPTION_KEY=0123456789abcdef0123456789abcdef python manage.py check` | Exit 0; no issues |

Do not install dependencies or run a live proxy as part of this plan.

## Scope

**In scope**:
- `backend/core/throttling.py`
- `backend/accounts/tests.py` or `backend/core/tests.py` (choose the closest existing class; do not add duplicate fixture scaffolding)
- `backend/accounts/auth.py` only if required to pass the normalized login identifier into a throttle hook

**Out of scope**:
- Global DRF throttles, registration throttle, password reset behavior, reverse-proxy deployment configuration, credential-stuffing vendor integration, MFA, and other auth changes.
- Database-backed throttle infrastructure or schema migrations.

## Git workflow

- Branch: `fix/phase-<n>-login-throttle` per `AGENTS.md`; ask rather than guess phase number if absent.
- Do not commit/push unless explicitly asked.

## Steps

### Step 1: Characterize proxy parsing and throttle behavior

Add tests before implementation for:

1. With `NUM_PROXIES=1`, a request with a multi-hop XFF chain derives the client address using the trusted right-side hop count, not blindly the first element.
2. With no XFF, use `REMOTE_ADDR`.
3. A spoofed/unusable XFF value cannot override the remote address when no trusted proxy is configured; malformed address chains fail closed to a safe remote identity instead of raising.
4. Account identifier affects the login bucket, normalized case/whitespace doesn't create inconsistent buckets, and IP remains part of the key to retain per-network protection.
5. The endpoint's intended policy for successful login attempts is explicit. If keeping a success-independent throttle requires post-response accounting beyond `AttemptRateThrottle`'s `allow_request`, STOP and propose the smallest safe design before implementing; do not silently weaken protections. At minimum, different accounts must not share a single IP-only lockout bucket.

Run focused tests and confirm the proxy parsing/key tests fail against current code.

**Verify**: focused test command fails only on the new expectations before changes.

### Step 2: Resolve the trusted client address and account-aware identity

Implement a helper in `AttemptRateThrottle` that reads DRF `NUM_PROXIES`, parses XFF from the right according to the configured trusted hop count, validates IP literals using Python's standard `ipaddress` module, and uses `REMOTE_ADDR` as a fallback when no trustworthy chain exists. Ensure the algorithm has explicit behavior for zero proxies and too-short/malformed chains; never trust arbitrary left-most user-supplied data.

For login, derive a normalized account identifier (email/username from the request body) and combine it with the resolved IP and throttle scope in a stable one-way cache identifier. Do not store raw email in cache keys. The forgot/reset endpoints may have different request identifiers; retain an IP-level control for them rather than assuming a login credential field exists.

Retain atomic/race semantics where possible. The existing get-list/set-list implementation can lose increments under concurrent requests; if fixing atomicity expands scope materially, document it as deferred rather than adding an unreviewed cache primitive.

**Verify**: all new proxy/key tests pass; tests demonstrate changing a spoofed XFF prefix does not bypass a bucket for the same trusted client and account.

### Step 3: Define and test success/failure accounting

The current throttle is invoked before credential validation, so it counts successful logins. Implement failure-only accounting only if it can be done without changing generic DRF semantics or introducing a custom auth response contract. If that is not a small safe extension, keep a conservative per-account-plus-IP bucket for all attempts and explicitly defer failure-only counting; the plan's minimum availability requirement is that one user cannot exhaust another user's bucket behind the same NAT.

Ensure the shared use by forgot/reset remains bounded and does not leak account existence through response status/body.

**Verify**: endpoint tests prove independent users behind a shared IP have independent account buckets; generic forgot-password responses remain generic.

### Step 4: Run full backend gates

Run focused and full backend test commands and `manage.py check`. Review `git diff --check` and ensure no proxy deployment values, secrets, or raw email values are persisted in throttle identifiers.

**Verify**: all three commands exit 0 and only in-scope paths change.

## Test plan

- Cover trusted right-edge proxy parsing for configured hop counts, zero proxies, missing/malformed XFF, and fallback to remote address.
- Cover cache-key separation across different account identifiers and stability for normalized identifiers without including plaintext identifiers.
- Cover shared-NAT login attempts and ensure one account does not consume another's bucket.
- Cover generic password-reset response semantics if throttle behavior is refactored.
- Follow existing Django throttle testing in `backend/schools/tests.py` and standard `APIClient` patterns.

## Done criteria

- [ ] No code path blindly takes the first XFF entry.
- [ ] Proxy interpretation uses existing `REST_FRAMEWORK.NUM_PROXIES` configuration.
- [ ] Login cache identity incorporates both client address and normalized account identity without persisting raw email.
- [ ] Shared-IP traffic for different login identities cannot exhaust one common identity bucket.
- [ ] New tests fail before and pass after the change; full test suite and system check pass.
- [ ] Behavior for successful login attempts is explicitly documented in tests/comment or deferred with explanation.

## STOP conditions

Stop and report if:

- The actual proxy topology cannot be represented by `NUM_PROXIES` or Django sees direct untrusted clients that invalidate the presumed chain.
- Correct handling requires a production proxy configuration change not covered by this plan.
- Failure-only accounting would require adding persistent state or changing authentication response flow.
- A malformed XFF request needs a policy decision beyond safe fallback to `REMOTE_ADDR`.

## Maintenance notes

- `TRUSTED_PROXY_COUNT` is security-sensitive deployment configuration. Any change to edge proxy count should update deployment docs and test expectations.
- The throttle's generic use by password-reset endpoints must remain anti-enumerating.
- Consider cache atomicity and distributed-cache semantics separately if traffic volumes make lost increments consequential.
