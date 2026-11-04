"""
Log2Def Report Templates Registry
Defines the authoritative, versioned templates for SIWES technical reports.
"""

from typing import Dict, Any, List

# Official LASUSTECH Standard Report Template v1.0.0
LASUSTECH_STANDARD_V1: Dict[str, Any] = {
    "template_id": "lasustech-standard",
    "version": "1.0.0",
    "name": "LASUSTECH Standard SIWES Technical Report Template",
    "institution": "Lagos State University of Science and Technology (LASUSTECH)",
    "description": (
        "Official technical report template for LASUSTECH SIWES attachment, "
        "complying with university guidelines, standard front-matter formatting, "
        "and ITF 5-chapter reporting structure."
    ),
    "target_page_count": {
        "min": 12,
        "max": 15,
        "words_per_page_estimate": 350,
    },
    "formatting_spec": {
        "font_family": "Times New Roman",
        "font_size_pt": 12,
        "line_spacing": 1.5,
        "alignment": "justified",
        "margins_inches": {
            "top": 1.0,
            "bottom": 1.0,
            "left": 1.5,   # Left binding margin
            "right": 1.0,
        },
        "heading_styles": {
            "chapter_title": {"font_size_pt": 14, "bold": True, "align": "center", "all_caps": True},
            "section_heading": {"font_size_pt": 12, "bold": True, "align": "left"},
            "sub_heading": {"font_size_pt": 12, "bold": True, "italic": True, "align": "left"},
        },
        "pagination": {
            "cover": {"visible": False, "scheme": None},
            "preliminary": {
                "visible": True,
                "scheme": "lowerRoman",  # i, ii, iii...
                "position": "bottom-center",
                "start": 1,
            },
            "main_body": {
                "visible": True,
                "scheme": "decimal",     # 1, 2, 3...
                "position": "bottom-center",
                "restart_at_chapter_one": True,
                "start": 1,
            },
            "table_of_contents": {
                "auto_generated": True,
                "real_page_numbers": True,
            },
        },
    },
    "required_fields": [
        "full_name",
        "matric_number",
        "university_name",
        "department",
        "faculty",
        "organization_name",
        "organization_address",
        "training_start_date",
        "training_end_date",
        "logbook_entries",
    ],
    "optional_fields": [
        "placement_department",
        "industry_supervisor_name",
        "academic_supervisor_name",
    ],
    "sections": [
        # Preliminary Pages (Front Matter: Chapter 0)
        {
            "key": "cover",
            "chapter_number": 0,
            "title": "Cover Page",
            "order": 1,
            "is_required": True,
            "pagination_scheme": None,
            "has_page_break_after": True,
        },
        {
            "key": "title_page",
            "chapter_number": 0,
            "title": "Title Page",
            "order": 2,
            "is_required": True,
            "pagination_scheme": "lowerRoman",
            "has_page_break_after": True,
        },
        {
            "key": "declaration",
            "chapter_number": 0,
            "title": "Declaration",
            "order": 3,
            "is_required": True,
            "pagination_scheme": "lowerRoman",
            "has_page_break_after": True,
        },
        {
            "key": "certification",
            "chapter_number": 0,
            "title": "Certification & Approval",
            "order": 4,
            "is_required": True,
            "pagination_scheme": "lowerRoman",
            "has_page_break_after": True,
        },
        {
            "key": "dedication",
            "chapter_number": 0,
            "title": "Dedication",
            "order": 5,
            "is_required": False,
            "pagination_scheme": "lowerRoman",
            "has_page_break_after": True,
        },
        {
            "key": "acknowledgements",
            "chapter_number": 0,
            "title": "Acknowledgements",
            "order": 6,
            "is_required": True,
            "pagination_scheme": "lowerRoman",
            "has_page_break_after": True,
        },
        {
            "key": "abstract",
            "chapter_number": 0,
            "title": "Abstract / Executive Summary",
            "order": 7,
            "is_required": True,
            "pagination_scheme": "lowerRoman",
            "has_page_break_after": True,
        },
        {
            "key": "table_of_contents",
            "chapter_number": 0,
            "title": "Table of Contents",
            "order": 8,
            "is_required": True,
            "pagination_scheme": "lowerRoman",
            "has_page_break_after": True,
        },

        # Chapter 1: Introduction
        {
            "key": "ch1_background",
            "chapter_number": 1,
            "chapter_title": "CHAPTER ONE\nINTRODUCTION",
            "title": "1.1 Background to SIWES",
            "order": 10,
            "is_required": True,
            "pagination_scheme": "decimal",
        },
        {
            "key": "ch1_objectives",
            "chapter_number": 1,
            "chapter_title": "CHAPTER ONE\nINTRODUCTION",
            "title": "1.2 Objectives of Industrial Training",
            "order": 11,
            "is_required": True,
            "pagination_scheme": "decimal",
        },
        {
            "key": "ch1_scope",
            "chapter_number": 1,
            "chapter_title": "CHAPTER ONE\nINTRODUCTION",
            "title": "1.3 Scope and Significance of the Scheme",
            "order": 12,
            "is_required": True,
            "pagination_scheme": "decimal",
        },

        # Chapter 2: Organisation Profile
        {
            "key": "ch2_org_profile",
            "chapter_number": 2,
            "chapter_title": "CHAPTER TWO\nORGANIZATION PROFILE",
            "title": "2.1 Company Background and Overview",
            "order": 20,
            "is_required": True,
            "pagination_scheme": "decimal",
        },
        {
            "key": "ch2_org_structure",
            "chapter_number": 2,
            "chapter_title": "CHAPTER TWO\nORGANIZATION PROFILE",
            "title": "2.2 Organizational Structure & Key Operations",
            "order": 21,
            "is_required": True,
            "pagination_scheme": "decimal",
        },
        {
            "key": "ch2_placement_unit",
            "chapter_number": 2,
            "chapter_title": "CHAPTER TWO\nORGANIZATION PROFILE",
            "title": "2.3 Department of Placement and Responsibilities",
            "order": 22,
            "is_required": True,
            "pagination_scheme": "decimal",
        },

        # Chapter 3: Training Activities and Technical Experience
        {
            "key": "ch3_training_env",
            "chapter_number": 3,
            "chapter_title": "CHAPTER THREE\nTRAINING ACTIVITIES AND TECHNICAL EXPERIENCE",
            "title": "3.1 Training Environment & Workflow",
            "order": 30,
            "is_required": True,
            "pagination_scheme": "decimal",
        },
        {
            "key": "ch3_tools",
            "chapter_number": 3,
            "chapter_title": "CHAPTER THREE\nTRAINING ACTIVITIES AND TECHNICAL EXPERIENCE",
            "title": "3.2 Tools, Technologies & Equipment Used",
            "order": 31,
            "is_required": True,
            "pagination_scheme": "decimal",
        },
        {
            "key": "ch3_weekly_log",
            "chapter_number": 3,
            "chapter_title": "CHAPTER THREE\nTRAINING ACTIVITIES AND TECHNICAL EXPERIENCE",
            "title": "3.3 Weekly Chronological Summary of Activities",
            "order": 32,
            "is_required": True,
            "pagination_scheme": "decimal",
        },
        {
            "key": "ch3_technical_procedures",
            "chapter_number": 3,
            "chapter_title": "CHAPTER THREE\nTRAINING ACTIVITIES AND TECHNICAL EXPERIENCE",
            "title": "3.4 Detailed Technical Procedures and Tasks",
            "order": 33,
            "is_required": True,
            "pagination_scheme": "decimal",
        },
        {
            "key": "ch3_projects",
            "chapter_number": 3,
            "chapter_title": "CHAPTER THREE\nTRAINING ACTIVITIES AND TECHNICAL EXPERIENCE",
            "title": "3.5 Specific Projects Undertaken",
            "order": 34,
            "is_required": True,
            "pagination_scheme": "decimal",
        },

        # Chapter 4: Skills and Experience
        {
            "key": "ch4_skills",
            "chapter_number": 4,
            "chapter_title": "CHAPTER FOUR\nSKILLS ACQUIRED, CHALLENGES AND SOLUTIONS",
            "title": "4.1 Skills and Knowledge Acquired",
            "order": 40,
            "is_required": True,
            "pagination_scheme": "decimal",
        },
        {
            "key": "ch4_challenges",
            "chapter_number": 4,
            "chapter_title": "CHAPTER FOUR\nSKILLS ACQUIRED, CHALLENGES AND SOLUTIONS",
            "title": "4.2 Challenges and Problems Encountered",
            "order": 41,
            "is_required": True,
            "pagination_scheme": "decimal",
        },
        {
            "key": "ch4_solutions",
            "chapter_number": 4,
            "chapter_title": "CHAPTER FOUR\nSKILLS ACQUIRED, CHALLENGES AND SOLUTIONS",
            "title": "4.3 Solutions Attempted and Troubleshooting Strategies",
            "order": 42,
            "is_required": True,
            "pagination_scheme": "decimal",
        },
        {
            "key": "ch4_lessons",
            "chapter_number": 4,
            "chapter_title": "CHAPTER FOUR\nSKILLS ACQUIRED, CHALLENGES AND SOLUTIONS",
            "title": "4.4 Professional Lessons Learned",
            "order": 43,
            "is_required": True,
            "pagination_scheme": "decimal",
        },

        # Chapter 5: Conclusion and Recommendations
        {
            "key": "ch5_summary",
            "chapter_number": 5,
            "chapter_title": "CHAPTER FIVE\nCONCLUSION AND RECOMMENDATIONS",
            "title": "5.1 Summary of Training Experience",
            "order": 50,
            "is_required": True,
            "pagination_scheme": "decimal",
        },
        {
            "key": "ch5_objectives_achievement",
            "chapter_number": 5,
            "chapter_title": "CHAPTER FIVE\nCONCLUSION AND RECOMMENDATIONS",
            "title": "5.2 Assessment of SIWES Objectives Realization",
            "order": 51,
            "is_required": True,
            "pagination_scheme": "decimal",
        },
        {
            "key": "ch5_recommendations",
            "chapter_number": 5,
            "chapter_title": "CHAPTER FIVE\nCONCLUSION AND RECOMMENDATIONS",
            "title": "5.3 Recommendations",
            "order": 52,
            "is_required": True,
            "pagination_scheme": "decimal",
        },

        # Back Matter (Chapter 6)
        {
            "key": "references",
            "chapter_number": 6,
            "chapter_title": "REFERENCES AND APPENDICES",
            "title": "References",
            "order": 60,
            "is_required": True,
            "pagination_scheme": "decimal",
        },
        {
            "key": "appendices",
            "chapter_number": 6,
            "chapter_title": "REFERENCES AND APPENDICES",
            "title": "Appendices",
            "order": 61,
            "is_required": False,
            "pagination_scheme": "decimal",
        },
    ],
}

TEMPLATE_REGISTRY: Dict[str, Dict[str, Any]] = {
    "lasustech-standard:1.0.0": LASUSTECH_STANDARD_V1,
}


def get_template_spec(code: str = "lasustech-standard", version: str = "1.0.0") -> Dict[str, Any]:
    """
    Returns the versioned template specification from the registry.
    """
    key = f"{code}:{version}"
    if key in TEMPLATE_REGISTRY:
        return TEMPLATE_REGISTRY[key]
    return LASUSTECH_STANDARD_V1


def ensure_default_template_in_db():
    """
    Idempotently ensures the default LASUSTECH v1.0.0 template row exists in the database.
    """
    from .models import ReportTemplate

    spec = LASUSTECH_STANDARD_V1
    tmpl, _ = ReportTemplate.objects.get_or_create(
        code=spec["template_id"],
        version=spec["version"],
        defaults={
            "name": spec["name"],
            "description": spec["description"],
            "is_default": True,
            "required_fields": spec["required_fields"],
            "section_order": [s["key"] for s in spec["sections"]],
            "formatting_spec": spec["formatting_spec"],
            "structure": spec,
        }
    )
    return tmpl
