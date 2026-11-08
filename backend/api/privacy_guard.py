"""
Privacy Guard for SIWES report narratives.

Ensures personal contact details found in source text (emails, phone numbers,
external web URLs, street addresses) do NOT leak into report body text
(Section 3.2, 3.3, 3.4, Chapter 4, etc.).
"""
from __future__ import annotations

import re


# Regex for Email Addresses
EMAIL_REGEX = re.compile(
    r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b"
)

# Regex for Phone Numbers (Nigerian formats and international patterns)
# e.g. +234 803 123 4567, 08031234567, +234-80-1234-5678, (01) 2345678, etc.
PHONE_REGEX = re.compile(
    r"(?:\+?234[\s.-]?)?(?:\(?0\d{1,4}\)?[\s.-]?)?\d{3,4}[\s.-]?\d{3,4}(?:[\s.-]?\d{3,4})?\b"
)

# Strict phone check: at least 7 digits in total
def _is_actual_phone_match(match_str: str) -> bool:
    digits = re.sub(r"\D", "", match_str)
    return len(digits) >= 8 and len(digits) <= 15


# Regex for Web URLs and Links
URL_REGEX = re.compile(
    r"(?:https?://[^\s<>\"']+|www\.[^\s<>\"']+|linkedin\.com/[^\s<>\"']+|github\.com/[^\s<>\"']+)",
    re.IGNORECASE
)

# Regex for Street Addresses in text
# e.g. No. 12 Victoria Island, Plot 45 Commercial Avenue, 123 Silicon Boulevard, 10 Herbert Macaulay Way
ADDRESS_REGEX = re.compile(
    r"\b(?:\d+|no\.?\s*\d+|plot\s*\d+|suite\s*\d+|km\s*\d+)[,\s]+[A-Za-z0-9\s.-]+?\b(?:street|st\.?|road|rd\.?|avenue|ave\.?|way|crescent|close|cres\.?|expressway|blvd|boulevard)\b",
    re.IGNORECASE
)


def sanitize_privacy_identifiers(text: str) -> str:
    """
    Strips email addresses, phone numbers, web links, and street addresses from narrative text.
    Replaces them with clean whitespace so text flows naturally without leaking personal data.
    """
    if not text:
        return ""

    sanitized = text

    # Remove emails
    sanitized = EMAIL_REGEX.sub(" ", sanitized)

    # Remove URLs and links
    sanitized = URL_REGEX.sub(" ", sanitized)

    # Remove Street Addresses
    sanitized = ADDRESS_REGEX.sub(" ", sanitized)

    # Remove phone numbers (carefully verifying digit count to avoid stripping single years or quantities)
    for match in list(PHONE_REGEX.finditer(sanitized)):
        m_str = match.group(0).strip()
        # Avoid stripping plain 4-digit years like 2026 or small quantities
        if _is_actual_phone_match(m_str):
            # Verify it's not a pure 4-digit number or date range
            digits = re.sub(r"\D", "", m_str)
            if len(digits) >= 8:
                sanitized = sanitized.replace(m_str, " ")

    # Clean up excessive whitespace
    sanitized = re.sub(r"[ \t]+", " ", sanitized)
    sanitized = re.sub(r"\n\s*\n+", "\n\n", sanitized)
    return sanitized.strip()
