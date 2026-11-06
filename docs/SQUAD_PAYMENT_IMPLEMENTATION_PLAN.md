# Squad Payment Gateway Integration — Implementation Plan

**Project:** Log2Def (LASUSTECH SIWES Technical Report)
**Status:** Draft for review
**Last Updated:** 2026-11-05
**Integrator:** Interstellar
**Source of Truth:** `docs.squadco.com` (current official docs only). Deprecated gitbook docs referenced only for field-name compatibility and explicitly not used for production guidance.

---

## 1. Existing Architecture

### 1.1 Backend Stack
| Component | Technology | Notes |
|---|---|---|
| Framework | Django 6.1.2 | Server-rendered + DRF API |
| API | Django REST Framework | Bearer JWT auth via `rest_framework_simplejwt` |
| Database | PostgreSQL (Neon) with SQLite fallback | PaymentOrder and related models in `backend/api/models.py` |
| File storage | S3-compatible (Neon) via `boto3` | PDF/DOCX document export, static assets |
| Background tasks | Celery (planned) | Webhook retry / email notifications |

### 1.2 Frontend Stack
| Component | Technology | Notes |
|---|---|---|
| Framework | Next.js | React 19 (app router), `'use client'` pages |
| State | Zustand | `useProjectStore`, `useReportStore` |
| Auth | JWT stored in `localStorage` + session | `getAuthToken()` helper via `useAuth()` context |
| Toast | Custom `showToast()` utility | Used throughout checkout/delivery flows |
| Styling | CSS modules / inline styles | `--mint`, `--ink`, `--bg` theme tokens |

### 1.3 Current Payment Handling (NON-EXTERNAL)
The dashboard purchase flow currently **fabricates payment locally** with no external gateway.

**Backend (`backend/api/models.py`):**
- `PaymentOrder` model with `order_type` (`digital` | `physical_delivery`), `amount`, `status` (`pending` | `paid` | `failed`), `transaction_reference`, `recipient_name`, `phone_number`, `campus_location`, `custom_address`, `delivery_date`, `payment_method`.

**Frontend (`frontend/app/dashboard/page.tsx`):**
- `processDigitalPayment()` — sets `status: 'successful'`, `amount: '2000.00'`, `transaction_reference: 'L2D_PAY_' + padded timestamp`, immediately marks `isProcessingPayment = false`. No network call.
- `processDeliveryPayment()` — same pattern with `amount: '4000.00'`, `order_type: 'physical_delivery'`, `phone_number`, `campus_location`, etc.
- Cart/checkout UI near lines 135–165 & 4970–5120.

**Problem:** No third-party verification exists. Payment requests are never sent to Squad, and no callbacks confirm payment. This is effectively "self-pay" and can be faked.

### 1.4 Existing Test & Feature-Flag Scaffolding
| File | Relevant content |
|---|---|
| `backend/api/feature_flags.py` | `payment_processing` flag (currently `False`) — gate for enabling payment flows |
| `backend/api/tests.py` (lines ~700–760) | Payment-related test scaffolding — `PaymentOrder` model tests, helpers for `record_payment`, `verify_payment` |
| `frontend/app/dashboard/page.tsx` | Purchase/order UI, `recordPayment()` call pattern, `fetchPayments()` refresh pattern |

**Implication:** The plumbing around payments (order models, DB records, frontend UI hooks) already exists. What is missing is the external API integration layer — the SDK wrapper, checkout orchestration, and webhook receiver.

---

## 2. Squad Integration Approach & Documented Endpoints

### 2.1 Client-Side (Frontend)
- Embed an **iframe modal** (`PaymentWidget`) or redirect to the **hosted checkout URL** returned by the server.
- Modal/embed is presented to the student on the dashboard purchase page.
- After successful checkout, Squad redirects to `callback_url` (configured on dashboard or passed per-payment) with the `transaction_reference` as a query parameter.

### 2.2 Server-Side (Backend)
- **Step 1 — Initiate:** `POST /transaction/initiate` with the purchase payload; receive `checkout_url` and `transaction_ref`.
- **Step 2 — Redirect/Authorize:** Frontend sends the customer to the `checkout_url` (or opens modal).
- **Step 3 — Verify:** On callback (or via a deferred verification job), `GET /transaction/verify/{{transaction_ref}}` confirms `transaction_status == "Success"`.
- **Step 4 — Persist & Update:** Update `PaymentOrder` record to `paid`; trigger Telegram notification and enable download.

