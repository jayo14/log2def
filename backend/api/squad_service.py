"""
Squad Payment Gateway Integration Service

Official documentation: https://docs.squadco.com/
All server-side operations only. Secret key never exposed to frontend.
"""

import hashlib
import hmac
import json
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
        raise SquadError('SQUAD_SECRET_KEY is not configured. Set it in your backend .env file.')

    # Validate key format matches environment
    if SQUAD_ENV == 'sandbox' and not SQUAD_SECRET_KEY.startswith('sandbox_sk_'):
        raise SquadError(
            f'Invalid Squad secret key for sandbox environment. '
            f'Key must start with "sandbox_sk_", got "{SQUAD_SECRET_KEY[:20]}...". '
            f'Get a sandbox key from https://dashboard.squadco.com'
        )
    if SQUAD_ENV == 'production' and not SQUAD_SECRET_KEY.startswith('live_sk_'):
        raise SquadError(
            f'Invalid Squad secret key for production environment. '
            f'Key must start with "live_sk_", got "{SQUAD_SECRET_KEY[:20]}...". '
            f'Get a live key from https://dashboard.squadco.com'
        )

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
    event payload signed with the Squad secret key.

    Per the official Squad documentation, there are two valid approaches:
    - PHP example: HMAC on the raw request body (file_get_contents('php://input'))
    - Node/C# examples: HMAC on JSON.stringify(parsed_body)

    This implementation tries both: first the raw body as received, then a
    deterministic re-serialization of the parsed JSON body. This ensures
    compatibility regardless of how Squad computed the signature.

    Uses hmac.compare_digest for constant-time comparison to prevent timing attacks.
    """
    if not SQUAD_SECRET_KEY:
        logger.error('SQUAD_SECRET_KEY not configured; cannot verify webhook')
        return False

    if not signature_header:
        return False

    expected_sig = signature_header.strip().lower()

    # Attempt 1: HMAC on the raw body as received over the wire
    expected = hmac.new(
        SQUAD_SECRET_KEY.encode('utf-8'),
        raw_body,
        hashlib.sha512,
    ).hexdigest()
    if hmac.compare_digest(expected.lower(), expected_sig):
        return True

    # Attempt 2: HMAC on a deterministic re-serialization of the parsed JSON body
    # This matches the Node.js and C# examples in the Squad documentation
    try:
        parsed = json.loads(raw_body)
        canonical = json.dumps(parsed, separators=(',', ':'), sort_keys=True)
        expected_canonical = hmac.new(
            SQUAD_SECRET_KEY.encode('utf-8'),
            canonical.encode('utf-8'),
            hashlib.sha512,
        ).hexdigest()
        if hmac.compare_digest(expected_canonical.lower(), expected_sig):
            return True
    except (json.JSONDecodeError, ValueError, TypeError):
        pass  # Not valid JSON, raw body was the only option

    return False
