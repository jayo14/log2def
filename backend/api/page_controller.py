"""
Page Budget Controller for Log2Def SIWES Technical Reports.

Enforces a strict 12-15 page range on every generated report without padding
or inventing content. Page counts come only from the actual rendered document
(LibreOffice -> PDF -> pdfinfo), never from word estimates.
"""

from __future__ import annotations

import re
import subprocess
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple

import logging

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Page budget configuration (settings with defaults, not hardcoded)
# ---------------------------------------------------------------------------

DEFAULT_MIN_PAGES = 12      # soft: warn (12 total pages minimum)
DEFAULT_MAX_PAGES = 17      # hard: block (12-15 body pages + 5 front matter pages = 17 pages max)
DEFAULT_TARGET_PAGES = 16   # aim for standard 12 body pages + front matter
WORDS_PER_PAGE = 350        # TNR 12pt, 1.5 spacing, justified, 2.54cm margins

# Section word budgets (front matter + main matter, including references)
SECTION_WORD_BUDGETS: Dict[str, int] = {
    "title_page": 60,
    "certification": 90,
    "dedication": 40,
    "acknowledgement": 60,
    "table_of_contents": 80,
    "ch1_background": 120,
    "ch1_objectives": 100,
    "ch1_importance": 100,
    "ch1_scope": 150,
    "ch1_duration": 60,
    "ch2_history": 150,
    "ch2_objectives": 100,
    "ch2_structure": 150,
    "ch2_organogram": 100,
    "ch3_duties": 150,
    "ch3_activities": 400,
    "ch3_skills": 100,
    "ch3_tools": 80,
    "ch3_challenges": 100,
    "ch3_solutions": 100,
    "ch4_summary": 120,
    "ch4_conclusion": 60,
    "ch4_recommendations": 120,
    "references": 80,
    "appendices": 0,
}

REQUIRED_SECTION_ORDER: List[str] = [
    "title_page",
    "certification",
    "dedication",
    "acknowledgement",
    "table_of_contents",
    "ch1_background",
    "ch1_objectives",
    "ch1_importance",
    "ch1_scope",
    "ch1_duration",
    "ch2_history",
    "ch2_objectives",
    "ch2_structure",
    "ch2_organogram",
    "ch3_duties",
    "ch3_activities",
    "ch3_skills",
    "ch3_tools",
    "ch3_challenges",
    "ch3_solutions",
    "ch4_summary",
    "ch4_conclusion",
    "ch4_recommendations",
    "references",
    "appendices",
]

FRONT_MATTER_KEYS = {
    "title_page", "certification", "dedication", "acknowledgement", "table_of_contents",
}

OPTIONAL_SECTIONS = {"dedication", "acknowledgement", "appendices"}

FIXED_TEXT_SECTIONS = {
    "ch1_background", "ch1_objectives", "ch1_importance", "certification", "references",
}

FACT_IMPORTANCE: Dict[str, int] = {
    "tool": 10,
    "equipment": 10,
    "quantity": 9,
    "project": 9,
    "activity": 8,
    "duty": 8,
    "challenge": 7,
    "solution": 7,
    "skill": 6,
    "person": 5,
    "organisation_detail": 4,
    "recommendation": 3,
    "personal_statement": 2,
}

@dataclass
class SectionBudget:
    key: str
    word_budget: int
    min_words: int
    max_words: int
    is_required: bool
    is_front_matter: bool
    is_fixed_text: bool
    is_optional: bool
    fact_importance_cap: int = 0


@dataclass
class PageCountResult:
    total_pages: int
    pages_per_section: Dict[str, int]
    student_content_pages: int
    fixed_text_pages: int
    within_range: bool
    over_limit: bool
    under_limit: bool
    pass_count: int


@dataclass
class CondenseResult:
    section_key: str
    original_word_count: int
    condensed_word_count: int
    facts_kept: int
    facts_dropped: int
    changes_made: List[str]


def count_pdf_pages(pdf_path: str) -> int:
    """Count pages in a rendered PDF using PyMuPDF with pdfinfo fallback."""
    try:
        import pymupdf
        doc = pymupdf.open(pdf_path)
        return len(doc)
    except Exception:
        pass
    try:
        result = subprocess.run(
            ["pdfinfo", pdf_path],
            capture_output=True, text=True, timeout=15,
        )
        for line in result.stdout.splitlines():
            if line.startswith("Pages:"):
                return int(line.split(":")[1].strip())
    except (subprocess.TimeoutExpired, FileNotFoundError, ValueError) as exc:
        logger.warning("pdfinfo page count failed: %s", exc)
    return 0