All integration helper code goes into `backend/api/squad_integration.py` (new) plus small additions to `backend/api/views.py` and `frontend/app/dashboard/page.tsx`.

### 2.3 Core Endpoints (official squadco.com docs)
| Endpoint | Method | Purpose |
|---|---|---|
| `https://sandbox-api-d.squadco.com/transaction/initiate` | `POST` | Initiate payment (auth: `Authorization: Bearer <secret_key>`) |
| `https://sandbox-api-d.squadco.com/transaction/verify/<transaction_ref>` | `GET` | Verify transaction status & details |
| `https://sandbox-api-d.squadco.com/webhooks` | `POST` | Squad-facing webhook (merchant receives `charge_successful` event) |

Base URLs:
- **Sandbox:** `https://sandbox-api-d.squadco.com`
- **Production:** `https://api-d.squadco.com`

### 2.4 Initiate Payment — Required & Optional Fields

**Required:**
| Field | Type | Description |
|---|---|---|
| `email` | string | Customer email |
| `amount` | integer (NGN kobo) | Amount in kobo (₦2,000 → `200000`) |
| `currency` | string | `"NGN"` |
| `initiate_type` | string | `"inline"` |
| `transaction_ref` | string | Unique reference (e.g. `L2D_PAY_20261105_143022_123456`) |
| `callback_url` | string | Server-side URL to receive redirect callback |
| `payment_channels` | array | `["card", "bank", "ussd", "qr"]` (or subset) |
| `metadata` | object | Optional app-level refs (project ID, etc.) |
| `pass_charge` | boolean | `false` (leave to customer) — do not charge upfront |

**Optional:**
| Field | Description |
|---|---|
| `customer_name` | Customer full name |
| `phone_number` / `mobile_number` | Customer phone |
| `callback_url` | Server-side redirect |
| `network` | Network constraint (`"trust"`, `"gtm"`, or omitted) |

**Response (200–202):**
- `checkout_url` — e.g. `https://sandbox-pay.squadco.com/{transaction_ref}`
- `transaction_ref`, `transaction_amount`, `transaction_currency_id`, `customer_email`, `customer_name`, `id` (customer UUID), `status` ("Pending"), `initiate_type`, `payment_channels`, `channel`, `verification` object, `amount` (string), `currency` object, `reference` (string).

### 2.5 Transaction Verify — Response Fields
- `id` / `customer_id` / `transaction_ref`
- `transaction_amount` / `transaction_currency` / `transaction_status` (strings: `"Success"`, `"Failed"`, `"Abandoned"`, `"Pending"`)
- `customer_email` / `customer_name`
- `initiate_type`, `payment_channels`, `channel`
- `card` / `account` (masked details)
- `amount` / `currency` (string & currency object)
- `reference` (string)
- `verification` object (verification status metadata)

### 2.6 Webhooks
- **Configured on:** Squad Dashboard > Profile > API & Webhook > Add new webhook (POST URL).
- **Payload structure:** `{ "Event": "charge_successful", "TransactionRef": "<ref>", "Body": { ... } }`
- **Headers:**
  - `x-squad-encrypted-body` — HMAC-SHA512 signature of the raw request body, signed with the merchant secret key.
  - `Content-Type: application/json`
- **IP addresses:** `18.133.63.109` (Squad webhook IPs to whitelist for verification if needed)
- **Event types:** `charge_successful` (primary), plus generic recommendations (chargefailed, chargebacksuccessful, chargepending) as applicable.

### 2.7 Modal / Checkout Behavior
- **PaymentWidget** is an iframe-based checkout modal hosted by Squad.
- Configured on the dashboard; when a checkout is triggered, the customer is shown a modal in-context.
- After successful payment the customer is redirected back to `callback_url` with the transaction reference in the query string.
- Requires interaction with the widget iframe; server-side use of `modal` setup is supported (via `installment` / `payment_type` / `modal` flags if the direct API supports them — otherwise use hosted `checkout_url`).

