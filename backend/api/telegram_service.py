"""
Telegram notification service for payment events.

Environment variables:
- TELEGRAM_BOT_TOKEN
- TELEGRAM_CHAT_ID

Failures are logged but never invalidate payments.
"""

import logging
from typing import Optional

import requests
from django.conf import settings

logger = logging.getLogger(__name__)

TELEGRAM_BOT_TOKEN = getattr(settings, 'TELEGRAM_BOT_TOKEN', '')
TELEGRAM_CHAT_ID = getattr(settings, 'TELEGRAM_CHAT_ID', '')
TELEGRAM_API_URL = 'https://api.telegram.org/bot{token}/sendMessage'


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

    Returns True if the message was sent (or if Telegram is not configured).
    Returns False if the message failed to send.
    Failures are logged but never raise exceptions — payments must not
    be invalidated by Telegram delivery issues.
    """
    if not TELEGRAM_BOT_TOKEN or not TELEGRAM_CHAT_ID:
        logger.warning(
            'Telegram not configured (TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID missing); '
            'skipping notification for order %s', order_reference
        )
        return True  # Not configured is not a failure

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

    try:
        resp = requests.post(url, json=payload, timeout=15)
        if resp.status_code == 200:
            logger.info('Telegram notification sent for order %s', order_reference)
            return True
        logger.error(
            'Telegram notification failed for order %s: HTTP %s %s',
            order_reference, resp.status_code, resp.text[:200]
        )
        return False
    except requests.RequestException as exc:
        logger.exception('Telegram notification request failed for order %s: %s', order_reference, exc)
        return False
