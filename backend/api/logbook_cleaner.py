"""
Logbook cleaning, classification, week gap detection, and IT lexicon validation.

Tasks:
- Classify each entry: ACTIVITY, LEARNING_TRAINING, DESIGN, MEETING_PRESENTATION, ABSENCE, HOLIDAY.
- Filter out ABSENCE and HOLIDAY entries so they never appear in report text, duties, or skills.
- Detect week gaps (e.g. Week 11 missing).
- Software/IT lexicon and suspicious OCR token detection for student review.
"""
from __future__ import annotations

import re
from typing import Any, Dict, List, Tuple


# Regex patterns for entry classification with strict word boundaries
HOLIDAY_RE = re.compile(
    r"\b(public\s+holiday|eid(?:\s+el-maulud|\s+al-fitr|\s+al-adha)?|independence\s+day|"
    r"christmas(?:\s+day)?|boxing\s+day|new\s+year(?:\s+day)?|good\s+friday|easter(?:\s+monday)?|"
    r"workers(?:\s*['’]?\s*day)?|democracy\s+day|national\s+holiday)\b",
    re.IGNORECASE,
)

ABSENCE_RE = re.compile(
    r"\b(took\s+leave|on\s+leave|casual\s+leave|annual\s+leave|sick\s+leave|compassionate\s+leave|"
    r"church\s+event|religious\s+event|mosque\s+event|funeral|wedding|ceremony|"
    r"downpour|heavy\s+downpour|heavy\s+rain|flooding|bad\s+weather|"
    r"did(?:\s*n[\'’]t|\s+not)\s+(?:go|attend|report|come)\b|"
    r"was\s+absent|off\s+duty|indisposed|unwell|sick|illness|hospital\s+visit)\b",
    re.IGNORECASE,
)

DESIGN_RE = re.compile(
    r"\b(figma|ui/ux|ui\s+design|ux\s+design|visual\s+hierarchy|colour\s+theory|color\s+theory|"
    r"typography|flyer|booklet|brand\s+guideline|brand\s+identity|wireframe|wireframes|"
    r"prototyping|layout\s+tuning|text\s+contrast|banner|posters?)\b",
    re.IGNORECASE,
)

LEARNING_RE = re.compile(
    r"\b(introduced\s+to|learnt|learned|studied|explor(?:ed|ing)|fundamentals\s+of|"
    r"tutorial|reading\s+documentation|practiced\s+java|practised\s+java|installed\s+jdk)\b",
    re.IGNORECASE,
)

MEETING_RE = re.compile(
    r"\b(presented|presentation|demonstration|team\s+demo|sprint\s+review|"
    r"code\s+handoff|technical\s+handoff|exit\s+procedure|exit\s+interview|"
    r"supervisor\s+review|final\s+meeting)\b",
    re.IGNORECASE,
)


def classify_logbook_entry(text: str) -> str:
    """
    Classifies a logbook entry into:
    - HOLIDAY
    - ABSENCE
    - DESIGN
    - LEARNING_TRAINING
    - MEETING_PRESENTATION
    - ACTIVITY (default engineering/technical)
    """
    raw = (text or "").strip()
    if not raw:
        return "ACTIVITY"

    if HOLIDAY_RE.search(raw):
        return "HOLIDAY"
    if ABSENCE_RE.search(raw):
        return "ABSENCE"
    if DESIGN_RE.search(raw):
        return "DESIGN"
    if LEARNING_RE.search(raw):
        return "LEARNING_TRAINING"
    if MEETING_RE.search(raw):
        return "MEETING_PRESENTATION"

    return "ACTIVITY"


def filter_reportable_entries(entries: list) -> Tuple[list, list, str]:
    """
    Filters entries so that ABSENCE and HOLIDAY entries never become activities,
    duties, or skills, and never appear in the final report prose.

    Returns:
    - reportable_entries: list of entries ready for clustering and report generation
    - excluded_entries: list of (entry, classification, reason)
    - summary_notice: user-facing plain line explanation
    """
    reportable = []
    excluded = []

    for entry in entries:
        txt = (
            getattr(entry, "verified_text", None)
            or getattr(entry, "activity_summary", None)
            or getattr(entry, "raw_text", None)
            or (entry.get("text", "") if isinstance(entry, dict) else "")
            or ""
        ).strip()

        cls = classify_logbook_entry(txt)
        if cls in {"ABSENCE", "HOLIDAY"}:
            excluded.append((entry, cls, txt))
        else:
            reportable.append(entry)

    count = len(excluded)
    if count == 0:
        summary_notice = "All logbook entries represent active technical sessions."
    elif count == 1:
        summary_notice = "We left out 1 entry about leave or public holidays."
    else:
        summary_notice = f"We left out {count} entries about leave or public holidays."

    return reportable, excluded, summary_notice


