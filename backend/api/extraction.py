"""Deterministic transcript parsing and provenance validation.

This module deliberately does not call an LLM. Any future model extractor must
return candidates through validate_fact_candidate before persistence.
"""
from __future__ import annotations

import re
import logging
from datetime import date
from typing import Any

from .models import DayEntry, Fact, LogbookPage, WeekRecord

logger = logging.getLogger(__name__)

FACT_SCHEMA = {
    "type": "object", "additionalProperties": False,
    "required": ["kind", "text", "provenance", "evidence_quote", "inference_reason"],
    "properties": {
        "kind": {"enum": ["activity", "tool", "equipment", "quantity", "skill", "duty", "project", "challenge", "solution", "person", "organisation_detail"]},
        "text": {"type": "string", "minLength": 1},
        "provenance": {"enum": ["LOGBOOK", "INFERRED", "STUDENT_PROVIDED"]},
        "evidence_quote": {"type": "string", "minLength": 1},
        "inference_reason": {"type": "string"},
    },
}

WEEK_RE = re.compile(r"\bweek\s*(?:no\.?\s*)?(\d{1,2})(?:\s*[-–]\s*(\d{1,2}))?\b", re.I)
DATE_RE = re.compile(r"\b(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})\b")
WEEKDAYS = ("Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday")


def validate_fact_candidate(candidate: dict[str, Any], transcript: str) -> tuple[bool, str]:
    """Validate mandatory provenance semantics before a candidate can be saved."""
    required = FACT_SCHEMA["required"]
    if not isinstance(candidate, dict) or set(candidate) != set(required):
        return False, "fact_schema_invalid_fields"
    if candidate.get("kind") not in FACT_SCHEMA["properties"]["kind"]["enum"]:
        return False, "fact_schema_invalid_kind"
    if candidate.get("provenance") not in FACT_SCHEMA["properties"]["provenance"]["enum"]:
        return False, "fact_schema_invalid_provenance"
    if not all(isinstance(candidate.get(key), str) for key in required):
        return False, "fact_schema_invalid_type"
    quote = candidate.get("evidence_quote", "")
    if not isinstance(quote, str) or not quote or quote not in transcript:
        return False, "evidence_quote_not_verbatim_substring"
    if candidate.get("provenance") == "INFERRED" and not str(candidate.get("inference_reason", "")).strip():
        return False, "inference_reason_required"
    # Facts retain source wording. Clean report phrasing is a later, separately
    # validated step that must link back to this source fact.
    if not candidate.get("text"):
        return False, "fact_text_required"
    if candidate.get("provenance") != "INFERRED" and candidate["text"] not in transcript:
        return False, "fact_text_not_verbatim_substring"
    if candidate.get("provenance") == "LOGBOOK" and not quote:
        return False, "logbook_fact_requires_evidence"
    return True, ""


def classify_page(text: str, signature_present: bool = False) -> str:
    cleaned = text.strip()
    if not cleaned:
        return "blank"
    lowered = cleaned.casefold()
    if any(label in lowered for label in ("matriculation number", "student name", "department:")):
        return "student_details"
    if any(label in lowered for label in ("supervisor's remark", "supervisor remarks", "supervisor's comments")) or signature_present:
        return "supervisor_remarks"
    if WEEK_RE.search(cleaned) or DATE_RE.search(cleaned):
        return "weekly_record"
    if any(label in lowered for label in ("siwes logbook", "industrial training logbook", "log book")):
        return "cover"
    return "other"


def parse_reviewed_page(logbook_page: LogbookPage) -> list[DayEntry]:
    """Split a reviewed transcript into source-preserving lines and week records."""
    transcript = logbook_page.reviewed_text or ""
    if logbook_page.extracted_page.supervisor_signature_detected:
        logbook_page.signature_present = True
    if re.search(r"\b(?:stamp|official seal|company seal)\b", transcript, re.I):
        logbook_page.stamp_present = True
    if not transcript.strip():
        logbook_page.page_type = "blank"
        logbook_page.save(update_fields=["page_type", "signature_present", "stamp_present"])
        return []
    project = logbook_page.extracted_page.document.project
    week_match = WEEK_RE.search(transcript)
    week_number = int(week_match.group(1)) if week_match else 0
    week, _ = WeekRecord.objects.get_or_create(project=project, week_number=week_number)
    week.source_pages.add(logbook_page)
    created = []
    offset = 0
    for raw_line in transcript.splitlines(keepends=True):
        line = raw_line.rstrip("\r\n")
        start, end = offset, offset + len(line)
        offset += len(raw_line)
        value = line.strip()
        if not value:
            continue
        parsed_date = None
        date_match = DATE_RE.search(value)
        if date_match:
            day, month, year = map(int, date_match.groups())
            year += 2000 if year < 100 else 0
            try:
                parsed_date = date(year, month, day)
            except ValueError:
                pass
        weekday = next((name for name in WEEKDAYS if re.search(rf"\b{name}\b", value, re.I)), "")
        created.append(DayEntry.objects.create(
            week_record=week, date=parsed_date, weekday=weekday, text=line,
            source_page=logbook_page, source_span={"start": start, "end": end},
            confidence=logbook_page.quality_score,
        ))
    logbook_page.page_type = classify_page(transcript, logbook_page.extracted_page.supervisor_signature_detected)
    logbook_page.save(update_fields=["page_type", "signature_present", "stamp_present"])
    validate_week_record(week)
    return created