### 2.8 Kobo / NGN Amount Handling
- All amounts are **integers in kobo**.
- ₦2,000 → `200000` kobo.
- ₦4,000 → `400000` kobo.
- The frontend and backend must convert display amounts (₦) to kobo before sending to Squad.
- Squad returns amounts as strings (e.g. `"200000"`) — do not parse as float.

### 2.9 Sandbox vs Production
- **Keys:** `sandbox_sk_...` for test, `live_sk_...` for production.
- **Base URLs:** `https://sandbox-api-d.squadco.com` ↔ `https://api-d.squadco.com`
- **Hosted checkout:** `https://sandbox-pay.squadco.com/...` ↔ `https://pay.squadco.com/...`
- **Sandbox behavior:** no real money changes hands; transactions show `"Success"` in test mode after completion. Must **disable real payments** before going live (documented).
- **Production:** requires KYC verification + live key; enforces real charges.

---

## 3. Order & Payment Data Models

### 3.1 Existing `PaymentOrder` Model (`backend/api/models.py`)
| Field | Type | Description |
|---|---|---|
| `project` | FK | Related project |
| `order_type` | `ChoiceField` | `"digital"` | `"physical_delivery"` |
| `amount` | `DecimalField` | Amount in kobo (integer string) |
| `currency` | `CharField` | `"NGN"` |
| `status` | `ChoiceField` | `"pending"` | `"paid"` | `"failed"` |
| `transaction_reference` | `CharField` | Squad `transaction_ref` |
| `payment_method` | `CharField` | e.g. `"card"`, `"bank"`, `"qr"` |
| `recipient_name` | `CharField` | Customer name |
| `phone_number` | `CharField` | Customer phone |
| `campus_location` | `CharField` | Delivery campus |
| `custom_address` | `TextField` | Delivery custom address |
| `delivery_date` | `DateField` | Delivery date (delivery orders) |
| `callback_url` | `URLField` | Squad redirect target |
| `client_ip` | `CharField` | Client IP at checkout |

### 3.2 New/Updated Fields from Integration
No schema change to `PaymentOrder` is strictly required beyond ensuring `callback_url`, `client_ip`, and `payment_method` exist. If the model currently lacks `callback_url`, add it as a nullable `CharField`/`URLField`.

### 3.3 Frontend Record Pattern
The existing `recordPayment(projectId, payload)` function already writes to the DB. The new integration will pass:
```js
{
  order_type: 'digital',
  amount: '200000',            // kobo integer, not display string
  currency: 'NGN',
  payment_method: 'card',      // from checkout choice
  transaction_reference: txRef, // Squad ref
  status: 'pending',           // initial, updated by webhook/verify
  callback_url: '/api/squad/webhook',
  client_ip: '127.0.0.1',
  recipient_name: details.name || userFullName,
}
```

---

## 4. Digital Purchase Workflow

### 4.1 Current Flow (broken / non-integrated)
1. User clicks **`Pay & Generate`** on an order.
2. `processDigitalPayment()` writes `status: 'successful'` locally.
3. Frontend sets `setHasPaidDigital(true)` and enables PDF/DOCX download.

### 4.2 New Integrated Flow
1. **Checkout Open:** User clicks "Pay & Generate"; frontend calls `backend/api/squad_initiation.py` with `projectId`, `email`, `name`, `phone`, `order_type: 'digital'`, `amount: 200000` (kobo), `payment_method`.
2. **Server → Squad Initiate:** Backend sends `POST /transaction/initiate`.
3. **Receive `checkout_url` + `transaction_ref`:** Backend stores `PaymentOrder` with `status: 'pending'`, `transaction_reference`, `callback_url: '/api/squad/callback'`.
4. **Present Checkout:** Frontend opens the hosted checkout in a new tab or embeds the `PaymentWidget` iframe modal.
5. **Customer Pays:** Customer completes payment in Squad's hosted UI.
6. **Callback:** Squad redirects to `/api/squad/callback?transaction_ref=...`.
7. **Server-Side Verification:** Backend calls `GET /transaction/verify/{{transaction_ref}}` → confirms `transaction_status === 'Success'`.
8. **Persist:** Update `PaymentOrder` → `status: 'paid'`, `payment_method`, `amount` from Squad response.
9. **Notify:** Send Telegram notification (see §8).
10. **Enable Download:** Frontend reads DB → `hasPaidDigital = true`, unlocks download.

