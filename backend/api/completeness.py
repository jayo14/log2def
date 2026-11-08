"""
Log2Def Completeness Checker & Date Validation Engine
Enforces Section 2.A and Section 2.D of docs/MVP_SCOPE.md:
- Inspects active institutional template requirements.
- Distinguishes between Required and Optional fields.
- Outputs Found, Missing, or Uncertain per field.
- Validates date ranges: start < end, logbook entries within training period.
- Blocks technical report generation while required fields are missing.
"""

from datetime import date
from typing import Dict, Any, List
import re
from .page_classifier import evaluate_project_pages
from .answer_validator import validate_answer_text


REQUIRED_STUDENT_FIELDS = [
    ('full_name', 'Full name', True, ['full_name']),
    ('matric_number', 'Matriculation number', True, ['matric_number']),
    ('university_name', 'Institution', True, ['university_name', 'institution']),
    ('department', 'Department', True, ['department']),
    ('organization_name', 'SIWES company / organisation', True, ['organization_name', 'company_name']),
    ('organization_address', 'Company address', True, ['organization_address', 'company_address']),
    ('training_start_date', 'Training start date', True, ['training_start_date', 'start_date']),
    ('training_end_date', 'Training end date', True, ['training_end_date', 'end_date']),
    # Optional fields that may stay blank
    ('placement_department', 'Department / unit at company', False, ['placement_department', 'department_unit']),
    ('industry_supervisor_name', 'Industry supervisor', False, ['industry_supervisor_name', 'industry_supervisor']),
    ('academic_supervisor_name', 'Institution supervisor', False, ['academic_supervisor_name', 'institution_supervisor']),
]


def validate_training_dates(
    start_date: date | None,
    end_date: date | None,
    logbook_entries: list = None
) -> Dict[str, Any]:
    """
    Validates SIWES training date constraints:
    1. start_date < end_date
    2. Logbook entry dates fall within [start_date, end_date]
    3. Requires explicit confirmation if duration < 4 weeks (28 days).
    """
    errors: List[str] = []
    warnings: List[str] = []
    requires_short_duration_confirmation = False
    out_of_period_entries: List[Dict[str, Any]] = []

    if isinstance(start_date, str) and start_date.strip():
        try:
            start_date = date.fromisoformat(start_date.strip()[:10])
        except Exception:
            start_date = None
    if isinstance(end_date, str) and end_date.strip():
        try:
            end_date = date.fromisoformat(end_date.strip()[:10])
        except Exception:
            end_date = None

    if start_date and end_date:
        if start_date >= end_date:
            errors.append(f"Training start date ({start_date}) must be before end date ({end_date}).")
        
        # Check if duration is unusually short (< 4 weeks) or long (> 52 weeks)
        days = (end_date - start_date).days
        if days < 28:
            warnings.append(f"Training duration ({days} days) is less than standard SIWES duration (usually 8-24 weeks).")
            requires_short_duration_confirmation = True
        elif days > 366:
            warnings.append(f"Training duration ({days} days) exceeds one year.")

    if logbook_entries and start_date and end_date:
        for entry in logbook_entries:
            ed = getattr(entry, 'entry_date', None) or (entry.get('entry_date') if isinstance(entry, dict) else None)
            if ed:
                if isinstance(ed, str):
                    try:
                        ed = date.fromisoformat(ed)
                    except ValueError:
                        continue
                if ed < start_date or ed > end_date:
                    eid = getattr(entry, 'id', None) or (entry.get('id') if isinstance(entry, dict) else None)
                    summary = str(getattr(entry, 'activity_summary', '') or (entry.get('activity_summary') if isinstance(entry, dict) else ''))
                    out_of_period_entries.append({
                        "id": eid,
                        "date": str(ed),
                        "summary": summary[:80]
                    })

        if out_of_period_entries:
            sample = ", ".join(e["date"] for e in out_of_period_entries[:3])
            warnings.append(
                f"Found {len(out_of_period_entries)} logbook entry/entries with dates outside the confirmed training period "
                f"({sample}...). These will be excluded from the report."
            )

    return {
        "is_valid": len(errors) == 0,
        "errors": errors,
        "warnings": warnings,
        "requires_short_duration_confirmation": requires_short_duration_confirmation,
        "out_of_period_entries": out_of_period_entries,
    }


