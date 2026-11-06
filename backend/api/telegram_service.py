"""
Telegram notification service for payment events.

Environment variables:
- TELEGRAM_BOT_TOKEN
- TELEGRAM_CHAT_ID

Failures are logged but never invalidate payments.
The service is robust to transient delivery problems:
  * Deduplication — a successfully-sent notification for an order is never
    re-sent (tracked in TelegramNotificationLog across process restarts).
  * Retries — transient failures (network errors, HTTP 429/5xx) are retried
    with exponential backoff. Hard client errors (400/401/403/404) are not
    retried.
"""

import logging
import time
from typing import Optional

import requests
from django.conf import settings

from .models import TelegramNotificationLog

logger = logging.getLogger(__name__)

TELEGRAM_BOT_TOKEN = getattr(settings, 'TELEGRAM_BOT_TOKEN', '')
TELEGRAM_CHAT_ID = getattr(settings, 'TELEGRAM_CHAT_ID', '')
TELEGRAM_API_URL = 'https://api.telegram.org/bot{token}/sendMessage'

# --- Retry configuration ---
MAX_ATTEMPTS = 3
BACKOFF_BASE = 2  # seconds; sleeps grow as 2, 4, 8 ... between attempts
# Hard client errors we never retry (except 429, handled above).
NON_RETRYABLE_STATUS_CODES = {400, 401, 403, 404}

# Reusable session for connection pooling.
_SESSION = requests.Session()


def _record_attempt(
    order_reference: str,
    status: str,
    attempt_count: int,
    last_error: str = "",
) -> None:
    """Upsert the per-order deduplication/retry log row."""
    TelegramNotificationLog.objects.update_or_create(
        order_reference=order_reference,
        defaults={
            "status": status,
            "attempt_count": attempt_count,
            "last_error": last_error or "",
        },
    )



def send_payment_notification(
    order_reference: str,
    customer_name: str,
    order_type: str,
    amount: str,
    phone_number: str,
    delivery_address: Optional[str] = None,
    preferred_date: Optional[str] = None,
    fulfilment_status: str = 'pending',
) -> bool:
    """
    Send a Telegram notification about a successful payment.

    Returns True if the message was sent (or if Telegram is not configured),
    False if delivery failed after all retries.
    Failures are logged but never raise exceptions — payments must not be
    invalidated by Telegram delivery issues.
    """
    if not TELEGRAM_BOT_TOKEN or not TELEGRAM_CHAT_ID:
        logger.warning(
            'Telegram not configured (TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID missing); '
            'skipping notification for order %s',
            order_reference,
        )
        return True  # Not configured is not a failure

    # --- Deduplication: skip if already successfully sent for this order ---
    if TelegramNotificationLog.objects.filter(
        order_reference=order_reference, status='sent'
    ).exists():
        logger.info(
            'Telegram notification already sent for order %s; skipping duplicate',
            order_reference,
        )
        return True

    message = (
        f"*New Payment Received — Log2Def*\n"
        f"*Order Reference:* {order_reference}\n"
        f"*Customer:* {customer_name}\n"
        f"*Order Type:* {order_type}\n"
        f"*Amount:* ₦{amount}\n"
        f"*Phone:* {phone_number}\n"
        f"*Fulfilment Status:* {fulfilment_status}\n"
    )

    if delivery_address:
        message += f"*Delivery Address:* {delivery_address}\n"
    if preferred_date:
        message += f"*Preferred Date:* {preferred_date}\n"

    url = TELEGRAM_API_URL.format(token=TELEGRAM_BOT_TOKEN)
    payload = {
        'chat_id': TELEGRAM_CHAT_ID,
        'text': message,
        'parse_mode': 'Markdown',
        'disable_web_page_preview': True,
    }

    last_error = ""
    for attempt in range(1, MAX_ATTEMPTS + 1):
        try:
            resp = _SESSION.post(url, json=payload, timeout=15)

            if resp.status_code == 200:
                _record_attempt(order_reference, 'sent', attempt)
                logger.info(
                    'Telegram notification sent for order %s (attempt %s/%s)',
                    order_reference, attempt, MAX_ATTEMPTS,
                )
                return True

            last_error = f"HTTP {resp.status_code} {resp.text[:200]}"

            # Hard client error: do not retry.
            if resp.status_code in NON_RETRYABLE_STATUS_CODES:
                _record_attempt(order_reference, 'failed', attempt, last_error)
                logger.error(
                    'Telegram notification non-retryable failure for order %s: %s',
                    order_reference, last_error,
                )
                return False

            # Retryable (rate-limit or server error).
            logger.warning(
                'Telegram notification retryable failure for order %s '
                'attempt %s/%s: %s',
                order_reference, attempt, MAX_ATTEMPTS, last_error,
            )

        except requests.RequestException as exc:
            last_error = str(exc)
            logger.warning(
                'Telegram notification request error for order %s '
                'attempt %s/%s: %s',
                order_reference, attempt, MAX_ATTEMPTS, exc,
            )

        # Back off before the next attempt (skip after the last attempt).
        if attempt < MAX_ATTEMPTS:
            time.sleep(BACKOFF_BASE ** attempt)

    # Exhausted all attempts.
    _record_attempt(order_reference, 'failed', MAX_ATTEMPTS, last_error or 'unknown error')
    logger.error(
        'Telegram notification failed for order %s after %s attempts: %s',
        order_reference, MAX_ATTEMPTS, last_error,
    )
    return False