### 4.3 Idempotency & State Machine
```
pending → awaiting verification → paid (confirmed by webhook/verify)
pending → failed (verify shows Success=false, or timeout)
```
A `task_id` / `processing_id` is not strictly required; rely on the `(project, transaction_reference)` uniqueness for idempotency.

---

## 5. Physical Delivery Workflow

### 5.1 Current Flow
1. User selects **`Pay & Deliver`**.
2. `processDeliveryPayment()` writes record with `order_type: 'physical_delivery'`, `amount: '4000.00'`, `phone_number`, `campus_location`, `custom_address`, `delivery_date`.
3. Frontend sets `setPaymentSuccess({ type: 'delivery', txRef, deliveryDetails })`.

### 5.2 New Integrated Flow
1. Same as digital, but:
   - `amount: 400000` kobo.
   - `order_type: 'physical_delivery'`.
   - `payment_method`, `phone_number`, `campus_location`, `custom_address`, `delivery_date` passed to `recordPayment()` and then to Squad `metadata`.
2. Same webhook/callback/verification steps.
3. Delivery record is marked `paid`; notification includes delivery details.

### 5.3 Delivery Logistics
Squad handles the payment step; Log2Def's own delivery SLA and logistics live outside this scope. Telegram is the notification channel (see §8).

---

## 6. Webhook & Verification Architecture

### 6.1 Two Independent Verification Paths
1. **Synchronous Callback** — Squad redirects to `/api/squad/callback?transaction_ref=...` after payment.
   - Backend verifies the transaction via `GET /transaction/verify/{{transaction_ref}}`.
2. **Asynchronous Webhook** — Squad pushes to the configured webhook URL (`/api/squad/webhook`).
   - Backend validates the `x-squad-encrypted-body` HMAC-SHA512 signature.
   - Backend extracts `TransactionRef` and `Body` from the payload.
   - Backend verifies the transaction and updates payment if `transaction_status === 'Success'`.

### 6.2 Signature Verification (Webhook)
SDK steps:
1. Read raw request body bytes.
2. Compute: `HMAC-SHA512(body_bytes, merchant_secret)` → hex string.
3. Compare with `request.headers['x-squad-encrypted-body']`.
4. If mismatch → return `401` (or `400`), log `INVALID_WEBHOOK_SIGNATURE`.

### 6.3 Webhook Payload Structure
```json
{
  "Event": "charge_successful",
  "TransactionRef": "L2D_PAY_20261105_143022_123456",
  "Body": {
    "transaction_status": "Success",
    "transaction_ref": "L2D_PAY_20261105_143022_123456",
    "transaction_amount": "200000",
    "customer_email": "student@lasustech.edu.ng",
    "customer_name": "John Doe"
  }
}
```

### 6.4 Backend Webhook Endpoint
- Route: `POST /api/squad/webhook`
- Middleware: Bearer JWT auth (admin or a dedicated integration service role)
- Signature check (as above)
- Payload validation: expect `{ Event: "charge_successful", TransactionRef, Body }`
- Action: lookup `PaymentOrder` by `transaction_reference`; if found and `status === 'pending'`:
  - Verify via Squad `GET /transaction/verify/{{transaction_ref}}`
  - If `transaction_status === 'Success'` → update to `paid`, set `payment_method`, `amount`, `recipient_name`, `phone_number` from payload.
  - If not successful → mark `failed` (or leave `pending` for later retry)
- Return `200` with `{"status": "received"}` (no sensitive data echoed).

### 6.5 Callback Endpoint
- Route: `GET /api/squad/callback?transaction_ref=...&...`
- Verify signature, then verify with Squad and update `PaymentOrder`.
- Return JSON; do **not** redirect the user (frontend navigation is already at `callback_url`).

---

## 7. Secure Download Strategy

### 7.1 Current State
- `executeRealFileDownload('PDF')` / `('Word')` calls `downloadPdf(projectId)` / `downloadDocx(projectId)` → reads from S3 (Neon object storage) and streams to browser. No payment check at download time.

