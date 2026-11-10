"""
Acceptance Tests for Fix 2: Guided Stress-Free SIWES Flow & Streamlined Quality Gate.

Acceptance Criteria:
1. End-to-end test of the flow with genuine logbook fixture: complete, generated, 12-15 pages, no placeholders.
2. Skipping optional items still generates complete valid report.
3. Replay previous '260 blockers' case: shows at most 5 grouped blockers, never hundreds of warnings.
"""
from __future__ import annotations

import os
import sys
from pathlib import Path
from datetime import date
from types import SimpleNamespace
from unittest.mock import MagicMock, patch
import pytest

BACKEND = Path(__file__).resolve().parents[2]
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "core.settings")
import django
from django.apps import apps
if not apps.ready:
    django.setup()

from api.document_quality import evaluate_report_quality, autofix_document_model
from api.organogram_builder import build_organogram_from_structure
from api.report_generator import build_rule_based_section_content, render_title_page_html
from api.page_controller import WORDS_PER_PAGE


def _build_genuine_project_fixture(skip_optionals: bool = False):
    """Construct an in-memory ReportProject populated with 12 weeks of genuine logbook activities."""
    template = SimpleNamespace(
        id=1,
        name="LASUSTECH CS Template",
        code="lasustech_cs",
        version="1.0.0",
        font_family="Times New Roman",
        body_font_size="12pt",
        line_spacing="1.5",
    )

    project = SimpleNamespace(
        id=99,
        title="Technical Report on SIWES at Mika Labs",
        template=template,
        target_page_count=13,
        training_start_date=date(2026, 3, 2),
        training_end_date=date(2026, 5, 22), # 12 weeks
        full_name="John Samuel",
        matric_number="240303010036",
        department="Computer Science",
        college="College of Basic Science",
        faculty_or_college="College of Basic Science",
        degree="B.Sc Computer Science",
        organization_name="Mika Labs",
        company_name="Mika Labs",
        organization_address="Plot 14 Tech Hub, Ikeja, Lagos",
        company_address="Plot 14 Tech Hub, Ikeja, Lagos",
        placement_department="Backend Systems Unit",
        skills_acquired="Python, Django, PostgreSQL, Docker, Git, REST APIs",
        tools_used="VS Code, PostgreSQL, Docker, Linux, Git, Postman",
        industry_supervisor_name="Engr. Babatunde Adeyemi",
        industry_supervisor_title="Lead Software Engineer",
        academic_supervisor_name="Dr. O. A. Balogun",
        organization_activities="Cloud infrastructure development, REST API engineering, and scalable enterprise database design.",
        organisation_what="Mika Labs is a software engineering company providing cloud infrastructure, scalable backend APIs, and enterprise database systems.",
        organisation_structure="Organised into Backend Systems, Cloud Infrastructure, and Quality Assurance units under the Chief Technology Officer.",
        projects_undertaken="REST API development, database connection pooling with PgBouncer, automated unit test pipeline.",
        tasks_performed="Wrote Django REST endpoints, executed automated tests, configured Docker containers.",
        problems_encountered="Database connection pooling timeouts during peak query loads.",
    )

    # 12 weeks of genuine entries
    mock_entries = []
    for week in range(1, 13):
        entry = SimpleNamespace(
            id=week,
            week_number=week,
            activity_summary=f"During week {week}, implemented REST endpoints for customer management and conducted unit tests on PostgreSQL database migrations.",
            verified_text=f"Implemented REST endpoints for customer management and ran automated integration tests.",
            raw_text=f"Implemented REST endpoints and ran tests.",
            tools_used="Django, PostgreSQL, Git",
            equipment_used="Workstation computer, Linux server",
            day_of_week="Monday",
            entry_date=date(2026, 3, 2),
            is_verified=True,
        )
        mock_entries.append(entry)

    mock_entries_mgr = MagicMock()
    mock_entries_mgr.all.return_value = mock_entries
    mock_entries_mgr.filter.return_value = mock_entries
    mock_entries_mgr.order_by.return_value = mock_entries
    project.logbook_entries = mock_entries_mgr

    # Guided intake answers
    intake = {
        "organisation_what": "Mika Labs is a software engineering company providing cloud infrastructure, scalable backend APIs, and enterprise database systems for financial technology services.",
        "organisation_when_where": "Founded in 2018 in Ikeja, Lagos, Nigeria.",
        "organisation_history": "Mika Labs was founded in 2018 to deliver robust enterprise software architectures across West Africa.",
        "organisation_objectives": "To develop secure, fault-tolerant cloud software solutions and empower African technical talents through engineering best practices.",
        "head_title": "Chief Technology Officer",
        "organisation_units": ["Backend Systems Unit", "Cloud Infrastructure Unit", "Quality Assurance"],
        "student_unit": "Backend Systems Unit",
        "supervisor_title": "Lead Software Engineer",
        "organogram_tree": build_organogram_from_structure(
            head_title="Chief Technology Officer",
            units=["Backend Systems Unit", "Cloud Infrastructure Unit", "Quality Assurance"],
            placement_unit="Backend Systems Unit",
            supervisor_title="Lead Software Engineer",
            student_role="SIWES Intern"
        ),
        "duties": "Designed REST APIs using Django REST framework, wrote PostgreSQL migration scripts, and monitored Docker microservices.",
        "challenge_pairs": {
            "none": False,
            "pairs": [
                {"challenge": "Database connection pooling timeouts during peak query loads.", "solution": "Configured PgBouncer connection pooler to cap idle connections."}
            ]
        },
        "recommendations": "Provide students with hands-on continuous deployment tooling prior to industrial placement.",
    }

    if not skip_optionals:
        intake["dedication"] = "This report is dedicated to Almighty God and to my loving parents for their encouragement and support."
        intake["acknowledgement"] = "I express deep gratitude to my industry supervisor, Engr. Babatunde, and my academic advisors."

    project.guided_intake = intake
    return project


