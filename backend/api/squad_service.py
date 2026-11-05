"""
Squad Payment Gateway Integration Service

Official documentation: https://docs.squadco.com/
All server-side operations only. Secret key never exposed to frontend.
"""

import hashlib
import hmac
import logging
from typing import Any, Dict, Optional

import requests
from django.conf import settings

logger = logging.getLogger(__name__)

# --- Configuration ---

SQUAD_SECRET_KEY = getattr(settings, 'SQUAD_SECRET_KEY', '')
SQUAD_PUBLIC_KEY = getattr(settings, 'SQUAD_PUBLIC_KEY', '')
SQUAD_ENV = getattr(settings, 'SQUAD_ENV', 'sandbox')  # 'sandbox' or 'production'

if SQUAD_ENV == 'production':
    SQUAD_BASE_URL = 'https://api-d.squadco.com'
else:
    SQUAD_BASE_URL = 'https://sandbox-api-d.squadco.com'

TRANSACTION_INITIATE_URL = f'{SQUAD_BASE_URL}/transaction/initiate'
TRANSACTION_VERIFY_URL_TEMPLATE = f'{SQUAD_BASE_URL}/transaction/verify/{{transaction_ref}}'


# --- Squad API Client ---

class SquadError(Exception):
    """Raised when the Squad API returns an error."""
    pass


def _headers() -> Dict[str, str]:
    if not SQUAD_SECRET_KEY:
        raise SquadError('SQUAD_SECRET_KEY is not configured')
    return {
        'Authorization': f'Bearer {SQUAD_SECRET_KEY}',
        'Content-Type': 'application/json',
    }


def initiate_transaction(
    email: str,
    amount_kobo: int,
    currency: str,
    transaction_ref: str,
    callback_url: str,
    customer_name: str = '',
    payment_channels: Optional[list] = None,
    metadata: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """
    Initialize a Squad transaction server-side.

    Returns the parsed JSON response including checkout_url.
    Raises SquadError on failure.
    """
    if not SQUAD_SECRET_KEY:
        raise SquadError('Squad secret key not configured')

    payload: Dict[str, Any] = {
        'email': email,
        'amount': amount_kobo,  # integer in kobo (lowest currency unit)
        'currency': currency,
        'initiate_type': 'inline',
        'transaction_ref': transaction_ref,
        'callback_url': callback_url,
    }

    if customer_name:
        payload['customer_name'] = customer_name

    if payment_channels:
        payload['payment_channels'] = payment_channels

    if metadata:
        payload['metadata'] = metadata

    try:
        resp = requests.post(
            TRANSACTION_INITIATE_URL,
            json=payload,
            headers=_headers(),
            timeout=30,
        )
    except requests.RequestException as exc:
        logger.exception('Squad initiate_transaction request failed')
        raise SquadError(f'Network error contacting Squad: {exc}') from exc

    if resp.status_code == 401:
        raise SquadError('Invalid Squad API key')
    if resp.status_code == 400:
        try:
            err = resp.json()
        except ValueError:
            err = {}
        detail = err.get('message') or err.get('detail') or str(err)
        raise SquadError(f'Squad validation error: {detail}')
    if resp.status_code >= 500:
        raise SquadError(f'Squad server error (HTTP {resp.status_code})')
    if resp.status_code != 200:
        raise SquadError(f'Squad API returned HTTP {resp.status_code}')

    try:
        data = resp.json()
    except ValueError as exc:
        raise SquadError('Invalid JSON response from Squad') from exc

    checkout_data = data.get('data', {})
    checkout_url = checkout_data.get('checkout_url')
    if not checkout_url:
        raise SquadError('No checkout_url returned by Squad')

    return {
        'checkout_url': checkout_url,
        'transaction_reference': checkout_data.get('transaction_ref') or transaction_ref,
        'amount': checkout_data.get('transaction_amount', amount_kobo),
        'currency': checkout_data.get('currency', currency),
        'status': 'pending',
        'raw_response': data,
    }


def verify_transaction(transaction_reference: str) -> Dict[str, Any]:
    """
    Verify a Squad transaction by reference.

    Returns the parsed verification data.
    Raises SquadError on failure.
    """
    if not SQUAD_SECRET_KEY:
        raise SquadError('Squad secret key not configured')

    url = TRANSACTION_VERIFY_URL_TEMPLATE.format(transaction_ref=transaction_reference)

    try:
        resp = requests.get(url, headers=_headers(), timeout=30)
    except requests.RequestException as exc:
        logger.exception('Squad verify_transaction request failed')
        raise SquadError(f'Network error contacting Squad: {exc}') from exc

    if resp.status_code == 401:
        raise SquadError('Invalid Squad API key')
    if resp.status_code == 403:
        raise SquadError('Invalid Squad API key')
    if resp.status_code == 400:
        raise SquadError('Invalid transaction reference')
    if resp.status_code >= 500:
        raise SquadError(f'Squad server error (HTTP {resp.status_code})')
    if resp.status_code != 200:
        raise SquadError(f'Squad API returned HTTP {resp.status_code}')

    try:
        data = resp.json()
    except ValueError as exc:
        raise SquadError('Invalid JSON response from Squad') from exc

    return data


# --- Webhook Signature Verification ---

def verify_webhook_signature(raw_body: bytes, signature_header: str) -> bool:
    """
    Verify Squad webhook signature using HMAC-SHA512 constant-time comparison.

    The x-squad-encrypted-body header contains an HMAC-SHA512 hex digest of the
    raw request body signed with the Squad secret key.

    Uses hmac.compare_digest for constant-time comparison to prevent timing attacks.
    """
    if not SQUAD_SECRET_KEY:
        logger.error('SQUAD_SECRET_KEY not configured; cannot verify webhook')
        return False

    if not signature_header:
        return False

    expected = hmac.new(
        SQUAD_SECRET_KEY.encode('utf-8'),
        raw_body,
        hashlib.sha512,
    ).hexdigest()

    # Constant-time comparison
    return hmac.compare_digest(expected.lower(), signature_header.strip().lower())
