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

from django.test import TestCase
from django.contrib.auth.models import User
from rest_framework.test import APIClient
from rest_framework import status
from api.models import ReportProject, StudentProfile, PaymentOrder, Report
from api.enums import UserTier
from api.serializers import ReportProjectSerializer


class TierSecurityTestCase(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.basic_user = User.objects.create_user(
            username='security_basic_user',
            password='testpassword123'
        )
        self.pro_user = User.objects.create_user(
            username='security_pro_user',
            password='testpassword123'
        )
        # Ensure pro profile has PRO tier
        self.pro_user.student_profile.tier = UserTier.PRO
        self.pro_user.student_profile.save()

        # Create basic project
        self.basic_project = ReportProject.objects.create(
            user=self.basic_user,
            title='Basic Student Report',
            tier=UserTier.BASIC
        )
        # Create pro project
        self.pro_project = ReportProject.objects.create(
            user=self.pro_user,
            title='Pro Student Report',
            tier=UserTier.PRO
        )

    def test_basic_user_cannot_set_tier_on_create(self):
        self.client.force_authenticate(user=self.basic_user)
        resp = self.client.post('/api/projects/', {
            'title': 'Attempted Pro Hack',
            'tier': 'pro',
            'is_pro': True
        })
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED)
        project_id = resp.data['id']
        project = ReportProject.objects.get(id=project_id)
        self.assertEqual(project.tier, UserTier.BASIC)
        self.assertFalse(project.is_pro)

    def test_basic_user_cannot_tamper_tier_on_patch(self):
        self.client.force_authenticate(user=self.basic_user)
        resp = self.client.patch(f'/api/projects/{self.basic_project.id}/', {
            'tier': 'pro',
            'is_pro': True
        })
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.basic_project.refresh_from_db()
        self.assertEqual(self.basic_project.tier, UserTier.BASIC)
        self.assertFalse(self.basic_project.is_pro)

    def test_basic_unpaid_user_blocked_from_export_docx(self):
        self.client.force_authenticate(user=self.basic_user)
        resp = self.client.get(f'/api/projects/{self.basic_project.id}/export/docx/')
        self.assertEqual(resp.status_code, status.HTTP_402_PAYMENT_REQUIRED)

    def test_basic_unpaid_user_blocked_from_export_pdf(self):
        self.client.force_authenticate(user=self.basic_user)
        resp = self.client.get(f'/api/projects/{self.basic_project.id}/export/pdf/')
        self.assertEqual(resp.status_code, status.HTTP_402_PAYMENT_REQUIRED)

    def test_basic_unpaid_user_blocked_from_export_download(self):
        self.client.force_authenticate(user=self.basic_user)
        resp = self.client.get(f'/api/projects/{self.basic_project.id}/export/download/?format=docx')
        self.assertEqual(resp.status_code, status.HTTP_402_PAYMENT_REQUIRED)

    def test_basic_unpaid_user_blocked_from_export_status_download_url(self):
        self.client.force_authenticate(user=self.basic_user)
        # Create mock report
        Report.objects.create(project=self.basic_project, title='Draft')
        resp = self.client.get(f'/api/projects/{self.basic_project.id}/export/status/?format=docx')
        self.assertEqual(resp.status_code, status.HTTP_402_PAYMENT_REQUIRED)
        self.assertIsNone(resp.data.get('download_url'))

    def test_basic_unpaid_user_blocked_from_squad_download(self):
        self.client.force_authenticate(user=self.basic_user)
        resp = self.client.get(f'/api/projects/{self.basic_project.id}/squad/download/docx/')
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)

    def test_basic_unpaid_serializer_does_not_leak_urls(self):
        # Create a report with dummy files
        report = Report.objects.create(project=self.basic_project, title='Report')
        report.docx_file = 'projects/dummy.docx'
        report.pdf_file = 'projects/dummy.pdf'
        report.save()

        data = ReportProjectSerializer(self.basic_project).data
        self.assertIsNone(data.get('docx_url'))
        self.assertIsNone(data.get('pdf_url'))

    def test_pro_user_inherits_tier_on_project_create(self):
        self.client.force_authenticate(user=self.pro_user)
        resp = self.client.post('/api/projects/', {
            'title': 'Pro Project Autocreated'
        })
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED)
        self.assertEqual(resp.data.get('tier'), 'pro')
        self.assertTrue(resp.data.get('is_pro'))

    def test_upgrading_user_profile_unlocks_all_projects(self):
        self.assertFalse(self.basic_project.is_pro)
        # Admin upgrades student profile to pro
        self.basic_user.student_profile.tier = UserTier.PRO
        self.basic_user.student_profile.save()
        self.basic_project.refresh_from_db()
        self.assertTrue(self.basic_project.is_pro)
        self.assertEqual(self.basic_project.effective_tier, UserTier.PRO)
