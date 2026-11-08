import os
import sys
from pathlib import Path
import pytest

BACKEND = Path(__file__).resolve().parents[2]
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "core.settings")
import django
from django.apps import apps
if not apps.ready:
    django.setup()

from django.contrib.auth.models import User
from django.core.exceptions import ValidationError
from api.models import ReportProject, Report, ReportSection, ReportParagraph, Fact, LogbookEntry, ReportTemplate
from api.report_generator import generate_full_report
from api.document_quality import evaluate_report_quality, critic_review_report
from api.logbook_cleaner import (
    filter_reportable_entries,
    detect_week_gaps,
    detect_suspicious_tokens,
    classify_logbook_entry,
)


@pytest.mark.django_db
def test_full_pipeline_acceptance_on_project_31():
    proj = ReportProject.objects.filter(id=31).first()
    if not proj:
        pytest.skip("Project 31 not present in current test database.")

    # 1. Clean and filter logbook entries
    raw_entries = list(proj.logbook_entries.all())
    reportable, excluded, notice = filter_reportable_entries(raw_entries)

    # Must identify the 7 absences and holidays
    assert len(excluded) == 7
    assert notice == "We left out 7 entries about leave or public holidays."

    # Gap detection: Week 11 must be flagged
    gaps = detect_week_gaps(reportable)
    assert any(g["week_number"] == 11 for g in gaps)
    assert any("Week 11 has no entries: missing page, or no entries that week?" in g["question"] for g in gaps)

    # Suspicious OCR token review queue
    review_queue = detect_suspicious_tokens(raw_entries, tools_text=proj.tools_used)
    flagged_tokens = {item["flagged_token"] for item in review_queue}
    expected_ocr_tokens = [
        "amphet extension allowlist",
        "profit exam topics authentication",
        "multi-hyper orchestration, SE streaming",
        "Alchemy & Alembic Rails",
        "Approved improved wallet tax processing",
        "Java IDEA! IDEA",
        "RumptyCloud",
        "pro Quiza",
    ]
    for tok in expected_ocr_tokens:
        assert tok in flagged_tokens, f"Expected {tok} to be flagged in review queue"

    # 2. Generate full report
    report = generate_full_report(proj, force_all=True)
    assert report is not None

    # Readiness feedback must include notice and gap question
    assert "We left out 7 entries about leave or public holidays." in report.readiness_feedback
    assert any("Week 11 has no entries" in q for q in report.readiness_feedback)

    # 3. Check Section 3.2 Clusters & Page Volume
    sec_3_2 = report.sections.get(section_key="ch3_activities")
    content_3_2 = sec_3_2.content
    assert "WEEK 1-2:" in content_3_2
    assert "WEEK 3-4:" in content_3_2
    assert "WEEK 5-7:" in content_3_2
    assert "WEEK 8:" in content_3_2
    assert "WEEK 9-10:" in content_3_2
    assert "WEEK 12:" in content_3_2

    # Words in 3.2 must span 3-3.5 pages (~900 to 1400 words)
    words_3_2 = len(sec_3_2.content.replace("<h3>", " ").replace("</h3>", " ").replace("<p>", " ").replace("</p>", " ").split())
    assert words_3_2 >= 900, f"Section 3.2 word count {words_3_2} is below 3 pages target (900 words)"

    # No 'Week N:' prefixes in prose
    for line in sec_3_2.content.splitlines():
        if "<p>" in line:
            assert not line.startswith("<p>Week ")

    # 4. Synthesized Sections
    # Section 1.3: 100-140 words
    sec_1_3 = report.sections.get(section_key="ch1_importance")
    words_1_3 = len(sec_1_3.content.replace("<p>", " ").replace("</p>", " ").split())
    assert 100 <= words_1_3 <= 140

    # Section 1.4: Normal-case org name
    sec_1_4 = report.sections.get(section_key="ch1_scope")
    assert "HYPERSENCE TECHNOLOGY" not in sec_1_4.content
    assert "Hypersence Technology" in sec_1_4.content

    # Section 1.5: Clean duration with exact duration phrase
    sec_1_5 = report.sections.get(section_key="ch1_duration")
    assert "weeks and" in sec_1_5.content

    # Section 2.1: History in proper sentences (not field concatenation)
    sec_2_1 = report.sections.get(section_key="ch2_history")
    assert "Hypersence Technology was founded" in sec_2_1.content or "Hypersence Technology is located" in sec_2_1.content
    assert "specialising in" in sec_2_1.content or "specializing in" in sec_2_1.content

    # Section 2.3: Structure
    sec_2_3 = report.sections.get(section_key="ch2_structure")
    assert "organisational structure of Hypersence Technology" in sec_2_3.content

    # Section 3.1: Duties (5-8 items by theme)
    sec_3_1 = report.sections.get(section_key="ch3_duties")
    assert "•" in sec_3_1.content
    bullet_count = sec_3_1.content.count("•")
    assert 5 <= bullet_count <= 8

    # Section 3.3: Categorised skills across 4+ domains, no generic filler
    sec_3_3 = report.sections.get(section_key="ch3_skills")
    assert "Practical engineering skills, system troubleshooting and professional teamwork" not in sec_3_3.content
    assert "1. Backend Web Development & API Architecture" in sec_3_3.content
    assert "2. Mobile Application Engineering" in sec_3_3.content
    assert "3. Object-Oriented Software Programming" in sec_3_3.content
    assert "4. UI/UX & Graphic Brand Identity Design" in sec_3_3.content
    assert "5. DevOps, Containerisation & Continuous Integration" in sec_3_3.content

    # Section 3.4: Categorised tools with usage lines
    sec_3_4 = report.sections.get(section_key="ch3_tools")
    assert "Programming Languages" in sec_3_4.content
    assert "Frameworks & Libraries" in sec_3_4.content
    assert "Databases & Cloud Platforms" in sec_3_4.content
    assert "Developer & Design Toolchains" in sec_3_4.content

    # Section 4.2: Conclusion without superlatives
    sec_4_2 = report.sections.get(section_key="ch4_conclusion")
    assert "invaluable" not in sec_4_2.content.lower()

    # Section 4.3: Exactly three structured suggestions
    sec_4_3 = report.sections.get(section_key="ch4_recommendations")
    assert "1. To Hypersence Technology:" in sec_4_3.content
    assert "2. To Lagos State University of Science and Technology" in sec_4_3.content
    assert "3. To the Industrial Training Fund" in sec_4_3.content

    # 5. Critic Review Pass: Must return PASS with 0 blockers
    critic_res = critic_review_report(report)
    assert critic_res["status"] == "PASS"
    assert len(critic_res["blockers"]) == 0
    assert critic_res["passed_grounding"] is True
    assert critic_res["passed_third_person"] is True
    assert critic_res["passed_skills"] is True

    # AI usage and cost reported
    ai_usage = critic_res["ai_usage"]
    assert ai_usage["estimated_cost_usd"] < 0.01  # Fraction of a cent