def detect_week_gaps(entries: list) -> List[Dict[str, Any]]:
    """
    Identifies missing week numbers within the logbook range.
    For instance, if weeks 1-10 and 12 are present, flags Week 11 as missing.

    Returns a list of structured gap objects with user-facing questions.
    """
    week_numbers = set()
    for entry in entries:
        w = getattr(entry, "week_number", None)
        if w is None and isinstance(entry, dict):
            w = entry.get("week_number")
        if isinstance(w, int) and w > 0:
            week_numbers.add(w)

    if not week_numbers:
        return []

    min_w = min(week_numbers)
    max_w = max(week_numbers)
    expected = set(range(min_w, max_w + 1))
    missing = sorted(expected - week_numbers)

    gaps = []
    for w in missing:
        gaps.append({
            "week_number": w,
            "issue": f"Week {w} has no entries",
            "question": f"Week {w} has no entries: missing page, or no entries that week?",
            "action": "student_review_needed",
        })

    return gaps


# =========================================================================
# IT Lexicon & Suspicious OCR Token Review Queue
# =========================================================================

SOFTWARE_IT_LEXICON = {
    # Languages & Runtimes
    "Python", "Java", "JavaScript", "TypeScript", "SQL", "HTML", "CSS", "Bash", "Shell",
    # Frameworks & Libraries
    "FastAPI", "Django", "Flask", "React", "React Native", "Next.js", "Expo",
    "SQLAlchemy", "Alembic", "Celery", "Redis", "Pydantic", "PyTest",
    # Cloud, DevOps & Databases
    "Docker", "Docker Compose", "PostgreSQL", "SQLite", "Supabase", "Render", "Vercel",
    "Linux", "Ubuntu", "Git", "GitHub", "GitLab", "CI/CD",
    # Protocols & Concepts
    "REST", "REST API", "SSE", "Server-Sent Events", "WebSocket", "RAG",
    "Retrieval-Augmented Generation", "CSRF", "HSTS", "JWT", "OAuth", "SSL", "TLS",
    # Tools & Design
    "IntelliJ IDEA", "JetBrains", "VS Code", "Visual Studio Code", "Figma",
    "Postman", "Cisco Packet Tracer", "Wireshark", "JDK",
}

SUSPICIOUS_TOKEN_RULES = [
    {
        "pattern": re.compile(r"\bamphet\s+extension\s+allowlist\b", re.IGNORECASE),
        "flagged_token": "amphet extension allowlist",
        "suggestions": ["upload extension allowlist", "safe file extension allowlist", "file extension allowlist"],
        "clean_replacement": "file extension allowlist",
    },
    {
        "pattern": re.compile(r"\bprofit\s+exam\s+topics\s+authentication\b", re.IGNORECASE),
        "flagged_token": "profit exam topics authentication",
        "suggestions": ["protect exam topics authentication", "proctor exam topics authentication", "exam topics access control"],
        "clean_replacement": "exam topics access authentication",
    },
    {
        "pattern": re.compile(r"\bmulti-hyper\s+orchestration(?:,\s*SE\s+streaming)?\b", re.IGNORECASE),
        "flagged_token": "multi-hyper orchestration, SE streaming",
        "suggestions": ["multi-tier orchestration, SSE streaming", "model orchestration, SSE streaming", "server-sent events (SSE) streaming"],
        "clean_replacement": "multi-tier orchestration and SSE streaming",
    },
    {
        "pattern": re.compile(r"\bSE\s+streaming\b", re.IGNORECASE),
        "flagged_token": "SE streaming",
        "suggestions": ["SSE streaming", "server-sent events streaming"],
        "clean_replacement": "SSE streaming",
    },
    {
        "pattern": re.compile(r"\bAlchemy\s*&\s*Alembic\s+Rails\b", re.IGNORECASE),
        "flagged_token": "Alchemy & Alembic Rails",
        "suggestions": ["SQLAlchemy & Alembic migrations", "SQLAlchemy & Alembic models", "SQLAlchemy and Alembic"],
        "clean_replacement": "SQLAlchemy and Alembic migrations",
    },
    {
        "pattern": re.compile(r"\bApproved\s+improved\s+wallet\s+tax\s+processing\b", re.IGNORECASE),
        "flagged_token": "Approved improved wallet tax processing",
        "suggestions": ["wallet transaction processing", "improved wallet payment processing"],
        "clean_replacement": "wallet transaction processing",
    },
    {
        "pattern": re.compile(r"\bJava\s+IDEA!\s*IDEA\b", re.IGNORECASE),
        "flagged_token": "Java IDEA! IDEA",
        "suggestions": ["JetBrains IntelliJ IDEA", "IntelliJ IDEA"],
        "clean_replacement": "JetBrains IntelliJ IDEA",
    },
    {
        "pattern": re.compile(r"\bRumptyCloud\b", re.IGNORECASE),
        "flagged_token": "RumptyCloud",
        "suggestions": ["Render Cloud", "Cloudinary", "Google Cloud", "Vercel"],
        "clean_replacement": "Render Cloud",
    },
    {
        "pattern": re.compile(r"\bpro\s+Quiza\b", re.IGNORECASE),
        "flagged_token": "pro Quiza",
        "suggestions": ["project Quiza", "production Quiza", "projects including Quiza"],
        "clean_replacement": "project Quiza",
    },
]