### 7.2 New Flow
1. `downloadPdf(projectId)` checks a `hasPaidDigital` flag on the client (Zustand store) before streaming.
2. **Secure override:** Add a server-side guard `backend/api/views.py` endpoint `GET /api/projects/<id>/download/<format>` that:
   - Validates JWT (from `Authorization` header).
   - Looks up `PaymentOrder` for the project.
   - Requires `status === 'paid'`.
   - Streams the file from S3.
   - Sets `X-Content-Type-Options: nosniff`, `Cache-Control: private`, and `Content-Disposition: attachment`.
3. **Frontend change:** `executeRealFileDownload()` calls the secure endpoint instead of directly hitting S3.

### 7.3 Digital Order Unlocking
- After webhook/verify → `status: 'paid'` → backend job sets `hasPaidDigital = true` in Zustand store.
- Frontend downloads from secure endpoint.

---

## 8. Telegram Notification Architecture

### 8.1 Current State
- `backend/api/telegram.py` already exists (planned for notifications).
- Uses `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` env vars.
- `send_telegram_message()` and `send_telegram_action()` helpers are present but not wired to payments.

### 8.2 Proposed Integration
Add a `notify_payment_status(order_id, status)` function called after:
- **Digital payment complete:** `{project.title} — Digital payment confirmed. TxRef: {transaction_ref}.`
- **Delivery payment complete:** `{project.title} — Delivery payment confirmed ($order_type). Details: {phone}, {campus_location}, {delivery_date}.`
- **Payment failure/verification failure:** `{project.title} — Payment verification failed: {reason}.`

### 8.3 Flow
1. After `PaymentOrder` updated to `paid` in webhook/verify handler → call Telegram notify (async task).
2. Notify on `failed` status for alerting.

---

## 9. Environment Variables

| Variable | Purpose | Type | Notes |
|---|---|---|---|
| `SQUAD_ENV` | `sandbox` or `production` | String | Determines base URLs and key prefix |
| `SQUAD_SECRET_KEY` | Merchant secret (live or sandbox) | String | Used for webhook HMAC signing |
| `SQUAD_TEST_KEY` | Sandbox publishable key (prefix `sandbox_sk_`) | String | Used in client-side SDK, not sensitive |
| `SQUAD_WEBHOOK_URL` | Public callback URL for Squad dashboard webhook config | String | e.g. `https://log2def.ng/api/squad/webhook` |
| `TELEGRAM_BOT_TOKEN` | Bot token for notifications | String | Already exists |
| `TELEGRAM_CHAT_ID` | Target chat ID | String | Already exists |
| `SQUAD_SIMULATE_PAYMENT` | `true` for dev local demo | Boolean | Optional; forces `'Success'` verification |
| `LOG_LEVEL` | Logging verbosity | String | Default `INFO` |

**Never commit** `SQUAD_SECRET_KEY` to version control. Use `.env.local` / copilot secret management.

---

## 10. Frontend / Backend Changes

### 10.1 Backend Changes
| File | Change |
|---|---|
| New: `backend/api/squad_integration.py` | SDK wrapper: `initiate_payment(payload)`, `verify_transaction(ref)`, `verify_webhook_signature(body, secret)`; base URL selection by env |
| New: `backend/api/views.py` | Add `squad_initiation` (POST /api/squad/initiate), `squad_callback` (GET /api/squad/callback), `squad_webhook` (POST /api/squad/webhook) |
| New: `backend/api/urls.py` | Add URL routes |
| New: `backend/api/tasks.py` (existing/celery) | Periodic verification job to catch missed callbacks (optional) |
| New: `backend/api/migrations.py` (optional) | Add `callback_url`, `client_ip`, `payment_method` to `PaymentOrder` if missing |
| `backend/api/feature_flags.py` | Keep `payment_processing = False` until feature-gate review |

### 10.2 Frontend Changes
| File | Change |
|---|---|
| `frontend/app/dashboard/page.tsx` | Replace `processDigitalPayment()` / `processDeliveryPayment()` with: initiate → open checkout modal/redirect → verify on callback |
| `frontend/lib/api.ts` | Add `initiateSquadPayment`, `verifySquadTransaction` client functions (proxy to backend endpoint) |
| `frontend/app/dashboard/page.tsx` | `executeRealFileDownload()` → calls `GET /api/projects/<id>/download/<format>` |
| `frontend/app/dashboard/page.tsx` | Wire `hasPaidDigital` from DB as source of truth (re-fetch after payment) |

