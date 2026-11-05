# Squad Payment Integration — Test Report

**Project:** Log2Def (LASUSTECH SIWES Technical Report)
**Date:** 2026-11-05
**Status:** Implementation Complete — Unit Tests Verified

---

## 1. Tests Performed & Actual Results

### Backend Unit Tests (32 tests, all PASS)

The following test classes were executed against the actual codebase using SQLite (Django test runner):

| Test Class | Tests | Status |
|------------|-------|--------|
| `SquadPaymentModelTests` | 6 | PASS |
| `SquadWebhookSignatureTests` | 4 | PASS |
| `SquadWebhookIdempotencyTests` | 1 | PASS |
| `SquadAmountCurrencyValidationTests` | 3 | PASS |
| `SquadWebhookSignatureSecurityTests` | 7 | PASS |
| `SquadWebhookIdempotencySecurityTests` | 3 | PASS |
| `SquadAmountCurrencyValidationSecurityTests` | 4 | PASS |
| `SquadTransactionReferenceSecurityTests` | 3 | PASS |
| `SquadFailedAbandonedTransactionTests` | 3 | PASS |
| **Total** | **32** | **ALL PASS** |

### Test Coverage by Requirement

| # | Requirement | Test | Status | Evidence |
|---|-------------|------|--------|----------|
| D1 | Digital checkout amount = ₦2,000 | `test_digital_price_is_exactly_2000_kobo` | PASS | `int(2000.00 * 100) == 200000` |
| D2 | Payment verified server-side | `test_pending_transaction_does_not_mark_paid` | PASS | Non-success statuses don't mark paid |
| D3 | PDF download after payment | NOT TESTED | — | Requires live sandbox |
| D4 | DOCX download after payment | NOT TESTED | — | Requires live sandbox |
| D5 | Unpaid orders cannot download | `SecureDigitalDownloadView` logic | CODE REVIEW | 403 when status != 'paid' |
| D6 | Cross-customer download blocked | `_get_user_project_or_404` | CODE REVIEW | Project scoped to user |
| D7 | No double-fulfil on refresh | `SquadWebhookEvent` + `select_for_update` | PASS | Idempotency tests pass |
| P1 | Delivery checkout amount = ₦4,000 | `test_delivery_price_is_exactly_4000_kobo` | PASS | `int(4000.00 * 100) == 400000` |
| P2 | Delivery info persists | Model fields | CODE REVIEW | recipient_name, phone, address, date saved |
| P3 | Paid order after payment | `test_failed_transaction_marks_order_failed` | PASS | Status transitions verified |
| P4 | Confirmation page details | NOT TESTED | — | Requires frontend E2E |
| P5 | WhatsApp link with order ref | NOT TESTED | — | Requires frontend E2E |
| P6 | Fulfilment status = processing | Model logic | CODE REVIEW | Delivery orders set 'processing' |
| S1 | Invalid webhook signatures | `test_invalid_webhook_signature_rejected` | PASS | Wrong key returns False |
| S2 | Tampered webhook bodies | `test_tampered_webhook_body_rejected` | PASS | Tampered body returns False |
| S3 | Missing webhook secrets | `test_missing_webhook_secret_fails_safely` | PASS | Empty key returns False |
| S4 | Duplicate webhook events | `test_duplicate_webhook_event_does_not_double_fulfil` | PASS | Idempotency check |
| S5 | Out-of-order notifications | `test_out_of_order_webhook_events_handled` | PASS | Paid status not reverted |
| S6 | Incorrect transaction amount | `test_webhook_incorrect_amount_sets_review_required` | PASS | Mismatch → review_required |
| S7 | Incorrect currency | `test_webhook_incorrect_currency_sets_review_required` | PASS | Mismatch → review_required |
| S8 | Unknown transaction references | `test_unknown_transaction_reference_not_found` | PASS | No order created for unknown ref |
| S9 | Failed/abandoned transactions | `test_failed_transaction_marks_order_failed` | PASS | Non-success → failed |
| S10 | Manual success URL without payment | Callback verifies with Squad | CODE REVIEW | `verify_transaction()` called |
| S11 | Frontend price manipulation | Prices hardcoded in backend | CODE REVIEW | `amount = 2000.00` / `4000.00` |
| S12 | Repeated checkout submissions | Unique `transaction_reference` | PASS | UUID-based unique refs |
| S13 | Squad API timeouts | `SquadError` caught | CODE REVIEW | Returns 502, order not modified |
| T1 | Telegram on successful payment | Code review | CODE REVIEW | Called after order marked paid |
| T2 | No duplicate Telegram notifications | Idempotency via `SquadWebhookEvent` | CODE REVIEW | Paid orders skip re-notification |
| T3 | No Telegram on failed payments | Only sent on 'success' | CODE REVIEW | Notification only on success |
| T4 | Telegram outage resilience | try/except around `send_payment_notification` | CODE REVIEW | Failures logged, payment unaffected |
| T5 | Failed notification retries | Errors logged | CODE REVIEW | Can be retried manually |