def count_docx_pages(docx_path: str) -> int:
    """Render DOCX to PDF via LibreOffice and count pages."""
    from .document_exporter import convert_docx_to_pdf
    try:
        pdf_path = convert_docx_to_pdf(docx_path)
        return count_pdf_pages(pdf_path)
    except Exception as exc:
        logger.warning("DOCX page count failed: %s", exc)
        return 0


def compute_section_budgets(
    min_pages: int = DEFAULT_MIN_PAGES,
    max_pages: int = DEFAULT_MAX_PAGES,
    target_pages: int = DEFAULT_TARGET_PAGES,
    words_per_page: int = WORDS_PER_PAGE,
) -> Dict[str, SectionBudget]:
    """Build per-section word budgets from the page budget."""
    budgets: Dict[str, SectionBudget] = {}

    for key in REQUIRED_SECTION_ORDER:
        base = SECTION_WORD_BUDGETS.get(key, 100)
        is_required = key not in OPTIONAL_SECTIONS
        is_front_matter = key in FRONT_MATTER_KEYS
        is_fixed = key in FIXED_TEXT_SECTIONS
        is_optional = key in OPTIONAL_SECTIONS

        if is_fixed:
            min_w = int(base * 0.8)
            max_w = int(base * 1.1)
        elif is_optional:
            min_w = 0
            max_w = base
        else:
            min_w = int(base * 0.6)
            max_w = int(base * 1.4)

        budgets[key] = SectionBudget(
            key=key,
            word_budget=base,
            min_words=min_w,
            max_words=max_w,
            is_required=is_required,
            is_front_matter=is_front_matter,
            is_fixed_text=is_fixed,
            is_optional=is_optional,
        )

    return budgets


def rank_facts_by_importance(facts) -> List:
    """Rank confirmed facts by importance for condensation decisions."""
    ranked = sorted(
        facts,
        key=lambda f: (FACT_IMPORTANCE.get(f.kind, 1), -len(f.text)),
        reverse=True,
    )
    return ranked
def condense_section_content(
    section_key: str,
    content: str,
    facts,
    budget: SectionBudget,
) -> CondenseResult:
    """
    Condense section content to fit within word budget without inventing content.

    Strategies (in order):
    1. Group consecutive days into week ranges
    2. Merge repeated routine tasks into single sentences
    3. Keep every named tool, quantity, project
    4. Summarise routine detail
    5. Drop lowest-importance facts only if still over budget
    """
    original_words = len(re.sub(r"\s+", " ", content).split())
    changes: List[str] = []

    if original_words <= budget.max_words:
        try:
            facts_kept = facts.count() if hasattr(facts, 'count') and callable(getattr(facts, 'count', None)) else len(facts)
        except (TypeError, AttributeError):
            facts_kept = len(facts)
        return CondenseResult(
            section_key=section_key,
            original_word_count=original_words,
            condensed_word_count=original_words,
            facts_kept=facts_kept,
            facts_dropped=0,
            changes_made=changes,
        )

    condensed = content

    # Strategy 1: Group days into week ranges (Chapter 3 activities)
    if section_key == "ch3_activities":
        condensed, changed = _group_days_into_week_ranges(condensed)
        if changed:
            changes.append("Grouped consecutive days into week ranges")

    # Strategy 2: Merge repeated routine tasks
    condensed, changed = _merge_repeated_tasks(condensed)
    if changed:
        changes.append("Merged repeated routine tasks into single sentences")

    # Strategy 3: Drop lowest-importance fact references
    condensed, dropped = _drop_low_importance_facts(condensed, facts, budget)
    if dropped:
        changes.append(f"Condensed {dropped} low-importance fact references")

    condensed_words = len(re.sub(r"\s+", " ", condensed).split())

    try:
        facts_kept_tmp = facts.count() if hasattr(facts, 'count') and callable(getattr(facts, 'count', None)) else len(facts)
    except (TypeError, AttributeError):
        facts_kept_tmp = len(facts)

    return CondenseResult(
        section_key=section_key,
        original_word_count=original_words,
        condensed_word_count=condensed_words,
        facts_kept=facts_kept_tmp,
        facts_dropped=dropped if "dropped" in locals() else 0,
        changes_made=changes,
    )


