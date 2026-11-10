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

import uuid
from django.contrib.auth.models import User
from rest_framework.test import APIClient
from api.models import ReportProject, Report


@pytest.mark.django_db
def test_export_status_no_report():
    user = User.objects.create_user(username=f'u_{uuid.uuid4().hex[:8]}', password='password123')
    project = ReportProject.objects.create(
        user=user,
        title='SIWES Report',
        organization_name='Test Org'
    )
    client = APIClient()
    client.force_authenticate(user=user)

    res = client.get(f'/api/projects/{project.id}/export/status/?format=pdf')
    assert res.status_code == 400
    assert "not generated yet" in res.json().get('error', '').lower()


@pytest.mark.django_db
def test_export_status_invalid_format():
    user = User.objects.create_user(username=f'u_{uuid.uuid4().hex[:8]}', password='password123')
    project = ReportProject.objects.create(
        user=user,
        title='SIWES Report 2',
        organization_name='Test Org'
    )
    Report.objects.create(project=project, version=1)
    client = APIClient()
    client.force_authenticate(user=user)

    res = client.get(f'/api/projects/{project.id}/export/status/?format=exe')
    assert res.status_code == 400
    assert "invalid format" in res.json().get('error', '').lower()


@pytest.mark.django_db
def test_export_status_timeout_handling():
    user = User.objects.create_user(username=f'u_{uuid.uuid4().hex[:8]}', password='password123')
    project = ReportProject.objects.create(
        user=user,
        title='SIWES Report 3',
        organization_name='Test Org'
    )
    Report.objects.create(project=project, version=1)
    client = APIClient()
    client.force_authenticate(user=user)

    # Calling with timeout=1 should not crash, returning valid status response
    res = client.get(f'/api/projects/{project.id}/export/status/?format=docx&timeout=1')
    assert res.status_code == 200
    data = res.json()
    assert data['format'] == 'docx'
    assert 'status' in data