def validate_week_record(week: WeekRecord) -> list[str]:
    """Derive date bounds and report sequence conflicts without repairing text."""
    entries = list(week.day_entries.order_by("source_page__page_index", "id"))
    dated = [entry.date for entry in entries if entry.date]
    week.start_date = min(dated) if dated else None
    week.end_date = max(dated) if dated else None
    warnings = []
    previous_weekday = None
    for entry in entries:
        expected = WEEKDAYS[entry.date.weekday()] if entry.date else ""
        if entry.weekday and expected and entry.weekday != expected:
            warnings.append({
                "entry_id": entry.id, "type": "weekday_date_mismatch",
                "weekday_text": entry.weekday, "date_weekday": expected,
            })
        if entry.weekday:
            current_index = WEEKDAYS.index(entry.weekday)
            if previous_weekday is not None and current_index < previous_weekday:
                warnings.append({"entry_id": entry.id, "type": "weekday_sequence_decreased"})
            previous_weekday = current_index
    week.sequence_warnings = warnings
    week.save(update_fields=["start_date", "end_date", "sequence_warnings"])
    return warnings


def persist_fact_candidate(project, candidate: dict[str, Any], transcript: str, entries=()):
    valid, error = validate_fact_candidate(candidate, transcript)
    if not valid:
        logger.warning("Rejected fact candidate for project %s: %s", project.pk, error)
        return None, error
    if candidate["provenance"] == "INFERRED":
        status = "proposed"
    else:
        status = "proposed"
    fact = Fact.objects.create(
        project=project, kind=candidate["kind"], text=candidate["text"],
        provenance=candidate["provenance"], evidence_quote=candidate["evidence_quote"],
        inference_reason=candidate.get("inference_reason", ""), status=status,
    )
    fact.source_entry_ids.set(entries)
    return fact, ""