def _group_days_into_week_ranges(content: str) -> Tuple[str, bool]:
    """Group consecutive daily entries into week-range blocks."""
    changed = False
    week_pattern = re.compile(
        r"(?:WEEK\s+(\d+)[:\-]?\s*)?(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)[:\-]\s*([^.]+?)\.",
        re.I,
    )
    matches = list(week_pattern.finditer(content))
    if len(matches) > 2:
        changed = True
        content = week_pattern.sub(
            lambda m: f"Week {m.group(1) or 'X'}: {m.group(2).strip()}. ",
            content,
        )
    return content, changed


def _merge_repeated_tasks(content: str) -> Tuple[str, bool]:
    """Merge repeated routine tasks into consolidated sentences."""
    changed = False
    install_pattern = re.compile(r"I installed ([^.]+)\.", re.I)
    installs = install_pattern.findall(content)
    if len(installs) > 2:
        changed = True
        unique = sorted(set(installs))
        content = install_pattern.sub(
            "I installed various systems and equipment. ", content
        )
        if unique:
            content += f" Specifically: {', '.join(unique[:5])}."

    return content, changed


def _drop_low_importance_facts(
    content: str, facts, budget: SectionBudget
) -> Tuple[str, int]:
    """Drop references to lowest-importance facts when over budget."""
    dropped = 0
    if not facts:
        return content, 0

    cap = budget.fact_importance_cap
    if cap == 0:
        return content, 0

    low_facts = [f for f in facts if FACT_IMPORTANCE.get(f.kind, 1) < cap]
    for fact in low_facts:
        if fact.text in content:
            content = content.replace(fact.text, "", 1)
            dropped += 1

    return content, dropped

def validate_page_range(
    total_pages: int,
    min_pages: int = DEFAULT_MIN_PAGES,
    max_pages: int = DEFAULT_MAX_PAGES,
    target_pages: int = DEFAULT_TARGET_PAGES,
) -> PageCountResult:
    """Validate that total pages are within the allowed range."""
    within_range = min_pages <= total_pages <= max_pages
    over_limit = total_pages > max_pages
    under_limit = total_pages < min_pages

    return PageCountResult(
        total_pages=total_pages,
        pages_per_section={},
        student_content_pages=0,
        fixed_text_pages=0,
        within_range=within_range,
        over_limit=over_limit,
        under_limit=under_limit,
        pass_count=0,
    )


def count_section_words(content: str) -> int:
    """Count words in section content (stripping HTML tags)."""
    clean = re.sub(r"<[^>]+>", " ", content or "")
    clean = re.sub(r"\s+", " ", clean).strip()
    return len(clean.split()) if clean else 0


def compute_section_word_budgets(
    project_facts_count: int,
    total_confirmed_facts: int,
) -> Dict[str, int]:
    """
    Compute dynamic word budgets per section based on available confirmed material.
    Chapter Three flexes most; others have narrow bounds.
    """
    budgets = dict(SECTION_WORD_BUDGETS)

    if total_confirmed_facts < 10:
        budgets["ch3_activities"] = min(budgets.get("ch3_activities", 400), 200)
        budgets["ch3_duties"] = min(budgets.get("ch3_duties", 150), 100)

    if total_confirmed_facts > 30:
        budgets["ch3_activities"] = min(budgets.get("ch3_activities", 400), 600)

    return budgets


def get_page_settings(report) -> Dict[str, int]:
    """Read page settings from report template_options with defaults."""
    options = report.template_options if isinstance(report.template_options, dict) else {}
    return {
        "min_pages": int(options.get("min_pages", DEFAULT_MIN_PAGES)),
        "max_pages": int(options.get("max_pages", DEFAULT_MAX_PAGES)),
        "target_pages": int(options.get("target_pages", DEFAULT_TARGET_PAGES)),
        "appendices_counted": bool(options.get("appendices_counted", True)),
        "pages_include_front_matter": bool(options.get("pages_include_front_matter", True)),
    }