---

## 11. Security & Failure Handling

### 11.1 Security Checklist
- [ ] Never expose `SQUAD_SECRET_KEY` or `SQUAD_TEST_KEY` to the client.
- [ ] Use `sandbox_sk_` in dev, `live_sk_` only after KYC + production approval.
- [ ] Webhook signature validated on every `POST /api/squad/webhook`.
- [ ] JWT auth required on all internal payment endpoints.
- [ ] Idempotency: dedup duplicate `transaction_ref` in verification (no double-payment).
- [ ] Forbidden: charging `amount` as float; always send integer kobo.
- [ ] Download endpoints must re-check `paid` status server-side.

### 11.2 Failure States & Resolutions
| Failure | Cause | Resolution |
|---|---|---|
| Initiate returns 4xx | Invalid payload / missing fields | Log, return friendly error to frontend |
| Checkout redirect timeout | User closes tab / network drop | Background verification job catches up |
| Verify returns `Failed`/`Abandoned` | Customer cancelled / declined | Mark `PaymentOrder` → `failed` |
| Webhook signature mismatch | Secret key mismatch / reconstructed body | Check key, re-send test |
| Webhook timeout | Squad retries (up to N attempts) | SDK/validation covers idempotency |
| No callback within 5 min | Network issue | Background task polls `verify_transaction` |
| Production KYC not done | Live key enabled prematurely | Disable live payment; use sandbox only |

### 11.3 Idempotency & Double-Charge Prevention
- `transaction_ref` unique per project → enforce in `recordPayment` (unique constraint on `(project, transaction_reference)`).
- On webhook/verify, only update `status: 'paid'` if current status is `pending`.

---

## 12. Testing Strategy

### 12.1 Backend Tests (`backend/api/tests.py`)
| Test | What to assert |
|---|---|
| `test_initiate_payment_success` | 200/202; `checkout_url`, `transaction_ref` present; `status: 'pending'` saved |
| `test_verify_transaction_success` | `transaction_status === 'Success'`, `transaction_amount === '200000'` |
| `test_verify_transaction_failure` | `transaction_status === 'Failed'`, `status` updated to `failed` |
| `test_webhook_signature_invalid` | `401` / `400` returned |
| `test_webhook_signature_valid` | `200` with `{"status": "received"}` |
| `test_webhook_charge_successful` | `PaymentOrder` updated to `paid` |
| `test_download_required_paid_status` | `403` if unpaid; `200` + file if paid |
| `test_initiation_amount_is_kobo` | `200000` not `"2000.00"` |

### 12.2 Frontend Tests (`frontend/app/dashboard/page.tsx`)
- Mock `squad_initiation` and `verify` to test modal/redirect path.
- Assert `hasPaidDigital` is `false` until payment confirmed.
- Assert `processDigitalPayment` is not called directly (without API roundtrip).

### 12.3 Integration / E2E
1. Create a **Sandbox** project, run `squad_initiation` with a mocked `checkout_url`.
2. Simulate a **"successful"** `charge_successful` webhook with valid signature.
3. Re-run `verify` → `Success`.
4. Attempt download → `200` + file.
5. Withdraw `TransactionRef` from webhook and verify idempotency (no double-payment).

### 12.4 Sandbox vs Production
- All integration tests run against **sandbox**. Production keys only enabled after manual approval gate.

---

## 13. Implementation Sequence & Acceptance Criteria

### 13.1 Phase 0 — Environment & Config
- [ ] Add `SQUAD_ENV`, `SQUAD_SECRET_KEY`, `SQUAD_WEBHOOK_URL` to `.env.local` template.
- [ ] Verify `.env.local.example` is updated; `.env.local` git-ignored.

### 13.2 Phase 1 — SDK Wrapper
- [ ] Create `backend/api/squad_integration.py`.
- [ ] Implement: `get_base_url()`, `get_secret()`, `initiate_payment(payload) -> dict`, `verify_transaction(ref) -> dict`, `verify_webhook_signature(body, secret) -> bool`.
- [ ] Tests: `initiate_payment` with stubbed HTTP, `verify_transaction`, signature tests.

