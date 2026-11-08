"""Pre-preview and pre-export quality checks for the final v2 document model."""
from __future__ import annotations

import re
import shutil
import subprocess
from html import unescape

from docx import Document
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.shared import Pt
from docx.oxml.ns import qn
from .templates import LASUSTECH_CS_V2, get_template_spec


PLACEHOLDERS = (
    (re.compile(r"\[[^\]]+\]"), "placeholder_text", "Remove bracketed placeholder text."),
    (re.compile(r"\bINPUT NEEDED\b", re.I), "input_needed", "Complete or remove the input-needed text."),
    (re.compile(r"\bTBD\b", re.I), "tbd", "Replace TBD with confirmed information or remove it."),
    (re.compile(r"\bstandard toolkit\b", re.I), "generic_filler", "Replace generic toolkit text with a confirmed tool or remove it."),
)
GENERIC_FILLER = (
    re.compile(r"\bmorning briefings?\b", re.I),
    re.compile(r"\bfast-paced environment\b", re.I),
    re.compile(r"\bcommendable culture of student mentorship\b", re.I),
    re.compile(r"\bcolleagues in the Engineering\s*/\s*IT Unit\b", re.I),
    re.compile(r"\bMika Labs Internal Documentation\b", re.I),
)
# Banned phrases from the coordinator spec — never acceptable in the final report
BANNED_PHRASES = (
    re.compile(r"\bstrict compliance\b", re.I),
    re.compile(r"\bcomprehensive technical duties\b", re.I),
    re.compile(r"\bindustry-standard tools\b", re.I),
    re.compile(r"\bhardware/software deployments\b", re.I),
    re.compile(r"\bspecialized technical projects\b", re.I),
    re.compile(r"\breputable organization\b", re.I),
    re.compile(r"\bcommendable\b", re.I),
    re.compile(r"\bpersonal protective equipment\b", re.I),
    re.compile(r"\bSignificantly, this\b", re.I),
)
# Instructions addressed to the student — must never appear in the report body
INSTRUCTION_TO_STUDENT = (
    re.compile(r"\b(?:click|tap|press|enter|fill in|fill out|type|select|choose|upload|paste|replace)\b", re.I),
    re.compile(r"\b(?:your answer|your response|your input|your details|you may|you should|you can|you must|you need to)\b", re.I),
)
# Text that talks about the document / generation system itself — must never appear
DOCUMENT_ITSELF = (
    re.compile(r"\bgenerated automatically\b", re.I),
    re.compile(r"\bduring export\b", re.I),
    re.compile(r"\btable of contents is generated\b", re.I),
    re.compile(r"\bformal table of contents\b", re.I),
    re.compile(r"\bleaked system\b", re.I),
)
# Scheme name must be written identically everywhere
SCHEME_NAME_VARIANTS = (
    re.compile(r"\bs\.?i\.?w\.?e\.?s\b", re.I),
    re.compile(r"\bsiwes\b", re.I),
)

SECOND_PERSON = re.compile(r"\b(?:you|your|you're|you've|yourself)\b", re.I)
UNSUPPORTED_CLAIM = re.compile(r"\b(?:verified|successfully achieved|objectives were successfully|skills were significantly enhanced)\b", re.I)
US_SPELLING = re.compile(r"\b(?:organization|organizations|organize|organized|organizing|analyze|analyzed|center|centers|color|colors|labor|laboring|catalog|catalogs|traveling|canceled)\b", re.I)
US_TO_GB_MAP = {
    "organization": "organisation",
    "organizations": "organisations",
    "organize": "organise",
    "organized": "organised",
    "organizing": "organising",
    "analyze": "analyse",
    "analyzed": "analysed",
    "analyzing": "analysing",
    "center": "centre",
    "centers": "centres",
    "color": "colour",
    "colors": "colours",
    "labor": "labour",
    "laboring": "labouring",
    "catalog": "catalogue",
    "catalogs": "catalogues",
    "traveling": "travelling",
    "canceled": "cancelled",
}
SCHEME_NORMALIZE_RE = re.compile(r"\b(?:s\.i\.w\.e\.s\.?|siwes)\b", re.I)

def _match_case(source: str, target: str) -> str:
    """Preserve casing when replacing words."""
    if source.isupper():
        return target.upper()
    if source and source[0].isupper():
        return target.capitalize()
    return target.lower()

