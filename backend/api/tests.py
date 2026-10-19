import os
import io
from datetime import date
from django.test import TestCase
from django.contrib.auth.models import User
from django.core.files.uploadedfile import SimpleUploadedFile
from rest_framework.test import APIClient
from rest_framework import status
import docx
import pymupdf
from PIL import Image

from .models import (
    ReportProject, SourceDocument, ExtractedPage, 
    LogbookEntry, Report, ReportSection, DefenceQuestion
)
from .document_processor import process_source_document
from .report_generator import generate_full_report, regenerate_single_section
from .document_exporter import generate_docx_report, convert_docx_to_pdf, export_report_documents
from .defence_generator import generate_defence_questions


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
        # Verify page status is either processed or manual_correction_needed without crash
        self.assertIn(pages[0].status, ['processed', 'manual_correction_needed'])

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

        # Check export metadata
        self.project1.refresh_from_db()
        self.assertEqual(self.project1.status, 'exported')
        self.assertIsNotNone(self.project1.report.last_exported_at)

    def test_defence_questions_generation_and_mastery(self):
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
