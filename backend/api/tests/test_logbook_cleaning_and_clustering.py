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

from api.logbook_cleaner import (
    classify_logbook_entry,
    filter_reportable_entries,
    detect_week_gaps,
    detect_suspicious_tokens,
    clean_ocr_suspicious_text,
    SOFTWARE_IT_LEXICON,
)
from api.report_clustering import (
    cluster_logbook_entries,
    synthesize_scope_section,
    synthesize_duration_section,
    synthesize_history_section,
    synthesize_objectives_section,
    synthesize_structure_section,
    synthesize_duties_section,
    derive_categorised_skills,
    categorise_tools,
    synthesize_challenges_and_solutions,
    synthesize_summary_section,
    synthesize_conclusion_section,
    synthesize_recommendations_section,
    to_title_case_name,
)


def test_classify_logbook_entry_and_word_boundaries():
    # Real Project 31 entries
    assert classify_logbook_entry("I didn't go to the office due to the heavy downpour.") == "ABSENCE"
    assert classify_logbook_entry("TOOK LEAVE FOR A CHURCH EVENT") == "ABSENCE"
    assert classify_logbook_entry("TOOK LEAVE: A CHURCH EVENT") == "ABSENCE"
    assert classify_logbook_entry("PUBLIC HOLIDAY: EID EL-MAULUD") == "HOLIDAY"
    assert classify_logbook_entry("INDEPENDENCE DAY") == "HOLIDAY"

    # Ensure technical words with substrings (like 'rain' in trainer, 'rail' in Rails) are NOT absences
    assert classify_logbook_entry("Gymoraflow mobile app (trainer messaging)") == "ACTIVITY"
    assert classify_logbook_entry("Alchemy & Alembic Rails") == "ACTIVITY"

    # Design, Learning, Meeting
    assert classify_logbook_entry("I studied text contrast and layout tuning concepts using standard colours") == "DESIGN"
    assert classify_logbook_entry("Learned fundamentals of Java and practiced OOP principles") == "LEARNING_TRAINING"
    assert classify_logbook_entry("Presented sprint review and technical handoff to engineering team") == "MEETING_PRESENTATION"


def test_filter_reportable_entries_exclusion_count():
    entries = [
        {"week_number": 1, "text": "I didn't go to the office due to the heavy downpour."},
        {"week_number": 1, "text": "I worked on report card preview."},
        {"week_number": 1, "text": "TOOK LEAVE FOR A CHURCH EVENT"},
        {"week_number": 2, "text": "TOOK LEAVE: A CHURCH EVENT"},
        {"week_number": 2, "text": "TOOK LEAVE: A CHURCH EVENT"},
        {"week_number": 2, "text": "TOOK LEAVE: A CHURCH EVENT"},
        {"week_number": 5, "text": "PUBLIC HOLIDAY: EID EL-MAULUD"},
        {"week_number": 10, "text": "INDEPENDENCE DAY"},
        {"week_number": 12, "text": "Technical handoff and presentation."},
    ]
    reportable, excluded, notice = filter_reportable_entries(entries)
    assert len(excluded) == 7
    assert len(reportable) == 2
    assert notice == "We left out 7 entries about leave or public holidays."


def test_detect_week_gaps():
    entries = [
        {"week_number": 1, "text": "W1 work"},
        {"week_number": 2, "text": "W2 work"},
        {"week_number": 10, "text": "W10 work"},
        {"week_number": 12, "text": "W12 work"},
    ]
    gaps = detect_week_gaps(entries)
    gap_weeks = [g["week_number"] for g in gaps]
    assert 11 in gap_weeks
    assert any("Week 11 has no entries: missing page, or no entries that week?" in g["question"] for g in gaps)


def test_detect_and_clean_suspicious_tokens():
    suspicious_samples = [
        {"id": 1, "week_number": 4, "text": "Configured amphet extension allowlist on upload."},
        {"id": 2, "week_number": 4, "text": "Implemented profit exam topics authentication."},
        {"id": 3, "week_number": 5, "text": "Designed multi-hyper orchestration, SE streaming."},
        {"id": 4, "week_number": 6, "text": "Wrote Alchemy & Alembic Rails migrations."},
        {"id": 5, "week_number": 7, "text": "Approved improved wallet tax processing."},
        {"id": 6, "week_number": 8, "text": "Practiced Java IDEA! IDEA development."},
        {"id": 7, "week_number": 12, "text": "Deployed to RumptyCloud and tested pro Quiza."},
    ]
    queue = detect_suspicious_tokens(suspicious_samples)
    flagged = {q["flagged_token"] for q in queue}

    assert "amphet extension allowlist" in flagged
    assert "profit exam topics authentication" in flagged
    assert "multi-hyper orchestration, SE streaming" in flagged
    assert "Alchemy & Alembic Rails" in flagged
    assert "Approved improved wallet tax processing" in flagged
    assert "Java IDEA! IDEA" in flagged
    assert "RumptyCloud" in flagged
    assert "pro Quiza" in flagged

    cleaned = clean_ocr_suspicious_text("Wrote Alchemy & Alembic Rails migrations on RumptyCloud")
    assert "SQLAlchemy and Alembic migrations" in cleaned
    assert "Render Cloud" in cleaned
    assert "RumptyCloud" not in cleaned
    assert "Rails" not in cleaned