def material_sufficiency(project, minimum_activities: int = 2) -> dict[str, Any]:
    """Report material sufficiency from confirmed facts, reviewed logbook entries, or day records."""
    pages = list(LogbookPage.objects.filter(extracted_page__document__project_id=project.id).order_by("page_index"))
    blank_pages = [page.page_index for page in pages if not (page.reviewed_text or "").strip()]
    confirmed_facts = list(Fact.objects.filter(project_id=project.id, status="confirmed").values("kind", "source_field"))
    confirmed_activities = sum(1 for f in confirmed_facts if f["kind"] == "activity")
    # Prefer confirmed Facts; fall back to logbook entries/day records with substantive text
    # so users who have uploaded/reviewed entries are not blocked by a provenance gap.
    try:
        from .models import LogbookEntry
        entry_qs = LogbookEntry.objects.filter(project_id=project.id)
        try:
            entry_count = entry_qs.exclude(verified_text='', raw_text='', activity_summary='').count()
        except Exception:
            entry_count = entry_qs.count()
    except Exception:
        entry_count = 0
    day_count = DayEntry.objects.filter(week_record__project_id=project.id).exclude(text='').count()
    activity_count = max(confirmed_activities, entry_count, day_count)
    from .templates import get_section_requirements
    manifest = get_section_requirements()
    section_fact_kinds = {
        "ch1_scope": ["organisation_detail"], "ch2_history": ["organisation_detail"],
        "ch2_objectives": ["organisation_detail"], "ch2_structure": ["organisation_detail"],
        "ch2_organogram": ["organisation_detail"], "ch3_duties": ["duty"],
        "ch3_activities": ["activity"], "ch3_skills": ["skill"],
        "ch3_tools": ["tool", "equipment"], "ch3_challenges": ["challenge"],
        "ch3_solutions": ["solution"], "ch4_summary": ["activity", "duty", "skill"],
        "ch4_conclusion": ["activity", "duty", "skill"],
        "ch4_recommendations": ["recommendation"], "dedication": ["personal_statement"],
        "acknowledgement": ["person", "personal_statement"],
    }
    enrichment_questions = {
        "ch2_history": "What are the organisation's confirmed history and key milestones?",
        "ch2_objectives": "What objectives has the organisation stated in a source you can identify?",
        "ch2_structure": "Which roles or units report to one another in the organisation?",
        "ch2_organogram": "Can you provide the reporting tree or upload an organogram image?",
        "ch3_duties": "What duties did you personally perform, with a source entry or your confirmation?",
        "ch3_skills": "Which skills did you acquire and can personally confirm?",
        "ch3_challenges": "What challenge did you personally encounter, if any?",
        "ch3_solutions": "How was a recorded challenge addressed? Describe only what happened.",
        "ch4_recommendations": "What specific, observed problem should a recommendation address?",
    }
    by_section = {}
    for section in manifest["sections"]:
        key = section["key"]
        kinds = set(section_fact_kinds.get(key, []))
        if not kinds:
            count = 0
        elif key == "ch3_challenges":
            count = sum(1 for f in confirmed_facts if f["kind"] in kinds and f["source_field"] != "challenge_pairs:no_challenges")
        else:
            count = sum(1 for f in confirmed_facts if f["kind"] in kinds)
        status_value = "fixed_text" if section["source"] == "FIXED_BOILERPLATE" else (
            "confirmed_material" if count else ("insufficient_material" if section["source"] in {"LOGBOOK", "INFERRED", "CONFIRMED_CONTENT"} else "needs_student_input")
        )
        if key == "ch3_activities":
            status_value = "sufficient" if activity_count >= minimum_activities else "insufficient_material"
            count = activity_count
        by_section[key] = {
            "label": section["title"], "required": section.get("required", False),
            "source": section["source"], "confirmed": count, "pages": len(pages), "status": status_value,
            "enrichment_question": enrichment_questions.get(key, ""),
        }
    questions = []
    if activity_count < minimum_activities:
        questions.append("What other dated activities are recorded in your logbook? Confirm each from the page image or transcript.")
    if by_section["ch3_tools"]["confirmed"] == 0:
        questions.append("Did you use any specific tools or equipment? Enter names only if you can confirm them.")
    if by_section["ch3_challenges"]["confirmed"] == 0:
        questions.append("What challenge did you personally encounter during the placement, if any?")
    if by_section["ch3_solutions"]["confirmed"] == 0 and by_section["ch3_challenges"]["confirmed"]:
        questions.append("How was the recorded challenge addressed? Describe only what happened.")
    for key, question in enrichment_questions.items():
        section = by_section.get(key, {})
        if section.get("required") and section.get("confirmed", 0) == 0 and question not in questions:
            questions.append(question)
    transcript_review = {"clarifying_questions": [], "spelling_suggestions": []}
    for entry in DayEntry.objects.filter(week_record__project_id=project.id).order_by("id"):
        review = review_ambiguities(entry.text)
        transcript_review["clarifying_questions"].extend(review["clarifying_questions"])
        transcript_review["spelling_suggestions"].extend(review["spelling_suggestions"])
    return {
        "status": "insufficient_material" if activity_count < minimum_activities else "material_available",
        "blank_pages_first": blank_pages,
        "sections": by_section,
        "activity_entries_across_pages": f"{activity_count} confirmed activity entr{'y' if activity_count == 1 else 'ies'} across {len(pages)} pages",
        "targeted_questions": questions,
        **transcript_review,
    }


def extraction_prompt(transcript: str) -> str:
    """Constrained prompt; validation remains mandatory after model output."""
    return ("Extract only facts explicitly supported by the reviewed transcript. Return JSON matching the supplied schema. "
            "For every fact, evidence_quote must be an exact substring. Do not correct spelling, infer tools, quantities, outcomes, "
            "projects, people, or activities. Put ambiguity in a clarifying_questions array. Mark deductions INFERRED with a reason; "
            "they require student confirmation. Transcript:\n" + transcript)


def review_ambiguities(text: str) -> dict[str, Any]:
    """Return questions/suggestions without modifying the reviewed transcript."""
    questions = []
    if re.search(r"\b(set ?up|setup|installation|configured?)\b", text, re.I):
        questions.append(
            f'Please clarify what action you performed in “{text.strip()}” (for example, built, configured, or used the system).'
        )
    suggestions = []
    typo = re.search(r"\bredution\b", text, re.I)
    if typo:
        suggestions.append({"source": typo.group(0), "suggestion": "Reduction", "accepted": False})
    return {"clarifying_questions": questions, "spelling_suggestions": suggestions}