### 13.3 Phase 2 — Backend API Routes
- [ ] Add routes: `POST /api/squad/initiate`, `GET /api/squad/callback`, `POST /api/squad/webhook`.
- [ ] `POST /api/squad/initiate`:
  - Parse JSON (payment_method, project_id, amount_kobo, order_type, name, email, phone).
  - Convert amount to kobo integer.
  - Call `initiate_payment()`.
  - Store `PaymentOrder` → `status: 'pending'`.
  - Return `{ checkout_url, transaction_reference, status: 'pending' }`.
- [ ] `GET /api/squad/callback`: read `transaction_ref`, verify, update `PaymentOrder`.
- [ ] `POST /api/squad/webhook`: validate signature, verify, update `PaymentOrder`.
- [ ] Tests for each route with mocked SDK calls.

### 13.4 Phase 3 — Frontend Integration
- [ ] Update `processDigitalPayment()` / `processDeliveryPayment()`:
  - Replace local DB write with `await initiateSquadPayment(projectId, payload)`.
  - Open checkout iframe (`PaymentWidget`) or redirect to `checkout_url`.
- [ ] `executeRealFileDownload()` → call secure backend download endpoint.
- [ ] `hasPaidDigital` refreshed from DB after payment.
- [ ] Tests: mocked SDK calls, UI path assertions.

### 13.5 Phase 4 — QA & Security Gate
- [ ] Run full backend test suite: `python backend/api/tests.py` or `pytest`.
- [ ] Run frontend tests / lint / build.
- [ ] Manual E2E in **sandbox**:
  1. Create a project.
  2. Complete sandbox payment.
  3. Verify `PaymentOrder` → `paid`.
  4. Download should be unlocked.
- [ ] Production review:
  - KYC linked to merchant account.
  - `SQUAD_ENV=production` and `live_sk_` key enabled.
  - Feature flag `payment_processing = True` only after sign-off.
  - UI buttons updated to "Pay & Generate" / "Pay & Deliver".

### 13.6 Acceptance Criteria (Post-Implementation)
1. **Sandbox:** A user can complete a digital purchase and download a PDF/DOCX.
2. **Sandbox:** A user can complete a delivery purchase; Telegram notification sent.
3. **Sandbox:** Webhook signature verification passes; malformed requests blocked.
4. **Frontend:** No longer self-realizes payment (`status: 'successful'` locally); payment is gated by actual API flow.
5. **Security:** No API keys exposed client-side; download endpoints are server-protected.
6. **Documentation:** Implementation and webhook URLs documented; status board updated.

---

## Documentation & Reference Sources

- **Primary (current, production-valid):** `https://docs.squadco.com` (SDK & API docs)
- **Deprecated (field-name compatibility only, NOT production source-of-truth):** `https://gitbook.com/team/log2def` — old routes/field names only
- **Codebase references:**
  - `backend/api/models.py` — PaymentOrder model
  - `backend/api/feature_flags.py` — `payment_processing` flag
  - `backend/api/tests.py` — test scaffolding
  - `frontend/app/dashboard/page.tsx` — purchase flow (lines ~135–165, ~1600–1690)
  - `frontend/lib/api.ts` — API helpers
  - `backend/api/urls.py` — URL routes

---

## Assumptions & Open Items

| # | Assumption | Notes |
|---|---|---|
| A1 | Amount is displayed in ₦ with 2 decimals; API uses kobo integer | Confirmed from squad docs: `$2.00` not valid; must be `$200` in kobo |
| A2 | `PaymentOrder` has `callback_url`, `client_ip`, `payment_method` | If missing, add to model before Phase 2 |
| A3 | `recordPayment()` helper already exists in the dashboard page | Referred to in current code; may require refactoring to accept api payload |
| A4 | Telegram notification path is `backend/api/telegram.py` | Existing but unconnected |
| A5 | Webhook URL is `https://log2def.ng/api/squad/webhook` | Must be set in squad dashboard dashboard; production URL must be public |
| A6 | Direct API for `@squad/co` browser widget uses `sandbox_sk_` prefix | Confirm scheme and public vs secret key usage |

> **Note:** All production guidance is strictly from `docs.squadco.com`. Any gitbook material used does **not** override the official docs; discrepancies are treated as environment/legacy artifacts, not authoritative.