def autofix_text(text: str, is_body_paragraph: bool = False, section_key: str = None) -> str:
    """Silently auto-fix safe text issues: double spaces, final punctuation, US spellings, scheme name."""
    if not text or not isinstance(text, str):
        return text

    # 1. Double spaces and excess tabs
    fixed = re.sub(r"[ \t]{2,}", " ", text)

    # 2. Scheme-name spelling (normalize to SIWES), except references section
    if section_key != "references":
        fixed = SCHEME_NORMALIZE_RE.sub("SIWES", fixed)

    # 3. Spelling variants: US to en-GB
    def _replace_spelling(match):
        raw = match.group(0)
        lower = raw.lower()
        if lower in US_TO_GB_MAP:
            return _match_case(raw, US_TO_GB_MAP[lower])
        return raw

    fixed = US_SPELLING.sub(_replace_spelling, fixed)

    # 4. Final punctuation on body paragraphs
    if is_body_paragraph and fixed.strip():
        stripped = fixed.strip()
        # Exclude specific non-prose sections or signature lines
        if section_key not in {"title_page", "ch2_organogram", "ch3_tools"}:
            if stripped.endswith((",", ";", ":")):
                stripped = stripped[:-1].rstrip() + "."
                fixed = stripped
            elif not TERMINAL.search(stripped):
                fixed = stripped + "."

    return fixed

def autofix_document_model(model: dict) -> bool:
    """Silently auto-fix text nodes inside document_model in-place. Returns True if modified."""
    if not isinstance(model, dict) or not isinstance(model.get("sections"), list):
        return False
    modified = False
    for section in model.get("sections", []):
        if not isinstance(section, dict):
            continue
        sec_key = section.get("key", "")
        # Section title and chapter title
        if "title" in section and isinstance(section["title"], str):
            fixed_title = autofix_text(section["title"], is_body_paragraph=False, section_key=sec_key)
            if fixed_title != section["title"]:
                section["title"] = fixed_title
                modified = True
        nodes = section.get("nodes", [])
        if not isinstance(nodes, list):
            continue
        for node in nodes:
            if not isinstance(node, dict):
                continue
            node_type = node.get("type")
            is_para = (node_type == "paragraph")
            raw_text = node.get("text")
            if raw_text and isinstance(raw_text, str):
                fixed = autofix_text(raw_text, is_body_paragraph=is_para, section_key=sec_key)
                if fixed != raw_text:
                    node["text"] = fixed
                    modified = True
            # Also check children if any
            for child in node.get("children", []):
                if isinstance(child, dict) and isinstance(child.get("text"), str):
                    child_fixed = autofix_text(child["text"], is_body_paragraph=is_para, section_key=sec_key)
                    if child_fixed != child["text"]:
                        child["text"] = child_fixed
                        modified = True
    return modified

def autofix_report_content(report, save: bool = True) -> bool:
    """Silently auto-fix safe quality issues in a report's document_model and provenance paragraphs."""
    if not report or not report.document_model:
        return False
    modified = autofix_document_model(report.document_model)
    # Also update provenance paragraphs if they exist
    try:
        from .models import ReportParagraph
        for paragraph in report.provenance_paragraphs.all():
            fixed_text = autofix_text(paragraph.text, is_body_paragraph=True, section_key=paragraph.section_key)
            if fixed_text != paragraph.text:
                paragraph.text = fixed_text
                if save:
                    paragraph.save(update_fields=["text"])
                modified = True
    except Exception:
        pass

    if modified and save:
        report.save(update_fields=["document_model"])
    return modified
TECHNICAL_ALLOWLIST = {
    "program", "programming", "centerpiece", "center", "centers", "catalog",
    "catalogs", "analyzed", "analyze", "license", "licenses", "licensed",
    "database", "router", "server", "browser", "software", "hardware",
    "html", "css", "javascript", "python", "django", "react", "linux",
}
TERMINAL = re.compile(r"[.!?][\"')’”\]]*$")
DATE_RE = re.compile(r"\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2} [A-Z][a-z]+ \d{4}\b")
CHAPTER_TITLES = {
    item["key"]: item.get("chapter_title", "") for item in LASUSTECH_CS_V2["sections"]
}
ENRICHMENT_QUESTIONS = {
    "ch2_history": "What does the organisation do, and when or how did it begin?",
    "ch2_objectives": "What are the organisation’s main objectives?",
    "ch2_structure": "Which roles or units make up its structure, and who leads them?",
    "ch2_organogram": "Can you confirm the reporting order shown in the organogram?",
    "ch3_duties": "What specific responsibilities did you carry out in your unit?",
    "ch3_activities": "Which additional activities are recorded in your reviewed logbook pages?",
    "ch3_skills": "Which skills from the proposed list can you confirm?",
    "ch3_tools": "Which tools or equipment did you personally use?",
    "ch3_challenges": "What real challenge did you encounter during the training?",
    "ch3_solutions": "What did you do in response to that challenge?",
    "ch4_summary": "Which confirmed activities or skills should the summary cover?",
    "ch4_conclusion": "What conclusion can you draw from the confirmed training record?",
    "ch4_recommendations": "What would have improved the training experience?",
}


class QualityGateError(Exception):
    def __init__(self, result):
        self.result = result
        super().__init__("Document quality gate blocked export.")


def _plain(value):
    return unescape(re.sub(r"<[^>]*>", " ", str(value or ""))).strip()


def _node_text(node):
    return " ".join(filter(None, [
        str(node.get("text", "")),
        str(node.get("attrs", {}).get("caption", "")),
        *[_node_text(child) for child in node.get("children", [])],
    ])).strip()


