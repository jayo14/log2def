"""
Page classification for uploaded SIWES documents.

Classifies pages into:
- 'logbook': Daily/weekly activity entries, dates, supervisor remarks/signatures, SIWES form headers.
- 'cover_or_details': Student particulars, cover pages, institutional attachment headers.
- 'other': CVs, resumes, certificates, awards, diplomas, identity documents, blank/unrelated.
"""
from __future__ import annotations

import re
from typing import Any, Dict, List, Tuple


# Regex patterns indicating a Curriculum Vitae or Resume
CV_PATTERNS = [
    re.compile(r"\bcurriculum\s+vitae\b", re.I),
    re.compile(r"\br[eé]sum[eé]\b", re.I),
    re.compile(r"\bcareer\s+(?:objective|summary|profile)\b", re.I),
    re.compile(r"\bwork\s+(?:experience|history)\b", re.I),
    re.compile(r"\bprofessional\s+(?:experience|summary)\b", re.I),
    re.compile(r"\beducation\s+(?:and|&)\s+qualifications\b", re.I),
    re.compile(r"\bacademic\s+qualifications\b", re.I),
    re.compile(r"\bpersonal\s+(?:data|profile|details)\b", re.I),
    re.compile(r"\bextracurricular\s+activities\b", re.I),
    re.compile(r"\brefer(?:ees|ences)\s+(?:available|upon|on)\b", re.I),
    re.compile(r"\btechnical\s+skills\s*:\b", re.I),
    re.compile(r"\bgithub\.com/\b", re.I),
    re.compile(r"\blinkedin\.com/in/\b", re.I),
]

# Regex patterns indicating a Certificate or Award
CERTIFICATE_PATTERNS = [
    re.compile(r"\bcertificate\s+of\s+(?:completion|achievement|attendance|participation|excellence|merit|honou?r)\b", re.I),
    re.compile(r"\bthis\s+is\s+to\s+certify\s+that\b", re.I),
    re.compile(r"\bhas\s+(?:successfully\s+)?completed\s+the\s+(?:course|training|programme|program|workshop)\b", re.I),
    re.compile(r"\bhas\s+been\s+awarded\s+(?:the\s+)?(?:degree|diploma|certificate)\b", re.I),
    re.compile(r"\bhereby\s+confers?\s+upon\b", re.I),
    re.compile(r"\bpresented\s+to\b", re.I),
    re.compile(r"\bstatement\s+of\s+result\b", re.I),
    re.compile(r"\bdate\s+of\s+issue\b", re.I),
]

# Regex patterns indicating Student Details / Cover Page
COVER_PATTERNS = [
    re.compile(r"\bstudent(?:'s)?\s+particulars\b", re.I),
    re.compile(r"\bname\s+of\s+student\b", re.I),
    re.compile(r"\bmatric(?:ulation)?\s*(?:no|number)\b", re.I),
    re.compile(r"\bcourse\s+of\s+study\b", re.I),
    re.compile(r"\bname\s+of\s+(?:company|employer|establishment|organisation|organization)\b", re.I),
    re.compile(r"\blocation\s+of\s+(?:company|employer|establishment)\b", re.I),
    re.compile(r"\bperiod\s+of\s+training\b", re.I),
]

# Regex patterns indicating Logbook Pages
LOGBOOK_PATTERNS = [
    re.compile(r"\bstudents?'?\s+industrial\s+work\s+experience\s+scheme\b", re.I),
    re.compile(r"\bsiwes\s+log\s*book\b", re.I),
    re.compile(r"\bweekly\s+progress\s+report\b", re.I),
    re.compile(r"\bdescription\s+of\s+work\s+done\b", re.I),
    re.compile(r"\bdaily\s+(?:progress|activities|work|record)\b", re.I),
    re.compile(r"\bsupervisor(?:'s)?\s*(?:remarks?|comments?|signature|stamp)\b", re.I),
    re.compile(r"\bweek\s*(?:no|number|ending)?\s*[:#.]?\s*\d+\b", re.I),
    re.compile(r"\b(?:monday|tuesday|wednesday|thursday|friday|saturday)\b", re.I),
    re.compile(r"\bday\s+[1-7]\b", re.I),
]

DAYS_OF_WEEK = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday"]


