import os
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[2]
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "core.settings")
import django
django.setup()

import io
import pytest
from datetime import date
from django.core.files.uploadedfile import SimpleUploadedFile
from django.contrib.auth import get_user_model
from api.models import ReportProject, SourceDocument, ExtractedPage, LogbookEntry
from api.security import validate_file_content
from api.page_classifier import classify_page
from api.document_processor import extract_logbook_entries_from_text

User = get_user_model()


@pytest.mark.django_db
def test_validate_file_content_various_formats():
    # 1. Plain text (.txt)
    txt_file = SimpleUploadedFile("logbook.txt", b"Monday: Configured router interface and tested Cat6 ethernet cable.", content_type="text/plain")
    assert validate_file_content(txt_file) == 'text'

    # 2. Markdown (.md)
    md_file = SimpleUploadedFile("notes.md", b"# Week 1 Log\nConfigured VLAN on Cisco catalyst switch.", content_type="text/markdown")
    assert validate_file_content(md_file) == 'text'

    # 3. PDF (%PDF-)
    pdf_file = SimpleUploadedFile("scan.pdf", b"%PDF-1.4 header content here...", content_type="application/pdf")
    assert validate_file_content(pdf_file) == 'pdf'

    # 4. PNG
    png_file = SimpleUploadedFile("photo.png", b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR", content_type="image/png")
    assert validate_file_content(png_file) == 'image'

    # 5. JPEG
    jpg_file = SimpleUploadedFile("photo.jpg", b"\xff\xd8\xff\xe0\x00\x10JFIF", content_type="image/jpeg")
    assert validate_file_content(jpg_file) == 'image'

    # 6. Legacy DOC OLE
    doc_file = SimpleUploadedFile("weekly.doc", b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1" + b"\x00" * 32, content_type="application/msword")
    assert validate_file_content(doc_file) == 'doc'


@pytest.mark.django_db
def test_extract_logbook_entries_no_unbound_local_error():
    user = User.objects.create_user(username="testdocuser", password="password123")
    project = ReportProject.objects.create(
        user=user,
        title="Network Attachment",
        training_start_date=date(2026, 6, 1),
        training_end_date=date(2026, 11, 30)
    )
    doc = SourceDocument.objects.create(
        project=project,
        original_filename="notes.txt",
        file_type="text"
    )
    page = ExtractedPage.objects.create(
        document=doc,
        page_number=1,
        page_index=0,
        extracted_text="Testing daily entries"
    )

    # Text has NO explicit "Week X" header, but mentions Monday and Tuesday
    text_with_days = (
        "Monday: Terminated Cat6 ethernet cables using RJ45 connectors and tested with cable tester.\n"
        "Tuesday: Configured Cisco 2960 switch VLAN 10 and VLAN 20 interfaces."
    )
    # Should not raise UnboundLocalError
    extract_logbook_entries_from_text(project, page, text_with_days, fallback_week=2)

    entries = list(project.logbook_entries.filter(source_page=page))
    assert len(entries) >= 2
    days = [e.day_of_week for e in entries]
    assert "Monday" in days
    assert "Tuesday" in days
    assert entries[0].week_number == 2


@pytest.mark.django_db
def test_classify_page_logbook_with_vision_entries():
    vision_data = {
        "entries": [
            {"day_of_week": "Monday", "activity_summary": "Network cable termination"}
        ]
    }
    result = classify_page("Some handwritten page text", vision_data=vision_data)
    assert result["page_type"] == "logbook"
    assert result["is_logbook"] is True