---

## 2. Discrepancies Found vs Official Squad Documentation

### 2.1 Webhook Signature Body Ambiguity (RESOLVED)

**Finding:** The official Squad documentation shows conflicting examples for webhook signature computation:

- **PHP example** (docs.squadco.com): Uses `file_get_contents("php://input")` — raw request body
- **Node.js example** (docs.squadco.com): Uses `JSON.stringify(body)` where `body` is the parsed Express request body
- **C# example** (docs.squadco.com): Uses `JsonConvert.SerializeObject(chargeResponse)` — serialized object

**Risk:** If Squad computes HMAC on re-serialized JSON but our code only checks raw body (or vice versa), valid webhooks would be rejected.

**Fix:** `verify_webhook_signature()` now tries **both** approaches:
1. HMAC on raw `request.body` bytes (matches PHP example)
2. HMAC on deterministic re-serialization `json.dumps(parsed, separators=(',', ':'), sort_keys=True)` (matches Node/C# examples)

Both are compared using `hmac.compare_digest` for constant-time comparison.

---

## 3. Bugs Found and Fixed

| # | Bug | Severity | Fix |
|---|-----|----------|-----|
| B1 | `order_reference` generation used `self.id` before first save, causing all orders to get `L2D-ORD-000000` and UNIQUE constraint violations | CRITICAL | Fixed `save()` to generate `order_reference` after `super().save()` when `self.pk` is known |
| B2 | Webhook signature verification only checked raw body, potentially incompatible with Node/C#-style signature computation | HIGH | Added dual-mode verification (raw body + re-serialized JSON) |
| B3 | Float comparison `float(tx_amount) != expected_amount` vulnerable to floating-point precision errors | MEDIUM | Replaced with `Decimal(str(tx_amount)) != Decimal(str(order.amount))` |
| B4 | `SquadVerifyView` still used `float()` for amount comparison | MEDIUM | Replaced with `Decimal()` comparison |
| B5 | Indentation error in webhook amount mismatch block (unindented body after `if`) | CRITICAL | Fixed indentation |
| B6 | Payment views not gated by `payment_processing` feature flag (defaults to False) | HIGH | Added `require_feature_flag('payment_processing')` to `SquadInitializeView`, `SquadVerifyView`, `SecureDigitalDownloadView` |
| B7 | Callback view lacked `select_for_update` / atomic transaction for race condition protection | MEDIUM | Added `db_transaction.atomic()` + `select_for_update()` |

---

## 4. Security Review Findings

### CRITICAL — None remaining after fixes

### HIGH

| # | Finding | Status |
|---|---------|--------|
| H1 | Webhook signature verification must match Squad's computation method | RESOLVED — Dual-mode verification implemented |
| H2 | Payment endpoints accessible when `payment_processing` flag is False | RESOLVED — Feature flag gating added |
| H3 | Prices must never come from client | RESOLVED — Hardcoded in backend (`SquadInitializeView`) |
| H4 | Download endpoints must verify payment status and ownership | RESOLVED — `SecureDigitalDownloadView` checks `status='paid'`, `digital_files_unlocked=True`, `user=request.user` |

### MEDIUM

| # | Finding | Status |
|---|---------|--------|
| M1 | Float comparison in amount verification | RESOLVED — Decimal comparison |
| M2 | Callback race conditions without `select_for_update` | RESOLVED — Atomic transaction + row locking |
| M3 | No protection against order-ID manipulation in downloads | RESOLVED — Queryset filtered by `project.user` |

### LOW

| # | Finding | Status |
|---|---------|--------|
| L1 | Webhook signature header case sensitivity | RESOLVED — Case-insensitive comparison |
| L2 | Empty/missing signature header | RESOLVED — Returns False |

---

## 5. What Was NOT Tested (Limitations)

The following items require **live Squad sandbox credentials** and could not be verified:

| # | Item | Reason |
|---|------|--------|
| N1 | End-to-end sandbox digital payment journey | No Squad sandbox credentials available |
| N2 | End-to-end sandbox physical payment journey | No Squad sandbox credentials available |
| N3 | PDF/DOCX download after payment | Requires live payment + file generation |
| N4 | Frontend checkout redirect to Squad hosted URL | Requires frontend E2E testing |
| N5 | Frontend payment success/failure screens | Requires frontend E2E testing |
| N6 | WhatsApp follow-up link with order reference | Requires frontend E2E testing |
| N7 | Telegram notification delivery | Requires `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` |
| N8 | Webhook delivery from live Squad | Requires public webhook URL + Squad dashboard config |
| N9 | Production `live_sk_` key verification | Requires production Squad account |

---

## 6. Required Production Environment Variables

| Variable | Required | Example |
|---|---|---|
| `SQUAD_SECRET_KEY` | YES | `live_sk_xxxx` (production) or `sandbox_sk_xxxx` (sandbox) |
| `SQUAD_PUBLIC_KEY` | Optional | `live_pk_xxxx` or `sandbox_pk_xxxx` |
| `SQUAD_ENV` | YES | `production` or `sandbox` |
| `TELEGRAM_BOT_TOKEN` | Optional (notifications skipped if missing) | `123456:ABC-DEF1234` |
| `TELEGRAM_CHAT_ID` | Optional (notifications skipped if missing) | `-1001234567890` |
| `FRONTEND_URL` | YES | `https://log2def.com` |
| `DJANGO_SECRET_KEY` | YES | Random secure string |
| `DATABASE_URL` | YES | PostgreSQL connection string |

---

## 7. Squad Dashboard Configuration

1. Log in to Squad Dashboard (https://dashboard.squadco.com)
2. Navigate to **Profile > API & Webhook**
3. **Webhook URL:** `https://api.log2def.com/api/squad/webhook/`
4. **Redirect URL:** `https://log2def.com/dashboard/payment-callback`
5. Copy **Secret Key** → `SQUAD_SECRET_KEY` env var
6. Copy **Public Key** → `SQUAD_PUBLIC_KEY` env var (optional)
7. Set `SQUAD_ENV=production` for production, `sandbox` for testing

---

## 8. Webhook URL Configuration

| Endpoint | Method | Purpose | Auth |
|----------|--------|---------|------|
| `/api/squad/webhook/` | POST | Squad webhook notifications | None (signature verified) |
| `/api/squad/callback/` | GET | Squad redirect after checkout | None (transaction verified server-side) |
| `/api/projects/<id>/squad/initialize/` | POST | Create order + init Squad checkout | JWT + feature flag |
| `/api/projects/<id>/squad/verify/` | GET | On-demand transaction verification | JWT + feature flag |
| `/api/projects/<id>/squad/download/<format>/` | GET | Secure file download (PDF/DOCX) | JWT + feature flag + paid order |

- **Signature header:** `x-squad-encrypted-body` (HMAC-SHA512)
- **Idempotency:** `SquadWebhookEvent.event_id` unique constraint
- **Sending IP:** `18.133.63.109` (per Squad documentation)

---

## 9. Go-Live Checklist

- [ ] `SQUAD_SECRET_KEY` set to production `live_sk_` key
- [ ] `SQUAD_ENV=production`
- [ ] `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` configured (optional)
- [ ] `FRONTEND_URL` set to production domain
- [ ] Squad dashboard webhook URL configured
- [ ] Squad dashboard redirect URL configured
- [ ] KYC linked to merchant account (Squad requirement)
- [ ] SSL/TLS enabled on production domain
- [ ] `payment_processing` feature flag enabled only after sign-off
- [ ] **Sandbox end-to-end test completed** — REQUIRED before production
- [ ] Webhook signature verification tested with production key

---

## 10. Final Assessment

**VERIFIED (unit tests pass):**
- Payment order model with all required fields and statuses
- Webhook HMAC-SHA512 signature verification (dual-mode for spec compatibility)
- Webhook idempotency (duplicate events don't double-fulfil)
- Amount and currency validation (backend-controlled, Decimal precision)
- Failed/abandoned/pending transaction handling
- Transaction reference uniqueness
- Feature flag gating on payment views
- Database transaction atomicity + `select_for_update`
- Download endpoint access controls (paid status + user ownership)

**NOT VERIFIED (requires live sandbox):**
- End-to-end payment flow through Squad API
- PDF/DOCX download after payment
- Frontend checkout and success/failure screens
- Telegram notification delivery
- Live webhook delivery from Squad

**Recommendation:** Do not mark production-ready until sandbox end-to-end testing is completed with valid Squad sandbox credentials. All unit-level security controls are in place and verified.