def classify_page(text: str, vision_data: dict | None = None) -> dict[str, Any]:
    """
    Classifies a single extracted document page.

    Returns:
        {
            "page_type": "logbook" | "cover_or_details" | "other",
            "detected_label": str,
            "confidence": float,
            "reasons": list[str],
            "is_logbook": bool,
        }
    """
    clean_text = (text or "").strip()
    reasons: List[str] = []

    # Check for vision data hints if provided
    if vision_data and isinstance(vision_data, dict):
        if vision_data.get("is_cover_page") is True:
            return {
                "page_type": "cover_or_details",
                "detected_label": "Student Details / Cover Page",
                "confidence": 0.95,
                "reasons": ["Vision model identified cover/student particulars layout"],
                "is_logbook": False,
            }

    if not clean_text or len(clean_text) < 15:
        return {
            "page_type": "other",
            "detected_label": "Blank or Unreadable Page",
            "confidence": 0.90,
            "reasons": ["Page contains insufficient text (< 15 characters)"],
            "is_logbook": False,
        }

    # Count pattern matches
    cv_score = sum(1 for pat in CV_PATTERNS if pat.search(clean_text))
    cert_score = sum(1 for pat in CERTIFICATE_PATTERNS if pat.search(clean_text))
    cover_score = sum(1 for pat in COVER_PATTERNS if pat.search(clean_text))
    logbook_score = sum(1 for pat in LOGBOOK_PATTERNS if pat.search(clean_text))

    # Day-of-week frequency (strong indicator of logbook tables)
    days_present = [day for day in DAYS_OF_WEEK if re.search(r'\b' + day + r'\b', clean_text, re.I)]
    if len(days_present) >= 3:
        logbook_score += 3
        reasons.append(f"Contains multiple day entries ({', '.join(days_present)})")

    # Dates presence (e.g. 12/03/2026 or 12 March)
    date_matches = re.findall(r'\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b|\b\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\b', clean_text, re.I)
    if len(date_matches) >= 3:
        logbook_score += 2
        reasons.append(f"Contains multiple calendar dates ({len(date_matches)} found)")

    # Explicit week header
    week_match = re.search(r'\bweek\s*(?:no|number)?\s*[:#.]?\s*(\d+)\b', clean_text, re.I)
    if week_match:
        logbook_score += 2
        reasons.append(f"Contains explicit week heading (Week {week_match.group(1)})")

    # Check for CV
    if cv_score >= 2 or (cv_score >= 1 and ("curriculum vitae" in clean_text.lower() or "resume" in clean_text.lower())):
        matched_cv = [pat.pattern for pat in CV_PATTERNS if pat.search(clean_text)][:3]
        return {
            "page_type": "other",
            "detected_label": "Curriculum Vitae / Resume",
            "confidence": min(0.98, 0.70 + 0.10 * cv_score),
            "reasons": [f"Detected CV/Resume structure and headings: {', '.join(matched_cv)}"],
            "is_logbook": False,
        }

    # Check for Certificate
    if cert_score >= 2 or (cert_score >= 1 and ("this is to certify that" in clean_text.lower() or "certificate of" in clean_text.lower())):
        matched_cert = [pat.pattern for pat in CERTIFICATE_PATTERNS if pat.search(clean_text)][:3]
        return {
            "page_type": "other",
            "detected_label": "Certificate of Completion / Award",
            "confidence": min(0.98, 0.70 + 0.10 * cert_score),
            "reasons": [f"Detected certificate phrasing: {', '.join(matched_cert)}"],
            "is_logbook": False,
        }

    # Check for Cover / Student Particulars
    if cover_score >= 3 and logbook_score < 3:
        return {
            "page_type": "cover_or_details",
            "detected_label": "Student Details / Cover Page",
            "confidence": min(0.95, 0.65 + 0.10 * cover_score),
            "reasons": ["Contains student particulars and institutional training cover fields"],
            "is_logbook": False,
        }

    # Check for Logbook
    if logbook_score >= 2 or len(days_present) >= 2 or (week_match and len(date_matches) >= 1):
        return {
            "page_type": "logbook",
            "detected_label": "Logbook Page",
            "confidence": min(0.98, 0.60 + 0.10 * logbook_score),
            "reasons": reasons or ["Contains daily/weekly industrial training record structure"],
            "is_logbook": True,
        }

    # Ambiguous or Unrelated Page
    return {
        "page_type": "other",
        "detected_label": "Unrelated Document",
        "confidence": 0.65,
        "reasons": ["Does not exhibit standard daily/weekly SIWES logbook format or dates"],
        "is_logbook": False,
    }


def evaluate_project_pages(project) -> dict[str, Any]:
    """
    Evaluates all extracted pages for a project and checks if most pages are legitimate logbook pages.
    """
    from .models import ExtractedPage

    pages = list(
        ExtractedPage.objects.filter(document__project_id=project.id)
        .order_by("page_index", "page_number")
    )
    if not pages:
        return {
            "has_pages": False,
            "total_pages": 0,
            "logbook_pages": 0,
            "non_logbook_pages": [],
            "is_acceptable": False,
            "message": "No pages have been uploaded or extracted yet.",
        }

    logbook_pages = []
    non_logbook_pages = []

    for page in pages:
        classification = classify_page(page.extracted_text or "")
        page_info = {
            "page_id": page.id,
            "page_number": page.page_number,
            "page_index": page.page_index,
            "page_type": classification["page_type"],
            "detected_label": classification["detected_label"],
            "reasons": classification["reasons"],
        }
        if classification["page_type"] == "logbook":
            logbook_pages.append(page_info)
        else:
            non_logbook_pages.append(page_info)

    total = len(pages)
    num_logbook = len(logbook_pages)
    num_non_logbook = len(non_logbook_pages)

    # Acceptable if there is at least one logbook page and logbook pages outnumber non-logbook pages
    is_acceptable = num_logbook > 0 and num_logbook >= num_non_logbook

    friendly_items = [
        f"Page {p['page_number']}: {p['detected_label']}" for p in non_logbook_pages
    ]
    if not is_acceptable:
        msg = (
            f"The uploaded pages do not appear to be SIWES logbook pages "
            f"({', '.join(friendly_items)}). "
            f"Please review or remove these pages, or confirm to proceed."
        )
    else:
        msg = f"Found {num_logbook} valid logbook page(s)."

    return {
        "has_pages": True,
        "total_pages": total,
        "logbook_pages_count": num_logbook,
        "non_logbook_pages_count": num_non_logbook,
        "logbook_pages": logbook_pages,
        "non_logbook_pages": non_logbook_pages,
        "is_acceptable": is_acceptable,
        "message": msg,
    }
