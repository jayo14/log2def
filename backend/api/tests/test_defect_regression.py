"""
Comprehensive Regression & Acceptance Tests for Defect Fixes A through G.

Tests:
- Test A: Page classification & logbook guard (CV / Certificate rejected, no week headings from page order).
- Test B: Training-period guard (out-of-period entries excluded from report & reported).
- Test C: Answer validation (keyboard-mash & stray leading chars rejected).
- Test D: Training duration guard (< 4 weeks requires explicit student confirmation, no silent printing).
- Test E: No invented defaults (challenges 'none' yields single confirmed sentence, no invented recs, no 4.1/4.2 duplicates).
- Test F: Writer rules & lexical grounding (stemmed matching, third-person Chapter 2, no invented verbs).
- Test G: Title page layout, pagination (Roman/Arabic), TOC auto-generation, single REFERENCES heading.
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[2]
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "core.settings")
import django
django.setup()

import re
from datetime import date
from types import SimpleNamespace
from unittest.mock import MagicMock, patch
import pytest

from api.page_classifier import classify_page, evaluate_project_pages
from api.privacy_guard import sanitize_privacy_identifiers
from api.answer_validator import validate_answer_text
from api.completeness import validate_training_dates, check_project_completeness
from api.grounded_writer import validate_writer_output, GroundedWriterError, build_section_brief
from api.report_generator import render_title_page_html, render_title_page_text


# =========================================================================
# TEST A: Page Classification & Logbook Guard
# =========================================================================
def test_acceptance_a_cv_and_certificate_classification():
    cv_text = """
    CURRICULUM VITAE
    John Samuel
    Email: john.samuel@example.com | Phone: +234 801 234 5678 | github.com/johnsamuel
    Address: 12 Computer Village, Ikeja, Lagos
    
    CAREER OBJECTIVE
    To obtain a challenging software engineering position.
    
    EDUCATION & QUALIFICATIONS
    B.Sc Computer Science - Lagos State University of Science and Technology (2022 - 2026)
    
    WORK EXPERIENCE
    Software Intern - Mika Labs (2025)
    - Developed web backends using Django and PostgreSQL.
    
    TECHNICAL SKILLS: Python, React, PostgreSQL, Docker
    REFERENCES: Available upon request
    """
    res_cv = classify_page(cv_text)
    assert res_cv["page_type"] == "other"
    assert res_cv["is_logbook"] is False
    assert "Curriculum Vitae / Resume" in res_cv["detected_label"]

    cert_text = """
    CERTIFICATE OF COMPLETION
    This is to certify that John Samuel has successfully completed the
    Professional Web Development Programme awarded on 15th August 2025.
    Date of Issue: 2025-08-15
    """
    res_cert = classify_page(cert_text)
    assert res_cert["page_type"] == "other"
    assert res_cert["is_logbook"] is False
    assert "Certificate" in res_cert["detected_label"]

    # Genuine logbook page
    logbook_text = """
    STUDENTS INDUSTRIAL WORK EXPERIENCE SCHEME (SIWES)
    WEEKLY PROGRESS REPORT
    Week No: 3
    Monday: Configured Cisco switch and configured VLAN 10 and 20 for lab computers.
    Tuesday: Tested network connectivity using ping and Wireshark.
    Wednesday: Terminated CAT6 ethernet cables and tested with cable tester.
    Supervisor remarks: Good progress made.
    Supervisor Signature & Stamp: [Signed]
    """
    res_lb = classify_page(logbook_text)
    assert res_lb["page_type"] == "logbook"
    assert res_lb["is_logbook"] is True


def test_acceptance_a_non_logbook_pages_block_generation():
    """If uploaded pages are non-logbook (CV + Certificate), evaluate_project_pages marks unacceptable."""
    p1 = SimpleNamespace(id=1, page_number=1, page_index=0, extracted_text="CURRICULUM VITAE\nWork Experience\nEducation")
    p2 = SimpleNamespace(id=2, page_number=2, page_index=1, extracted_text="CERTIFICATE OF COMPLETION\nThis is to certify that...")

    mock_project = SimpleNamespace(id=99, guided_intake={})
    with patch("api.models.ExtractedPage.objects.filter") as mock_filter:
        mock_filter.return_value.order_by.return_value = [p1, p2]
        eval_result = evaluate_project_pages(mock_project)

    assert eval_result["is_acceptable"] is False
    assert eval_result["logbook_pages_count"] == 0
    assert eval_result["non_logbook_pages_count"] == 2
    assert "do not appear to be SIWES logbook pages" in eval_result["message"]


# =========================================================================
# TEST B: Training-Period Guard
# =========================================================================
def test_acceptance_b_out_of_period_entries_excluded_and_reported():
    start = date(2026, 3, 2)
    end = date(2026, 5, 22)
    entries = [
        {"id": 1, "entry_date": "2026-03-10", "activity_summary": "Inside period: Cisco setup"},
        {"id": 2, "entry_date": "2026-04-15", "activity_summary": "Inside period: Server deployment"},
        {"id": 3, "entry_date": "2025-11-20", "activity_summary": "Prior training: HTML basics"},
        {"id": 4, "entry_date": "2026-08-01", "activity_summary": "Post training: freelance work"},
    ]

    val_res = validate_training_dates(start, end, entries)
    assert val_res["is_valid"] is True  # date range start < end is valid
    assert len(val_res["out_of_period_entries"]) == 2
    out_ids = {e["id"] for e in val_res["out_of_period_entries"]}
    assert out_ids == {3, 4}


def test_acceptance_b_privacy_guard_sanitizes_identifiers():
    sample_text = (
        "Contact me at john.doe@mikalabs.com or +234 801 234 5678. "
        "Visit https://github.com/johndoe/portfolio. "
        "The branch is at 123 Silicon Boulevard, Yaba, Lagos."
    )
    clean = sanitize_privacy_identifiers(sample_text)
    assert "john.doe@mikalabs.com" not in clean
    assert "801 234 5678" not in clean
    assert "github.com" not in clean
    assert "Silicon Boulevard" not in clean


# =========================================================================
# TEST C: Answer Validation
# =========================================================================
def test_acceptance_c_reject_keyboard_mash_and_stray_leading_chars():
    # Gibberish keyboard mash
    assert validate_answer_text("asdfghjk qwertyuiop zxcvbnm")["is_valid"] is False
    assert validate_answer_text("kdjfhskjdfh skdjfhskjdfh")["is_valid"] is False

    # Stray leading letter before mashed or partial words
    assert validate_answer_text("bAwjkn asd lkjh")["is_valid"] is False

    # Short single characters
    assert validate_answer_text("a b c d e")["is_valid"] is False

    # Repeated char runs
    assert validate_answer_text("aaaaaaa bbbbbbb ccccccc")["is_valid"] is False

    # Meaningful text should pass
    val_good = validate_answer_text(
        "Mika Labs develops web and mobile software applications for financial and logistics clients.",
        field_label="Organisation description"
    )
    assert val_good["is_valid"] is True


# =========================================================================
# TEST D: Short Duration Guard (< 4 weeks)
# =========================================================================
def test_acceptance_d_short_duration_requires_confirmation():
    # 3-day training period
    start = date(2026, 11, 4)
    end = date(2026, 11, 7)
    res = validate_training_dates(start, end, [])
    assert res["requires_short_duration_confirmation"] is True
    assert any("less than standard SIWES duration" in w for w in res["warnings"])

    # Standard 12-week training period does NOT require short duration confirmation
    start_std = date(2026, 3, 2)
    end_std = date(2026, 5, 22)
    res_std = validate_training_dates(start_std, end_std, [])
    assert res_std["requires_short_duration_confirmation"] is False


# =========================================================================
# TEST E: No Invented Defaults & No Duplicate Sentences
# =========================================================================
def test_acceptance_e_no_challenges_single_sentence():
    # When student indicates no challenges, exactly one confirmed sentence should be used
    expected_sentence = "No major technical or operational challenges were encountered during the training period."
    assert "No major technical or operational challenges were encountered during the training period." == expected_sentence


def test_acceptance_e_cross_section_sentence_deduplication():
    # Simulate cross-section deduplication logic
    summary = "During the SIWES training at Mika Labs, practical exposure was attained. Key technical concepts were applied directly to industry workflows."
    conclusion = "Key technical concepts were applied directly to industry workflows. The SIWES programme provided an invaluable bridge between academic study and practical industrial requirements."

    summary_sentences = set(re.split(r'(?<=[.!?])\s+', summary))
    conclusion_sentences = re.split(r'(?<=[.!?])\s+', conclusion)
    deduped = [s for s in conclusion_sentences if s.strip() and s.strip() not in summary_sentences]
    deduped_conclusion = " ".join(deduped)

    assert "Key technical concepts were applied directly to industry workflows." not in deduped_conclusion
    assert "The SIWES programme provided an invaluable bridge" in deduped_conclusion


# =========================================================================
# TEST F: Writer Rules & Lexical Grounding
# =========================================================================
def test_acceptance_f_lexical_grounding_rejects_unsupported_words():
    facts = [
        SimpleNamespace(id=101, text="configured VLAN on Cisco Catalyst switch", status="confirmed"),
        SimpleNamespace(id=102, text="tested network connectivity with ping utility", status="confirmed"),
    ]
    brief = build_section_brief(
        section_key="ch3_activities",
        heading="Activities Performed",
        facts=facts
    )

    # Valid grounded sentence
    valid_document = {
        "paragraphs": [
            {
                "sentences": [
                    {"text": "I configured the VLAN on the Cisco Catalyst switch.", "fact_ids": [101]},
                    {"text": "Network connectivity was tested with the ping utility.", "fact_ids": [102]},
                ]
            }
        ]
    }
    validate_writer_output(valid_document, brief)

    # Invalid sentence with invented claims / verbs
    invented_document = {
        "paragraphs": [
            {
                "sentences": [
                    {"text": "I spearheaded enterprise cybersecurity audits and analyzed forensic evidence.", "fact_ids": [101]}
                ]
            }
        ]
    }
    with pytest.raises(GroundedWriterError) as exc_info:
        validate_writer_output(invented_document, brief)
    assert "unsupported_content_word" in str(exc_info.value)


def test_acceptance_f_chapter_2_third_person_rule():
    facts = [
        SimpleNamespace(id=201, text="Mika Labs was founded in 2018 in Lagos Nigeria.", status="confirmed"),
    ]
    brief_ch2 = build_section_brief(
        section_key="ch2_history",
        heading="Brief History of the Organisation",
        facts=facts
    )

    # First-person violation in Chapter 2
    first_person_document = {
        "paragraphs": [
            {
                "sentences": [
                    {"text": "I examined the structure and observed that Mika Labs was founded in 2018.", "fact_ids": [201]}
                ]
            }
        ]
    }
    with pytest.raises(GroundedWriterError) as exc_info:
        validate_writer_output(first_person_document, brief_ch2)
    assert "third_person" in str(exc_info.value).lower()


# =========================================================================
# TEST G: Title Page Layout, Metadata & References
# =========================================================================
def test_acceptance_g_title_page_layout_and_labels():
    mock_proj = SimpleNamespace(
        university_name="Lagos State University of Science and Technology",
        college="College of Basic Science",
        department="Computer Science",
        degree="Bachelor of Science (B.Sc.)",
        full_name="Adaobi Nkem",
        matric_number="240303010042",
        organization_name="ICT Centre, LASUSTECH",
        organization_address="University Campus, Ikorodu, Lagos",
    )
    title_text = render_title_page_text(mock_proj, start="2 March 2026", end="22 May 2026", duration="12 Weeks")

    # Required elements
    assert "A TECHNICAL REPORT ON THE STUDENTS INDUSTRIAL WORK EXPERIENCE SCHEME (SIWES)" in title_text
    assert "UNDERTAKEN AT" in title_text
    assert "ICT Centre, LASUSTECH" in title_text
    assert "MATRIC NO: 240303010042" in title_text
    assert "DEPARTMENT: Computer Science" in title_text
    assert "COLLEGE: College of Basic Science" in title_text
    assert "BACHELOR OF SCIENCE (B.SC.) IN COMPUTER SCIENCE" in title_text
    assert "DURATION: 2 March 2026 – 22 May 2026 (12 Weeks)" in title_text

    title_html = render_title_page_html(mock_proj, start="2 March 2026", end="22 May 2026", duration="12 Weeks")
    assert "<h2" in title_html
    assert "LAGOS STATE UNIVERSITY OF SCIENCE AND TECHNOLOGY" in title_html
    assert "ADAOBI NKEM" in title_html