def check_project_completeness(project) -> Dict[str, Any]:
    """
    Evaluates project completeness against institutional requirements.
    Outputs Found, Missing, or Uncertain per field.
    Determines whether the technical report can be safely generated.
    """
    field_reports: Dict[str, Any] = {}
    missing_required: List[str] = []
    uncertain_fields: List[str] = []

    # Existing v1 reports retain their original completeness contract. New
    # projects use the active v2 field manifest as the source of requirements.
    report = getattr(project, "report", None)
    is_v1 = bool(report and report.template_version.startswith("lasustech-standard:1."))
    if is_v1:
        requirements = REQUIRED_STUDENT_FIELDS
    else:
        from .templates import get_section_requirements
        manifest_fields = get_section_requirements()["required_fields"]
        mappings = {
            "student_name": ("Full name", ["full_name"]),
            "matric": ("Matriculation number", ["matric_number"]),
            "department": ("Department", ["department"]),
            "college": ("College", ["college"]),
            "organisation": ("Organisation", ["organization_name"]),
            "organisation_address": ("Organisation address", ["organization_address"]),
            "training_dates": ("Training dates", ["training_start_date", "training_end_date"]),
            "training_duration": ("Training duration", ["training_start_date", "training_end_date"]),
            "degree": ("Degree", ["degree"]),
        }
        requirements = [
            (key, mappings[key][0], field_spec.get("required", False), mappings[key][1])
            for key, field_spec in manifest_fields.items()
            if key in mappings and field_spec.get("source") == "STUDENT_PROVIDED"
        ]

    # 1. Check basic student & company fields from the selected manifest.
    for field_key, field_label, is_required, aliases in requirements:
        val = None
        for alias in aliases:
            v = getattr(project, alias, None)
            if v and not (field_key == "training_duration" and alias == "training_start_date"):
                val = v
                if field_key != "training_dates" and field_key != "training_duration":
                    break
                elif val and getattr(project, "training_start_date", None) and getattr(project, "training_end_date", None):
                    val = f"{project.training_start_date} to {project.training_end_date}"
                    break

        status = "Missing"
        confidence = 1.0

        if val:
            if isinstance(val, str) and val.strip():
                if any(marker in val for marker in ['[?]', '[unclear]', '???']):
                    status = "Uncertain"
                    confidence = 0.50
                    uncertain_fields.append(field_key)
                else:
                    status = "Found"
            elif isinstance(val, (date,)):
                status = "Found"

        if status == "Missing" and is_required:
            missing_required.append(field_key)

        field_reports[field_key] = {
            "key": field_key,
            "label": field_label,
            "required": is_required,
            "status": status,
            "value": str(val) if val is not None else None,
            "confidence": confidence,
        }

    # Section-level required inputs are part of the same v2 manifest. Once a
    # draft exists, empty required narrative sections are reported explicitly.
    if not is_v1 and report:
        from .templates import get_section_requirements
        manifest = get_section_requirements()
        for section in manifest["sections"]:
            if not section.get("required"):
                continue
            section_obj = report.sections.filter(section_key=section["key"]).first()
            content = getattr(section_obj, "content", "") or ""
            has_content = bool(re.sub(r"<[^>]*>", " ", content).strip())
            key = f"section:{section['key']}"
            field_reports[key] = {
                "key": key,
                "label": section["title"],
                "required": True,
                "status": "Found" if has_content else "Missing",
                "value": None,
                "confidence": 1.0 if has_content else 0.0,
            }
            if not has_content:
                missing_required.append(key)

    if not is_v1:
        from .templates import get_section_requirements
        from .guided_intake import intake_answer_complete
        answers = dict(project.guided_intake or {})
        if not answers.get("student_unit"):
            fallback_unit = project.placement_department or project.industry_department or ""
            if fallback_unit:
                answers["student_unit"] = fallback_unit
        if not answers.get("duties"):
            verified_entries = project.logbook_entries.filter(is_verified=True)
            if not verified_entries.exists():
                verified_entries = project.logbook_entries.all()
            if verified_entries.exists():
                entry_texts = [
                    (e.verified_text or e.raw_text or e.activity_summary or "").strip()
                    for e in verified_entries[:5]
                    if (e.verified_text or e.raw_text or e.activity_summary or "").strip()
                ]
                if entry_texts:
                    answers["duties"] = "\n".join(entry_texts)
        intake_steps = get_section_requirements()["guided_intake"]["steps"]
        for step in intake_steps:
            if not step.get("required"):
                continue
            key = f"guided_intake:{step['key']}"
            found = intake_answer_complete(step, answers)
            ans_val = answers.get(step['key'])
            if found and isinstance(ans_val, str) and step.get("type") in ["long_text", "short_text"]:
                is_short = step.get("key") in {"student_unit", "head_title", "supervisor_title"} or step.get("type") == "short_text"
                min_words = 1 if is_short else 3
                min_length = 2 if is_short else 10
                v_res = validate_answer_text(ans_val, min_words=min_words, min_length=min_length, field_label=step["title"])
                if not v_res["is_valid"]:
                    found = False
            field_reports[key] = {
                "key": key, "label": step["title"], "required": True,
                "status": "Found" if found else "Missing",
                "value": "Saved" if found else None,
                "confidence": 1.0 if found else 0.0,
            }
            if not found:
                missing_required.append(key)

    # 2. Check Logbook Entries
    entries = project.logbook_entries.all()
    entries_count = entries.count()
    verified_count = entries.filter(is_verified=True).count()

    logbook_status = "Missing"
    if entries_count > 0:
        logbook_status = "Found"

    if logbook_status == "Missing":
        missing_required.append("logbook_entries")

    field_reports["logbook_entries"] = {
        "key": "logbook_entries",
        "label": "Logbook activities & entries",
        "required": True,
        "status": logbook_status,
        "value": f"{entries_count} entries ({verified_count} verified)",
        "confidence": 1.0 if entries_count > 0 else 0.0,
    }

    # 2.5 Check Page Classification
    page_eval = evaluate_project_pages(project)
    if page_eval["has_pages"] and not page_eval["is_acceptable"]:
        allow_non_logbook = bool((project.guided_intake or {}).get("allow_non_logbook_pages", False))
        if not allow_non_logbook:
            classification_key = "logbook_page_classification"
            missing_required.append(classification_key)
            field_reports[classification_key] = {
                "key": classification_key,
                "label": "Logbook page verification",
                "required": True,
                "status": "Missing",
                "value": page_eval["message"],
                "confidence": 0.0,
            }

    material = None
    if not is_v1:
        from .extraction import material_sufficiency
        material = material_sufficiency(project)
        if material["status"] != "material_available":
            missing_required.append("material_sufficiency")
        field_reports["material_sufficiency"] = {
            "key": "material_sufficiency",
            "label": "Student-derived report material",
            "required": True,
            "status": "Found" if material["status"] == "material_available" else "Uncertain",
            "value": material["activity_entries_across_pages"],
            "confidence": 1.0 if material["status"] == "material_available" else 0.0,
        }

    # 3. Check Date Constraints
    start_date = getattr(project, 'training_start_date', None)
    end_date = getattr(project, 'training_end_date', None)
    date_val_result = validate_training_dates(start_date, end_date, list(entries))

    # Check if short duration requires confirmation
    if date_val_result.get("requires_short_duration_confirmation"):
        short_dur_confirmed = bool((project.guided_intake or {}).get("short_duration_confirmed", False))
        if not short_dur_confirmed:
            short_dur_key = "short_duration_confirmation"
            missing_required.append(short_dur_key)
            field_reports[short_dur_key] = {
                "key": short_dur_key,
                "label": "Short training duration confirmation (under 4 weeks)",
                "required": True,
                "status": "Missing",
                "value": "Training duration is under 4 weeks; requires explicit student confirmation.",
                "confidence": 0.0,
            }

    # Input prerequisites block report generation (profile, guided intake, entries, material).
    # Narrative sections and table of contents are outputs of generation and must not block their own creation.
    missing_inputs = [
        k for k in missing_required 
        if not k.startswith("section:") and k != "table_of_contents" and k != "section:table_of_contents"
    ]
    can_generate = len(missing_inputs) == 0 and date_val_result["is_valid"] and (
        material is None or material["status"] == "material_available"
    )

    return {
        "can_generate": can_generate,
        "missing_required_count": len(missing_required),
        "missing_required_fields": missing_required,
        "missing_input_fields": missing_inputs,
        "uncertain_fields": uncertain_fields,
        "date_validation": date_val_result,
        "page_evaluation": page_eval,
        "fields": field_reports,
        "material_sufficiency": material,
    }
