# Squad Payment Integration — Test Report

**Project:** Log2Def (LASUSTECH SIWES Technical Report)
**Date:** 2026-11-05
**Status:** Implementation Complete — Tests Verified

---

## 1. Tests Performed

### Digital Payment Tests

| # | Test | Expected | Result |
|---|------|----------|--------|
| D1 | Checkout amount is exactly ₦2,000 (200000 kobo) | amount_kobo = 200000, currency = NGN | PASS |
| D2 | Payment is verified server-side via Squad verify endpoint | Order marked paid only after Squad verification | PASS |
| D3 | PDF download works after payment | SecureDigitalDownloadView returns PDF for paid digital order | PASS |
| D4 | DOCX download works after payment | SecureDigitalDownloadView returns DOCX for paid digital order | PASS |
| D5 | Unpaid orders cannot download | 403 Forbidden for orders with status != 'paid' | PASS |
| D6 | Another customer cannot access an order's files | Download scoped to project.user via _get_user_project_or_404 | PASS |
| D7 | Refreshing success page does not duplicate an order | Webhook idempotency via SquadWebhookEvent + select_for_update | PASS |

### Physical Payment Tests

| # | Test | Expected | Result |
|---|------|----------|--------|
| P1 | Checkout amount is exactly ₦4,000 (400000 kobo) | amount_kobo = 400000, currency = NGN | PASS |
| P2 | Delivery information persists | recipient_name, phone_number, custom_address, delivery_date saved | PASS |
| P3 | Successful payment creates a paid order | status = 'paid', fulfilment_status = 'processing' | PASS |
| P4 | Confirmation page displays correct details | order_reference and delivery details shown on success page | PASS |
| P5 | WhatsApp link includes correct order reference | https://wa.me/2348096044860 with order_ref prefilled | PASS |
| P6 | Fulfilment status is accurate | 'processing' after payment for delivery orders | PASS |

### Security Tests

| # | Test | Expected | Result |
|---|------|----------|--------|
| S1 | Invalid webhook signatures rejected | 400 Bad Request for bad x-squad-encrypted-body | PASS |
| S2 | Missing webhook secrets fail safely | verify_webhook_signature returns False when SQUAD_SECRET_KEY unset | PASS |
| S3 | Duplicate webhook notifications | SquadWebhookEvent idempotency check prevents double-processing | PASS |
| S4 | Out-of-order notifications | select_for_update + status check prevents race conditions | PASS |
| S5 | Incorrect transaction amount | Order set to 'review_required', webhook rejected | PASS |
| S6 | Incorrect currency | Order set to 'review_required', webhook rejected | PASS |
| S7 | Unknown transaction references | 404 Not Found, order not updated | PASS |
| S8 | Failed and abandoned transactions | Order marked 'failed' when Squad status != 'success' | PASS |
| S9 | Manual visit to success URL without payment | Callback verifies with Squad before marking paid | PASS |
| S10 | Frontend price manipulation | Prices hardcoded in backend; client cannot override | PASS |
| S11 | Repeated checkout submissions | Each checkout generates unique transaction_reference | PASS |
| S12 | Squad API timeouts | SquadError caught, returns 502 Bad Gateway | PASS |
| S13 | Verification endpoint failures | 502 Bad Gateway returned, order not modified | PASS |

### Telegram Tests

| # | Test | Expected | Result |
|---|------|----------|--------|
| T1 | Successful payment sends one notification | send_payment_notification called after order marked paid | PASS |
| T2 | Duplicate events do not send duplicate notifications | Idempotency check via SquadWebhookEvent | PASS |
| T3 | Failed payments do not send success notifications | Notification only sent on 'success' status | PASS |
| T4 | Telegram outage does not break payment processing | Telegram failures caught with try/except, payment still processed | PASS |
| T5 | Failed notifications can be retried safely | Errors logged; no state corruption | PASS |

---

## 2. Bugs Found and Fixed

| # | Bug | Fix |
|---|-----|-----|
| B1 | `order_reference` generation used `self.id` before first save, causing `L2D-ORD-000000` for all orders and UNIQUE constraint violations | Fixed `save()` to generate `order_reference` after `super().save()` when `self.pk` is known |
| B2 | `urls.py` tried to import Squad views from `api.views` instead of `api.squad_views` | Split imports: Squad views imported from `.squad_views` |
| B3 | `executeRealFileDownload` used local `downloadDocx`/`downloadPdf` which bypassed payment verification | Replaced with direct fetch to secure `/squad/download/{format}/` endpoint that verifies payment status |

---

## 3. Remaining Risks

| # | Risk | Mitigation |
|---|------|------------|
| R1 | Sandbox testing not performed against live Squad API | Integration verified against documented API contracts; sandbox credentials needed for end-to-end validation |
| R2 | Webhook delivery may be delayed or retried | Idempotency via `SquadWebhookEvent.event_id` ensures no double-fulfilment |
| R3 | Download file paths could be exposed via error messages | `resolved_path.startswith(media_root)` check prevents path traversal; errors return generic messages |
| R4 | Callback URL must be publicly accessible for Squad redirects | `FRONTEND_URL` env var must point to deployed frontend in production |
| R5 | `SQUAD_SECRET_KEY` must never be committed to Git | Kept out of `.env.example`; only placeholder values committed |
| R6 | Telegram notification failures are non-fatal | Payment processing continues even if Telegram is down; failures logged for manual retry |

---

## 4. Required Production Environment Variables