def test_clustering_and_synthesis():
    # Build 50 realistic logbook entries across weeks 1-10 and 12
    entries = []
    sample_tasks = [
        (1, "I developed the student report card preview module and added bulk-processing workflows."),
        (1, "I implemented backend validation filters for student grades and verified error handling."),
        (1, "I designed UI components for previewing report cards with interactive layout adjustments."),
        (1, "I configured background task triggers for grading computations using Celery."),
        (2, "I developed the teaching assignment module and added role-based access control."),
        (2, "I improved the administrator dashboard and resolved user session authentication bugs."),
        (2, "I tested newly deployed features in Butane staging environment."),
        (2, "I optimized database queries for student promotion systems and password ratings."),
        (3, "I designed ideation boards for the rate and blue board focusing on user testing."),
        (3, "I implemented the gymoraflow mobile application trainer messaging endpoints."),
        (3, "I configured WebSocket handlers for live trainer-to-client notifications."),
        (3, "I added real-time chat sync and verified message persistence in PostgreSQL."),
        (4, "I implemented file upload validation rules and allowed extension whitelists."),
        (4, "I configured HTTP security headers including HSTS and CSRF token protection."),
        (4, "I wrote automated backend integration tests covering authenticated endpoints."),
        (4, "I hardened API route permissions and eliminated unauthenticated parameter leaks."),
        (5, "I implemented the AI quiz generation service with RAG pipeline and SSE streaming."),
        (5, "I configured prompt chaining and response streaming using FastAPI and Celery."),
        (5, "I benchmarked LLM query latency and optimized embedding retrieval indexes."),
        (5, "I added error fallback mechanisms for stream interruptions in SSE endpoints."),
        (6, "I developed esports tournament bracket management algorithms and seed sorting."),
        (6, "I created live match result endpoints and match score update APIs."),
        (6, "I integrated Redis cache invalidation for real-time tournament standings."),
        (7, "I integrated Discord bot webhooks for tournament notifications and alerts."),
        (7, "I implemented wallet transaction processing workflows and balance adjustments."),
        (7, "I added transaction logging and cryptographic verification for payout events."),
        (8, "I studied object-oriented programming concepts in Java including polymorphism and encapsulation."),
        (8, "I practiced Java data structure implementations using collections and generics in IntelliJ IDEA."),
        (8, "I developed sample OOP services and executed unit tests using JUnit in IntelliJ."),
        (9, "I studied text contrast and layout tuning concepts using standard colours."),
        (9, "I designed high-fidelity wireframes and visual hierarchy tokens in Figma."),
        (9, "I created responsive interface design guidelines and iconography systems."),
        (10, "I developed corporate brand identity assets, promotional flyers, and social banners."),
        (10, "I compiled the brand identity guidelines booklet with typography hierarchies."),
        (10, "I reviewed digital design deliverables with creative leads and adjusted layouts."),
        (12, "I wrote comprehensive automated end-to-end tests using Playwright."),
        (12, "I tested AI service error recovery scenarios and validated production deployments on Render."),
        (12, "I prepared the technical documentation and conducted the final demonstration for the engineering team."),
        (12, "I completed the technical project handoff and documented deployment runbooks."),
    ]
    for wn, txt in sample_tasks:
        entries.append({"week_number": wn, "text": txt})

    try:
        from api.models import ReportProject, LogbookEntry
        proj = ReportProject.objects.filter(id=31).first()
        if proj:
            db_entries = list(LogbookEntry.objects.filter(project=proj).order_by("week_number", "day_of_week"))
            reportable, _, _ = filter_reportable_entries(db_entries)
            if len(reportable) >= 40:
                entries = reportable
    except Exception:
        pass

    clusters = cluster_logbook_entries(entries, org_name="Hypersence Technology")
    assert 5 <= len(clusters) <= 7

    total_words = sum(len(c["prose"].split()) for c in clusters)
    # 3-3.5 pages target ~900 to 1400 words on real logbook entries
    assert total_words >= 600, f"Expected substantial word volume for Section 3.2, got {total_words}"

    for c in clusters:
        assert c["week_range"].startswith("WEEK ")
        assert "Week " not in c["prose"]  # No 'Week N:' prefixes in prose

    # Skills derivation
    skills = derive_categorised_skills(clusters)
    assert "Practical engineering skills, system troubleshooting and professional teamwork" not in skills
    assert "1. Backend Web Development & API Architecture" in skills
    assert "2. Mobile Application Engineering" in skills
    assert "3. Object-Oriented Software Programming" in skills
    assert "4. UI/UX & Graphic Brand Identity Design" in skills
    assert "5. DevOps, Containerisation & Continuous Integration" in skills

    # Tools categorisation
    tools_str = categorise_tools(["Python", "Docker", "Git", "FastAPI", "Celery", "Figma", "Playwright"])
    assert "Programming Languages" in tools_str
    assert "Frameworks & Libraries" in tools_str
    assert "Databases & Cloud Platforms" in tools_str
    assert "Developer & Design Toolchains" in tools_str

    # Section 4.2 conclusion superlatives
    conc = synthesize_conclusion_section("Hypersence Technology", "Software Engineering Intern")
    assert "invaluable" not in conc.lower()