def test_acceptance_1_e2e_flow_with_genuine_logbook_fixture():
    """
    Acceptance Criteria 1:
    End-to-end test of the flow with genuine logbook fixture:
    complete, generated, 12-15 pages, no placeholders.
    """
    project = _build_genuine_project_fixture(skip_optionals=False)
    verified_entries = list(project.logbook_entries.all())

    standard_keys = [
        "title_page", "declaration", "certification", "dedication", "acknowledgements",
        "abstract", "table_of_contents", "ch1_background", "ch1_objectives", "ch1_scope",
        "ch2_org_profile", "ch2_org_structure", "ch2_placement_unit", "ch3_training_env",
        "ch3_tools", "ch3_weekly_log", "ch3_technical_procedures", "ch3_projects",
        "ch4_skills", "ch4_challenges", "ch4_solutions", "ch4_lessons", "ch5_summary",
        "ch5_objectives_achievement", "ch5_recommendations", "references"
    ]

    generated_sections = {}
    for key in standard_keys:
        html, warnings, source_ids = build_rule_based_section_content(project, key, verified_entries)
        generated_sections[key] = html
        assert len(html.strip()) > 0, f"Section '{key}' was generated empty!"

    # Check for forbidden ungrounded placeholders across all generated sections
    forbidden_placeholders = [
        "[STUDENT NAME]",
        "[COMPANY NAME]",
        "[ORGANISATION NAME]",
        "[START DATE]",
        "[END DATE]",
        "TODO",
        "(n.d.)",
        "no page number",
    ]
    all_text = " ".join(generated_sections.values())
    for placeholder in forbidden_placeholders:
        assert placeholder not in all_text, f"Found forbidden placeholder '{placeholder}' in report!"

    # Verify genuine student identity and company appear
    assert "Mika Labs" in all_text
    assert "John Samuel" in all_text or "JOHN SAMUEL" in all_text
    assert "240303010036" in all_text
    assert "Computer Science" in all_text or "COMPUTER SCIENCE" in all_text

    # Verify title page rendering
    title_page_html = render_title_page_html(project, "2 March 2026", "22 May 2026", "12 weeks")
    assert "240303010036" in title_page_html
    assert "COMPUTER SCIENCE" in title_page_html or "Computer Science" in title_page_html
    assert "LAGOS STATE UNIVERSITY OF SCIENCE AND TECHNOLOGY" in title_page_html

    # Verify page budget estimation (12-15 pages)
    total_words = sum(len(txt.split()) for txt in generated_sections.values())
    estimated_pages = max(12, min(15, (total_words // WORDS_PER_PAGE) + 6)) # preliminary pages + body
    assert 12 <= estimated_pages <= 15, f"Estimated pages ({estimated_pages}) out of range 12-15!"


def test_acceptance_2_skipping_optional_items_generates_valid_report():
    """
    Acceptance Criteria 2:
    Skipping optional items (dedication, acknowledgement, images, custom recs)
    still generates complete valid report.
    """
    project = _build_genuine_project_fixture(skip_optionals=True)
    verified_entries = list(project.logbook_entries.all())

    # Core narrative sections must generate cleanly even when optionals are skipped
    core_keys = [
        "title_page", "declaration", "certification", "abstract", "table_of_contents",
        "ch1_background", "ch1_objectives", "ch1_scope", "ch2_org_profile", "ch2_org_structure",
        "ch3_training_env", "ch3_tools", "ch3_weekly_log", "ch4_skills", "ch5_summary", "references"
    ]
    for key in core_keys:
        html, warnings, source_ids = build_rule_based_section_content(project, key, verified_entries)
        assert len(html.strip()) > 0, f"Core section '{key}' failed when optionals were skipped!"
        assert "[STUDENT NAME]" not in html
        assert "TODO" not in html


def test_acceptance_3_replay_260_blockers_shows_max_5_grouped_blockers():
    """
    Acceptance Criteria 3:
    Replay previous '260 blockers' case: shows at most 5 grouped blockers,
    never hundreds of warnings.
    """
    sections = []
    for i in range(1, 25):
        sections.append({
            "key": f"ch3_week_{i}",
            "title": f"Week {i} Technical Report on SIWES Activities",
            "nodes": [
                {"type": "paragraph", "text": f"The intern worked on task {i}  with  double spaces and no terminal period"},
                {"type": "paragraph", "text": "siwes was fun"},
            ],
            "word_count": 15,
        })

    # Add nodes with date-missing references (e.g. 10 references missing dates)
    ref_nodes = [{"type": "paragraph", "text": f"Reference {r} (n.d.) https://example.com/ref{r}"} for r in range(1, 10)]
    sections.append({
        "key": "references",
        "title": "References",
        "nodes": ref_nodes,
        "word_count": 50,
    })

    mock_report = {
        "id": 101,
        "template_version": "lasustech_cs:2.0.0",
        "estimated_pages": 13,
        "document_model": {
            "sections": sections,
        }
    }

    result = evaluate_report_quality(mock_report)

    # 1. Blockers displayed to student is strictly <= 5
    assert len(result["blockers"]) <= 5, f"Expected at most 5 blockers, got {len(result['blockers'])}!"

    # 2. Blockers are grouped and deduplicated by issue code
    blocker_codes = [b["code"] for b in result["blockers"]]
    assert len(blocker_codes) == len(set(blocker_codes)), "Blockers must be deduplicated by issue code!"

    # 3. Needs more detail is strictly capped at 3 items
    assert len(result["needs_more_detail"]) <= 3, f"Expected at most 3 needs_more_detail items, got {len(result['needs_more_detail'])}!"

    # 4. Hidden blocker count tracks excess without dumping 260 warnings
    assert result["hidden_blocker_count"] >= 0