def _all_text(section):
    return "\n".join(_node_text(node) for node in section.get("nodes", []) if _node_text(node))


def _issue(code, message, section_key=None, severity="blocker", question=None):
    issue = {
        "code": code, "message": message, "severity": severity,
        "section_key": section_key,
        "anchor": f"#section-{section_key}" if section_key else "#report-quality",
    }
    if question:
        issue["question"] = question
    return issue


def _american_spellings_in_text(text, names):
    candidates = {
        match.group(0).casefold() for match in US_SPELLING.finditer(text)
        if match.group(0).casefold() not in TECHNICAL_ALLOWLIST | names
    }
    if not candidates:
        return set()
    checker = shutil.which("hunspell")
    command = [checker, "-l", "-d", "en_GB"] if checker else None
    if not command and shutil.which("aspell"):
        command = [shutil.which("aspell"), "list", "-l", "en_GB"]
    if not command:
        # Conservative fallback when a dictionary engine is unavailable.
        return {word for word in candidates if word.endswith(("ize", "ized", "izing")) or word in {"organization", "organizations", "center", "color", "labor"}}
    try:
        result = subprocess.run(command, input="\n".join(sorted(candidates)) + "\n", capture_output=True, text=True, timeout=3, check=False)
        return candidates.intersection(line.strip().casefold() for line in result.stdout.splitlines())
    except (OSError, subprocess.TimeoutExpired):
        return set()