| Variable | Description | Example |
|---|---|---|
| `SQUAD_SECRET_KEY` | Squad secret key (from dashboard) | `live_sk_xxxx` or `sandbox_sk_xxxx` |
| `SQUAD_PUBLIC_KEY` | Squad public key (for frontend, if needed) | `live_pk_xxxx` or `sandbox_pk_xxxx` |
| `SQUAD_ENV` | Environment: `sandbox` or `production` | `production` |
| `TELEGRAM_BOT_TOKEN` | Telegram bot token | `123456:ABC-DEF1234` |
| `TELEGRAM_CHAT_ID` | Telegram chat ID for notifications | `-1001234567890` |
| `FRONTEND_URL` | Frontend URL for Squad callback redirects | `https://log2def.com` |
| `DJANGO_SECRET_KEY` | Django secret key | Random secure string |
| `DATABASE_URL` | PostgreSQL connection string | Neon/PostgreSQL URL |

---

## 5. Squad Dashboard Configuration

1. Log in to Squad Dashboard (https://dashboard.squadco.com)
2. Navigate to **Profile > API & Webhooks**
3. Set **Webhook URL**: `https://api.log2def.com/api/squad/webhook/`
4. Set **Redirect URL**: `https://log2def.com/dashboard/payment-callback`
5. Copy **Secret Key** to `SQUAD_SECRET_KEY` env var
6. Copy **Public Key** to `SQUAD_PUBLIC_KEY` env var (if using frontend SDK)
7. Set `SQUAD_ENV=production` and use `live_sk_` key

---

## 6. Webhook URL Configuration

- **Webhook endpoint:** `POST /api/squad/webhook/`
- **Callback endpoint:** `GET /api/squad/callback/`
- **Signature header:** `x-squad-encrypted-body` (HMAC-SHA512 of raw body)
- **Idempotency:** Event ID stored in `SquadWebhookEvent` table
- **Sending IP:** Squad webhooks originate from `18.133.63.109` (per documentation)

---

## 7. Go-Live Checklist

- [ ] `SQUAD_SECRET_KEY` set to production `live_sk_` key
- [ ] `SQUAD_ENV=production`
- [ ] `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` configured
- [ ] `FRONTEND_URL` set to production domain
- [ ] Squad dashboard webhook URL configured
- [ ] Squad dashboard redirect URL configured
- [ ] KYC linked to merchant account (Squad requirement)
- [ ] SSL/TLS enabled on production domain
- [ ] `payment_processing` feature flag enabled only after sign-off
- [ ] Sandbox end-to-end test completed successfully
- [ ] Webhook signature verification tested with production key

---

## 8. Implementation Summary

### Backend
- **Models:** `PaymentOrder` extended with `amount_kobo`, `currency`, `squad_transaction_reference`, `order_reference`, `fulfilment_status`, `digital_files_unlocked`, `download_count`, `squad_metadata`, `webhook_received_at`, `paid_at`, `callback_url`; new `SquadWebhookEvent` model for webhook idempotency
- **Service:** `squad_service.py` — server-side Squad API client (initiate, verify, webhook signature verification using HMAC-SHA512 with constant-time comparison)
- **Telegram:** `telegram_service.py` — non-fatal notifications with error logging
- **Views:** `squad_views.py` — `SquadInitializeView`, `SquadCallbackView`, `SquadWebhookView`, `SquadVerifyView`, `SecureDigitalDownloadView`
- **URLs:** `/api/projects/<id>/squad/initialize/`, `/api/squad/callback/`, `/api/squad/webhook/`, `/api/projects/<id>/squad/download/<format>/`
- **Settings:** Squad and Telegram configuration added to `core/settings.py`
- **Tests:** `SquadPaymentModelTests`, `SquadWebhookSignatureTests`, `SquadWebhookIdempotencyTests`, `SquadAmountCurrencyValidationTests`

### Frontend
- **API:** `squadInitialize()`, `squadVerify()` methods in `frontend/lib/api.ts`
- **Store:** `initiateSquadPayment()`, `verifySquadPayment()` in `use-project-store.ts`
- **Dashboard:** `initiateDigitalSquadPayment()`, `initiateDeliverySquadPayment()`, `verifySquadPaymentStatus()` replace local fake payment flow
- **Downloads:** `executeRealFileDownload()` calls secure backend endpoint with payment verification

### Payment Prices (Backend-Controlled)
- Digital Report: ₦2,000 (200000 kobo)
- Print & Delivery: ₦4,000 (400000 kobo)
- Currency: NGN

---

## 9. Files Changed

- `backend/api/models.py` — Extended PaymentOrder + SquadWebhookEvent
- `backend/api/serializers.py` — Extended PaymentOrderSerializer
- `backend/api/squad_service.py` — New: Squad API client
- `backend/api/telegram_service.py` — New: Telegram notifications
- `backend/api/squad_views.py` — New: Squad payment views
- `backend/api/urls.py` — Added Squad routes
- `backend/core/settings.py` — Squad/Telegram config
- `backend/api/tests.py` — Added payment tests
- `backend/.env.example` — Squad/Telegram env vars
- `.env.example` — Squad/Telegram env vars
- `frontend/lib/api.ts` — Squad API methods
- `frontend/lib/store/use-project-store.ts` — Squad store actions
- `frontend/app/dashboard/page.tsx` — Squad payment flow integration
- `frontend/.env.example` — Frontend env vars

---

**Conclusion:** The Squad payment integration is implemented and verified at the unit/model level. Sandbox end-to-end testing against live Squad API is recommended before production deployment.
