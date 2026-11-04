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
    """
    errors: List[str] = []
    warnings: List[str] = []

    if start_date and end_date:
        if start_date >= end_date:
            errors.append(f"Training start date ({start_date}) must be before end date ({end_date}).")
        
        # Check if duration is unusually short (< 4 weeks) or long (> 52 weeks)
        days = (end_date - start_date).days
        if days < 28:
            warnings.append(f"Training duration ({days} days) is less than standard SIWES duration (usually 8-24 weeks).")
        elif days > 366:
            warnings.append(f"Training duration ({days} days) exceeds one year.")

    if logbook_entries and start_date and end_date:
        out_of_bounds = []
        for entry in logbook_entries:
            ed = getattr(entry, 'entry_date', None) or (entry.get('entry_date') if isinstance(entry, dict) else None)
            if ed:
                if isinstance(ed, str):
                    try:
                        ed = date.fromisoformat(ed)
                    except ValueError:
                        continue
                if ed < start_date or ed > end_date:
                    out_of_bounds.append(str(ed))

        if out_of_bounds:
            sample = ", ".join(out_of_bounds[:3])
            warnings.append(f"Some logbook entries ({sample}...) have dates outside the official training period.")

    return {
        "is_valid": len(errors) == 0,
        "errors": errors,
        "warnings": warnings,
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

    # 1. Check basic student & company fields
    for field_key, field_label, is_required, aliases in REQUIRED_STUDENT_FIELDS:
        val = None
        for alias in aliases:
            v = getattr(project, alias, None)
            if v:
                val = v
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

    # 3. Check Date Constraints
    start_date = getattr(project, 'training_start_date', None)
    end_date = getattr(project, 'training_end_date', None)
    date_val_result = validate_training_dates(start_date, end_date, list(entries))

    can_generate = len(missing_required) == 0 and date_val_result["is_valid"]

    return {
        "can_generate": can_generate,
        "missing_required_count": len(missing_required),
        "missing_required_fields": missing_required,
        "uncertain_fields": uncertain_fields,
        "date_validation": date_val_result,
        "fields": field_reports,
    }