def evaluate_report_quality(report, model=None):
    """Return student-readable blockers and warnings with section anchors."""
    template_version = getattr(report, "template_version", None) or (report.get("template_version") if isinstance(report, dict) else "")
    estimated_pages = getattr(report, "estimated_pages", None) or (report.get("estimated_pages", 0) if isinstance(report, dict) else 0)
    if not str(template_version).startswith("lasustech_cs:2."):
        return {"passed": True, "blockers": [], "warnings": [], "summary": {"total_pages": estimated_pages, "student_derived_pages": 0}}
    model = model or getattr(report, "document_model", None) or (report.get("document_model") if isinstance(report, dict) else {})
    if not isinstance(model, dict):
        blocker = _issue("invalid_document_model", "The report document model is malformed. Regenerate the report before preview or export.")
        return {"passed": False, "blockers": [blocker], "warnings": [], "summary": {
            "total_pages": estimated_pages or 0, "student_derived_pages": 0,
            "blocker_count": 1, "warning_count": 0,
        }}
    raw_sections = model.get("sections", [])
    if not isinstance(raw_sections, list):
        raw_sections = []
        model_error = True
    else:
        model_error = False
    invalid_entries = [section for section in raw_sections if not isinstance(section, dict)]
    sections = [section for section in raw_sections if isinstance(section, dict)]
    definitions = LASUSTECH_CS_V2["sections"]
    by_key = {section.get("key"): section for section in sections}
    blockers, warnings = [], []
    from .models import Fact
    report_proj = getattr(report, "project", None) or (report.get("project") if isinstance(report, dict) else None)
    if report_proj:
        facts_by_id = {fact.id: fact for fact in Fact.objects.filter(project=report_proj)}
        name_allowlist = {
            word.casefold() for value in (report_proj.organization_name, report_proj.department)
            if value for word in re.findall(r"[A-Za-z]+", value)
        }
        for fact_text in Fact.objects.filter(project=report_proj, status="confirmed").values_list("text", flat=True):
            name_allowlist.update(
                word.casefold() for word in re.findall(r"\b[A-Z][A-Za-z0-9]{2,}\b", fact_text)
                if word not in {"The", "This", "That", "During", "After", "Before", "Organization", "Organizations", "Organized", "Organizing", "Analyze", "Analyzed", "Center", "Centers", "Color", "Colors", "Labor", "Catalog", "Catalogs", "Traveling", "Canceled"}
            )
        sidecars = list(getattr(report, "provenance_paragraphs", []).all().prefetch_related("facts")) if hasattr(report, "provenance_paragraphs") else []
    else:
        facts_by_id = {}
        name_allowlist = set()
        sidecars = []
    edited_texts = {}
    for paragraph in sidecars:
        if paragraph.origin == "STUDENT_EDITED":
            edited_texts.setdefault(paragraph.section_key, set()).add(_plain(paragraph.text).casefold())

    def add(target, *args, **kwargs):
        target.append(_issue(*args, **kwargs))

    if model_error or invalid_entries:
        add(blockers, "invalid_document_sections", "The report has malformed sections. Regenerate it before preview or export.", None)
    template_opts = getattr(report, "template_options", None) or (report.get("template_options") if isinstance(report, dict) else {})
    options = template_opts if isinstance(template_opts, dict) else {}
    tmpl_snap = getattr(report, "template_snapshot", None) or (report.get("template_snapshot") if isinstance(report, dict) else {})
    template_snapshot = tmpl_snap if isinstance(tmpl_snap, dict) else {}
    p_breakdown = getattr(report, "page_estimate_breakdown", None) or (report.get("page_estimate_breakdown") if isinstance(report, dict) else {})
    page_breakdown = p_breakdown if isinstance(p_breakdown, dict) else {}

    seen_titles = {}
    found_dates = {}
    date_styles = set()
    expected_titles = {item["key"]: item["title"] for item in definitions}
    scheme_seen = {}
    for key, section in by_key.items():
        if key not in expected_titles:
            add(blockers, "unknown_section", "This section is not part of the selected template.", key)
            continue
        if section.get("title") != expected_titles[key]:
            add(blockers, "heading_mismatch", f"Heading must read “{expected_titles[key]}”.", key)
        chapter_title = CHAPTER_TITLES.get(key, "")
        if chapter_title and section.get("chapter_title", "") != chapter_title:
            add(blockers, "chapter_heading_mismatch", "Chapter heading does not match the template wording.", key)
        title_key = re.sub(r"\s+", " ", section.get("title", "")).casefold()
        if title_key in seen_titles:
            add(blockers, "duplicate_heading", "This heading appears more than once.", key)
        seen_titles[title_key] = key

        text = _all_text(section)
        for pattern, code, message in PLACEHOLDERS:
            if pattern.search(text):
                add(blockers, code, message, key)
        for pattern in GENERIC_FILLER:
            match = pattern.search(text)
            if match and not Fact.objects.filter(project=report.project, status="confirmed", text__icontains=match.group(0)).exists():
                add(blockers, "unsupported_generic_filler", "Remove generic workplace details unless they appear in a confirmed Fact.", key)
        for pattern in BANNED_PHRASES:
            if pattern.search(text):
                add(blockers, "banned_phrase", "Remove this banned phrase from the report.", key)
        for pattern in INSTRUCTION_TO_STUDENT:
            if pattern.search(text):
                add(blockers, "instruction_to_student", "Remove instructions addressed to the student.", key)
        for pattern in DOCUMENT_ITSELF:
            if pattern.search(text):
                add(blockers, "document_itself", "Remove text that describes the document or export system.", key)
        # Scheme name consistency: track SIWES spelling variants used in this section
        # Task 9: Exclude references section from scheme-name consistency check
        if key != "references":
            scheme_variants_found = [p.pattern for p in SCHEME_NAME_VARIANTS if p.search(text)]
            if scheme_variants_found:
                scheme_seen.setdefault(key, []).extend(scheme_variants_found)
        if SECOND_PERSON.search(text):
            add(blockers, "second_person", "Rewrite instructions that address the reader as “you”.", key)
        for found_date in DATE_RE.findall(text):
            found_dates.setdefault(key, set()).add(found_date)
            date_styles.add("iso" if re.fullmatch(r"\d{4}-\d{2}-\d{2}", found_date) else "day_month_year")
        for claim in UNSUPPORTED_CLAIM.finditer(text):
            supported = False
            if claim.group(0).casefold() == "verified":
                for paragraph in report.provenance_paragraphs.filter(section_key=key).prefetch_related("facts"):
                    for fact in paragraph.facts.all():
                        if fact.source_entry_ids.filter(source_page__signature_present=True).exists():
                            supported = True
                            break
                    if supported:
                        break
            else:
                supported = bool(report_proj and Fact.objects.filter(
                    project=report_proj, status="confirmed",
                    text__icontains=claim.group(0),
                ).exists())
            if not supported:
                add(blockers, "unsupported_success_claim", "Remove this verification or success claim unless a confirmed Fact or supervisor signature supports it.", key)

        section_nodes = section.get("nodes", [])
        for node_index, node in enumerate(section_nodes):
            if node.get("type") == "heading" and not any(_node_text(sibling) for sibling in section_nodes[node_index + 1:]):
                add(blockers, "heading_without_body", "This heading has no body text beneath it.", key)
            if node.get("type") != "paragraph":
                continue
            paragraph_text = _node_text(node)
            if not paragraph_text:
                continue
            dept_name = getattr(report_proj, "department", "") if report_proj else ""
            signature_or_label = key == "certification" and (
                paragraph_text.startswith("_") or paragraph_text.upper().startswith("DATE:")
                or paragraph_text in {"Industrial-Based Supervisor", f"SIWES Coordinator - {dept_name}", f"HOD, {dept_name}"}
            )
            requires_terminal = key not in {"title_page", "ch2_organogram", "ch3_tools"} and not signature_or_label
            if requires_terminal and not TERMINAL.search(paragraph_text):
                add(blockers, "truncated_paragraph", "This paragraph may be incomplete; finish the sentence or remove it.", key)
            fragments = [part.strip() for part in re.split(r"(?<=[.!?])\s+", paragraph_text) if part.strip()]
            if requires_terminal and any(not TERMINAL.search(fragment) for fragment in fragments):
                add(blockers, "unterminated_sentence", "Every sentence must end with terminal punctuation.", key)
            provenance = node.get("provenance", {})
            source_type = provenance.get("source_type")
            source_ids = provenance.get("source_ids", [])
            is_student_edit = paragraph_text.casefold() in edited_texts.get(key, set())
            if source_type not in {"FIXED_BOILERPLATE", "GENERATED_FROM_MODEL"} and not source_ids and not is_student_edit:
                add(blockers, "missing_provenance", "This paragraph is not linked to confirmed source Facts or a student edit.", key)
            for fact_id in source_ids:
                fact = facts_by_id.get(fact_id)
                if not fact:
                    other_fact = Fact.objects.filter(id=fact_id).first()
                    if other_fact and report_proj and other_fact.project_id != report_proj.id:
                        add(blockers, "cross_project_fact_reference", f"This paragraph refers to Fact {fact_id} which belongs to a different project.", key)
                    else:
                        add(blockers, "invalid_fact_reference", "This paragraph refers to a Fact that is missing or belongs to another project.", key)
                elif fact.status != "confirmed" and not is_student_edit:
                    add(blockers, "unconfirmed_fact_reference", "Confirm or remove the Fact supporting this paragraph.", key)

        for word in _american_spellings_in_text(text, name_allowlist):
            add(warnings, "en_us_spelling", f"Use en-GB spelling for “{word}”.", key, severity="warning")
        if re.search(r"\b(?:will|shall)\s+\w+ed\b", text, re.I):
            add(warnings, "tense_voice", "Check that activity descriptions use a consistent past tense and first-person voice.", key, severity="warning")

    for definition in definitions:
        key = definition["key"]
        section = by_key.get(key)
        content = _all_text(section) if section else ""
        is_generated_toc = key == "table_of_contents" and options.get("toc_enabled", True)
        if key == "table_of_contents" and not options.get("toc_enabled", True):
            if section:
                add(blockers, "disabled_optional_section_present", "Remove the disabled table of contents section.", key)
            continue
        if definition.get("required") and not content:
            add(blockers, "required_section_empty", f"Required section “{definition['title']}” is empty.", key)
        if not definition.get("required") and section and not content and not is_generated_toc:
            add(blockers, "empty_optional_section", "Remove this empty optional section from the document.", key)

    ordered = [section for section in sections if section.get("key") in expected_titles]
    expected_positions = [item["key"] for item in definitions if item["key"] in by_key]
    actual_positions = [item.get("key") for item in ordered]
    if actual_positions != expected_positions:
        add(blockers, "section_order", "Sections are not in the order required by the selected template.", None)

    # Scheme name consistency: SIWES must be spelled identically everywhere
    scheme_variants_by_section = {}
    for section_key, variants in scheme_seen.items():
        for v in variants:
            normalized = re.sub(r"[\s./]+", "", v).casefold()
            scheme_variants_by_section.setdefault(normalized, []).append(section_key)
    if len(scheme_variants_by_section) > 1:
        add(blockers, "scheme_name_inconsistent", "The scheme name is spelled inconsistently across sections; use one spelling everywhere.", None)

    project = report_proj
    start = getattr(project, "training_start_date", None) if project else None
    end = getattr(project, "training_end_date", None) if project else None
    if start and end and start > end:
        add(blockers, "training_date_order", "The training start date is after the end date.", "ch1_duration")
    if start and end:
        expected_date_strings = {start.isoformat(), end.isoformat(), start.strftime("%-d %B %Y"), end.strftime("%-d %B %Y")}
        for key in ("title_page", "certification", "ch1_scope", "ch4_summary"):
            dates_here = found_dates.get(key, set())
            if dates_here and not dates_here.issubset(expected_date_strings):
                add(blockers, "date_mismatch", "Dates here do not match the confirmed training period.", key)
        duration_days = (end - start).days + 1
        duration = f"{duration_days // 7} weeks and {duration_days % 7} days" if duration_days >= 7 else f"{duration_days} days"
        duration_text = _all_text(by_key.get("ch1_duration", {}))
        if duration_text and duration not in duration_text:
            add(blockers, "duration_mismatch", "The stated training duration does not match the confirmed dates.", "ch1_duration")
    if len(date_styles) > 1:
        add(warnings, "inconsistent_date_format", "Use one date format consistently throughout the report.", None, severity="warning")

    formatting = model.get("formatting", {})
    formatting = formatting if isinstance(formatting, dict) else {}
    if (
        formatting.get("font_family") != "Times New Roman"
        or formatting.get("font_size_pt") != 12
        or formatting.get("line_spacing") != 1.5
        or formatting.get("alignment") != "justified"
        or formatting.get("chapter_heading", {}).get("lines") != 2
        or formatting.get("chapter_heading", {}).get("bold") is not True
        or formatting.get("chapter_heading", {}).get("uppercase") is not True
        or formatting.get("chapter_heading", {}).get("alignment") != "center"
    ):
        add(blockers, "formatting_spec", "Document model font, spacing, alignment, or chapter-heading settings do not match the template.", None)
    format_snapshot = template_snapshot.get("formatting_spec", {})
    pagination = format_snapshot.get("pagination", {}) if isinstance(format_snapshot, dict) else {}
    if (pagination.get("front_matter") != "lowerRoman" or pagination.get("main_body") != "decimal"
            or pagination.get("main_body_restart") != 1 or pagination.get("page_label") != "Page {number}"):
        add(blockers, "pagination_spec", "Page numbering settings do not match the selected template.", None)
    if options.get("toc_enabled", True) and "table_of_contents" not in by_key:
        add(blockers, "toc_missing", "The enabled table of contents is missing.", "table_of_contents")

    # Unconfirmed inferred facts are review warnings; they do not invalidate unrelated confirmed prose.
    from .models import Fact
    for paragraph in sidecars:
        if not paragraph.text.strip() or paragraph.origin == "STUDENT_EDITED":
            continue
        linked = list(paragraph.facts.all())
        if not linked:
            add(blockers, "paragraph_fact_link_missing", "This generated paragraph has no supporting Fact.", paragraph.section_key)
        elif any(fact.id not in facts_by_id for fact in linked):
            add(blockers, "paragraph_fact_invalid", "This paragraph refers to a Fact outside this project.", paragraph.section_key)
        elif any(fact.status != "confirmed" for fact in linked):
            add(blockers, "unconfirmed_fact_used", "Confirm or remove the Fact supporting this paragraph.", paragraph.section_key)
    inferred = Fact.objects.filter(project=project, provenance="INFERRED", status="proposed")
    for fact in inferred:
        if fact.report_paragraphs.filter(report=report).exists():
            add(warnings, "unconfirmed_inference", "An inferred Fact is still unconfirmed; confirm it or remove its paragraph.", None, severity="warning")
            break

    if inferred.exists() and not any(issue["code"] == "unconfirmed_inference" for issue in warnings):
        add(warnings, "unconfirmed_inference", "Unconfirmed inferred Facts remain in the project; confirm or remove them before relying on them.", None, severity="warning")

    total_pages = getattr(report, "estimated_pages", None) or (report.get("estimated_pages", 0) if isinstance(report, dict) else 0) or 0
    student_words = page_breakdown.get("student_derived_words", 0)
    if student_words < 100:
        add(warnings, "low_student_content", "The report contains very little student-derived content; add confirmed detail where available.", None, severity="warning")
    for section in sections:
        key = section.get("key")
        definition = next((item for item in definitions if item["key"] == key), None)
        if definition and definition.get("required") and definition.get("source") != "FIXED_BOILERPLATE":
            if len(_all_text(section).split()) < 20:
                add(
                    warnings, "thin_section", f"“{definition['title']}” has limited student-derived detail.",
                    key, severity="warning", question=ENRICHMENT_QUESTIONS.get(key),
                )

    # Deduplicate and group blockers: max 5 grouped blockers shown at once
    raw_blockers = blockers
    seen_blockers = set()
    deduped_blockers = []
    for b in raw_blockers:
        b_key = (b.get("code"), b.get("section_key"), b.get("message"))
        if b_key not in seen_blockers:
            seen_blockers.add(b_key)
            deduped_blockers.append(b)

    blocker_groups = {}
    for b in deduped_blockers:
        code = b.get("code")
        if code not in blocker_groups:
            blocker_groups[code] = {
                "code": code,
                "message": b.get("message"),
                "section_key": b.get("section_key"),
                "severity": b.get("severity", "blocker"),
                "anchor": b.get("anchor"),
                "count": 1,
                "occurrences": [b],
            }
        else:
            blocker_groups[code]["count"] += 1
            blocker_groups[code]["occurrences"].append(b)

    grouped_blockers = []
    for code, group in blocker_groups.items():
        if group["count"] > 1:
            group["message"] = f"{group['message']} ({group['count']} places)"
        grouped_blockers.append(group)

    total_blocker_count = len(grouped_blockers)
    capped_blockers = grouped_blockers[:5]
    more_blockers_count = max(0, total_blocker_count - 5)

    # Deduplicate and organize warnings
    seen_warnings = set()
    deduped_warnings = []
    for w in warnings:
        w_key = (w.get("code"), w.get("section_key"), w.get("message"))
        if w_key not in seen_warnings:
            seen_warnings.add(w_key)
            deduped_warnings.append(w)

    needs_more_detail = [w for w in deduped_warnings if w.get("code") == "thin_section"][:3]
    ways_to_improve = [w for w in deduped_warnings if w.get("code") != "thin_section"]

    return {
        "passed": not raw_blockers,
        "blockers": capped_blockers,
        "raw_blockers": raw_blockers,
        "total_blockers_count": total_blocker_count,
        "more_blockers_count": more_blockers_count,
        "hidden_blocker_count": more_blockers_count,
        "warnings": deduped_warnings[:10],
        "needs_more_detail": needs_more_detail,
        "ways_to_improve": ways_to_improve,
        "summary": {
            "total_pages": total_pages,
            "student_derived_pages": round(student_words / 350, 1),
            "student_derived_words": student_words,
            "blocker_count": total_blocker_count,
            "more_blockers_count": more_blockers_count,
            "hidden_blocker_count": more_blockers_count,
            "warning_count": len(deduped_warnings),
        },
    }