def detect_suspicious_tokens(entries: list, tools_text: str = "") -> List[Dict[str, Any]]:
    """
    Finds implausible or corrupted OCR tokens in logbook entries and tools.
    Returns structured items for the student's review queue.
    """
    review_queue = []
    seen = set()

    all_items = []
    for e in entries:
        eid = getattr(e, "id", None) or (e.get("id") if isinstance(e, dict) else None)
        wn = getattr(e, "week_number", None) or (e.get("week_number") if isinstance(e, dict) else None)
        day = getattr(e, "day_of_week", "") or (e.get("day_of_week") if isinstance(e, dict) else "")
        txt = (
            getattr(e, "verified_text", None)
            or getattr(e, "activity_summary", None)
            or getattr(e, "raw_text", None)
            or (e.get("text", "") if isinstance(e, dict) else "")
            or ""
        ).strip()
        all_items.append((eid, wn, day, txt, "entry"))

    if tools_text:
        all_items.append((0, 0, "", tools_text, "tools"))

    for eid, wn, day, txt, kind in all_items:
        if not txt:
            continue
        for rule in SUSPICIOUS_TOKEN_RULES:
            match = rule["pattern"].search(txt)
            if match:
                matched_str = match.group(0)
                key = (wn, matched_str.lower())
                if key not in seen:
                    seen.add(key)
                    review_queue.append({
                        "entry_id": eid,
                        "week_number": wn,
                        "day_of_week": day,
                        "context_kind": kind,
                        "flagged_token": matched_str,
                        "full_context": txt,
                        "suggested_terms": rule["suggestions"],
                        "clean_replacement": rule["clean_replacement"],
                        "action_required": "confirm_or_correct_in_review",
                    })

    return review_queue


def clean_ocr_suspicious_text(text: str) -> str:
    """
    Cleans known suspicious corrupted OCR tokens, boilerplate questionnaire prompts,
    and bracketed OCR markers from report prose so unconfirmed corrupted artifacts
    are not passed through to the final report.
    """
    if not text:
        return ""
    cleaned = text
    # Strip bracketed OCR markers e.g. [Signature], [Stamp], [Page 1], [Signature: ...]
    cleaned = re.sub(r"\[(?:Signature|Stamp|Sign|Page\s*\d+|Date|Remark|Photo|Picture|Image|Initials?)[^\]]*\]", "", cleaned, flags=re.I)
    cleaned = re.sub(r"\[[^\]]+\]", "", cleaned)
    # Strip questionnaire / survey prompts leaked into logbooks e.g. "4. Describe how you have applied what you have learnt in the classroom to your training/job"
    cleaned = re.sub(r"\d+\.\s*(?:Describe how you have applied|What new job technique|State the kind of problems|How do you feel|Supervisor's remarks|Weekly summary|State specific skills|Outline the major assignments)[^.!?\n]*[.!?]?", "", cleaned, flags=re.I)
    cleaned = re.sub(r"\b(?:Describe how you have applied what you have learnt|What new job technique or procedures have you learnt|State the kind of problems you came up with)\b[^.!?\n]*[.!?]?", "", cleaned, flags=re.I)
    cleaned = re.sub(r"\b(?:how you have applied what you have learnt in the classroom to your training/job|technique or procedures have you learnt from your work/training|kind of problems you came up with during this period and how you handled them)\b", "", cleaned, flags=re.I)
    for rule in SUSPICIOUS_TOKEN_RULES:
        cleaned = rule["pattern"].sub(rule["clean_replacement"], cleaned)
    # Clean whitespace
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    return cleaned