def require_report_quality(report):
    result = evaluate_report_quality(report)
    if not result["passed"]:
        raise QualityGateError(result)
    return result


def validate_docx_artifact(report, path):
    result = require_report_quality(report)
    issues = []

    # --- LOGO QUALITY GATE (all templates) ---
    # Cover must contain exactly one centred inline logo image with alt text,
    # within the configured size range. Logo must not appear on any other page.
    spec = get_template_spec(code="lasustech-standard", version="1.0.0")
    logo_cfg = spec.get("institution_asset", {}).get("logo", {})
    expected_alt = logo_cfg.get("alt_text", "")
    width_cm = float(logo_cfg.get("width_cm", 3.2))
    width_cm_min = width_cm * 0.95
    width_cm_max = width_cm * 1.05
    # 1 cm = 360000 EMU
    width_emu_min = width_cm_min * 360000
    width_emu_max = width_cm_max * 360000

    document = Document(str(path))
    body = document.element.body

    cover_images = []
    other_images = []
    section_index = 0  # section 0 = cover

    for child in body.iterchildren():
        tag = child.tag
        if tag == qn('w:p'):
            for drawing in child.iter(qn('w:drawing')):
                blip = drawing.find('.//' + qn('a:blip'))
                if blip is None:
                    continue
                # Centering check
                p_pr = child.find(qn('w:pPr'))
                jc = p_pr.find(qn('w:jc')) if p_pr is not None else None
                is_centered = jc is not None and jc.get(qn('w:val')) == 'center'
                # Alt text check (wp:docPr is the standard location; keep w:descr fallback)
                doc_pr = drawing.find('.//' + qn('wp:docPr'))
                alt_text = ''
                if doc_pr is not None:
                    alt_text = doc_pr.get('descr') or doc_pr.get('title') or ''
                if not alt_text:
                    descr = drawing.find('.//' + qn('w:descr'))
                    alt_text = descr.text if descr is not None else ''
                # Size check
                extent = drawing.find('.//' + qn('wp:extent'))
                cx = int(extent.get(qn('cx'))) if extent is not None else 0
                cy = int(extent.get(qn('cy'))) if extent is not None else 0
                aspect_ok = (cx > 0 and cy > 0 and abs(cx - cy) < cx * 0.02)
                size_ok = width_emu_min <= cx <= width_emu_max
                image_info = {
                    'centered': is_centered,
                    'alt_text': alt_text,
                    'width_cm': round(cx / 360000, 2) if cx else 0,
                    'height_cm': round(cy / 360000, 2) if cy else 0,
                    'aspect_ok': aspect_ok,
                    'size_ok': size_ok,
                }
                if section_index == 0:
                    cover_images.append(image_info)
                else:
                    other_images.append(image_info)
        elif tag == qn('w:sectPr'):
            section_index += 1

    if len(cover_images) != 1:
        _logo_issue = _issue(
            "cover_logo_missing_or_multiple",
            f"Cover must contain exactly one logo image, found {len(cover_images)}.",
            "title_page",
        )
        result.setdefault("blockers", []).append(_logo_issue)
        issues.append(_logo_issue)
    else:
        img = cover_images[0]
        if not img['centered']:
            _logo_issue = _issue(
                "cover_logo_not_centered",
                "Cover logo image is not horizontally centred.",
                "title_page",
            )
            result.setdefault("blockers", []).append(_logo_issue)
            issues.append(_logo_issue)
        if not img['size_ok']:
            _logo_issue = _issue(
                "cover_logo_wrong_size",
                f"Cover logo width is {img['width_cm']} cm; expected about {width_cm} cm.",
                "title_page",
            )
            result.setdefault("blockers", []).append(_logo_issue)
            issues.append(_logo_issue)
        if not img['aspect_ok']:
            _logo_issue = _issue(
                "cover_logo_aspect_ratio",
                "Cover logo image aspect ratio is distorted (width != height).",
                "title_page",
            )
            result.setdefault("blockers", []).append(_logo_issue)
            issues.append(_logo_issue)
        if expected_alt and img['alt_text'] != expected_alt:
            _logo_issue = _issue(
                "cover_logo_alt_text",
                f"Cover logo alt text mismatch: expected “{expected_alt}”, got “{img['alt_text']}”.",
                "title_page",
            )
            result.setdefault("blockers", []).append(_logo_issue)
            issues.append(_logo_issue)

    if other_images:
        _logo_issue = _issue(
            "logo_on_non_cover_pages",
            f"Logo image found on {len(other_images)} non-cover page(s); logo must appear only on the cover.",
            None,
        )
        result.setdefault("blockers", []).append(_logo_issue)
        issues.append(_logo_issue)

    logo_issues = list(issues)
    if not report.template_version.startswith("lasustech_cs:2."):
        if logo_issues:
            raise QualityGateError({**result, "passed": False, "blockers": result.get("blockers", []), "summary": {**result.get("summary", {}), "blocker_count": len(result.get("blockers", []))}})
        return result
    model = report.document_model if isinstance(report.document_model, dict) else {}
    options = report.template_options if isinstance(report.template_options, dict) else {}
    document = Document(str(path))
    issues = list(logo_issues)
    for section in document.sections:
        if any(abs(value.cm - 2.54) > 0.05 for value in (
            section.top_margin, section.right_margin, section.bottom_margin, section.left_margin,
        )):
            issues.append(_issue("docx_margins", "Page margins do not match the template.", None))
            break
    paragraphs = list(document.paragraphs)
    for table in document.tables:
        for row in table.rows:
            for cell in row.cells:
                paragraphs.extend(cell.paragraphs)
    for section in document.sections:
        paragraphs.extend(section.header.paragraphs)
        paragraphs.extend(section.footer.paragraphs)
    chapter_started = False
    expected_chapters = {
        section.get("chapter_title", "").replace("\n", " ").casefold()
        for section in model.get("sections", []) if isinstance(section, dict)
        if section.get("chapter_title", "")
    }
    heading_styles = {re.sub(r"\s+", " ", paragraph.text).strip(): paragraph.style.name for paragraph in document.paragraphs}
    for model_section in model.get("sections", []):
        if model_section.get("chapter") in range(1, 5):
            style_name = heading_styles.get(model_section.get("title", ""))
            if style_name != "Heading 2":
                issues.append(_issue("subheading_style", f"Heading “{model_section.get('title', '')}” is not using the template subheading style.", model_section.get("key")))
                break
    for paragraph in paragraphs:
        normalized_text = re.sub(r"\s+", " ", paragraph.text).strip().casefold()
        if normalized_text in expected_chapters:
            chapter_started = True
            if paragraph.alignment != WD_ALIGN_PARAGRAPH.CENTER or not all(run.bold for run in paragraph.runs if run.text.strip()):
                issues.append(_issue("chapter_heading_style", "Chapter headings must be bold and centred.", None))
        for run in paragraph.runs:
            if not run.text.strip():
                continue
            if run.font.name != "Times New Roman":
                issues.append(_issue("docx_font", "An exported text run is not Times New Roman.", None))
                break
            expected_size = 14 if paragraph.style.name == "Heading 1" else 12
            effective_size = run.font.size or paragraph.style.font.size
            if effective_size and effective_size != Pt(expected_size) and paragraph.style.name not in {"Header", "Footer"}:
                issues.append(_issue("docx_font_size", "Body text must be 12 pt and chapter headings must follow the template size.", None))
                break
        if chapter_started and paragraph.text.strip() and paragraph.style.name not in {"Heading 1", "Heading 2", "Header", "Footer"}:
            if paragraph.alignment != WD_ALIGN_PARAGRAPH.JUSTIFY:
                issues.append(_issue("docx_alignment", "Body paragraphs must be justified.", None))
                break
            if paragraph.paragraph_format.line_spacing not in (None, 1.5):
                issues.append(_issue("docx_line_spacing", "Body paragraphs must use 1.5 line spacing.", None))
                break
    if issues:
        raise QualityGateError({**result, "passed": False, "blockers": issues, "summary": {**result["summary"], "blocker_count": len(issues)}})
    if options.get("toc_enabled", True) and 'TOC \\o' not in document._element.xml:
        issues.append(_issue("toc_field_missing", "The exported table of contents field is missing.", "table_of_contents"))
    footer_text = " ".join(p.text for section in document.sections for p in section.footer.paragraphs)
    xml = "\n".join(section._sectPr.xml for section in document.sections)
    if "Page " not in footer_text or 'w:fmt="lowerRoman"' not in xml or 'w:fmt="decimal"' not in xml or 'w:start="1"' not in xml:
        issues.append(_issue("page_number_format", "Exported page numbering does not match roman front matter and Arabic “Page N” body numbering.", None))
    first_section = document.sections[0]
    cover_numbered = bool(options.get("cover_numbered", True))
    if first_section.different_first_page_header_footer == cover_numbered:
        issues.append(_issue("cover_page_numbering", "Cover-page numbering does not match the selected template option.", "title_page"))
    first_footer_xml = (first_section.footer if cover_numbered else first_section.first_page_footer)._element.xml
    if cover_numbered and 'instr="PAGE"' not in first_footer_xml:
        issues.append(_issue("cover_page_numbering", "The selected template numbers the cover, but its page field is missing.", "title_page"))
    if not cover_numbered and 'instr="PAGE"' in first_footer_xml:
        issues.append(_issue("cover_page_numbering", "The cover is configured as unnumbered but contains a page field.", "title_page"))
    if issues:
        raise QualityGateError({**result, "passed": False, "blockers": issues, "summary": {**result["summary"], "blocker_count": len(issues)}})
    return result
