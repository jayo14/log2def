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
from api.models import ReportProject, SourceDocument


@pytest.mark.django_db
def test_project_long_poll_initial_snapshot():
    user = User.objects.create_user(username=f'u_{uuid.uuid4().hex[:8]}', password='password123')
    try:
        project = ReportProject.objects.create(
            user=user,
            title='SIWES Report',
            organization_name='Test Org'
        )
        client = APIClient()
        client.force_authenticate(user=user)

        res = client.get(f'/api/projects/{project.id}/poll/')
        assert res.status_code == 200
        data = res.json()
        assert data['has_changes'] is True
        assert 'state_hash' in data
        assert data['docs']['total'] == 0
        assert data['entries']['total'] == 0
    finally:
        user.delete()


@pytest.mark.django_db
def test_project_long_poll_timeout_no_changes():
    user = User.objects.create_user(username=f'u_{uuid.uuid4().hex[:8]}', password='password123')
    try:
        project = ReportProject.objects.create(
            user=user,
            title='SIWES Report 2',
            organization_name='Test Org'
        )
        client = APIClient()
        client.force_authenticate(user=user)

        # Initial snapshot to get hash
        res1 = client.get(f'/api/projects/{project.id}/poll/')
        assert res1.status_code == 200
        state_hash = res1.json()['state_hash']

        # Long poll with matching hash and short timeout (1 second)
        res2 = client.get(f'/api/projects/{project.id}/poll/?since={state_hash}&timeout=1')
        assert res2.status_code == 200
        data = res2.json()
        assert data['has_changes'] is False
        assert data['state_hash'] == state_hash
    finally:
        user.delete()


@pytest.mark.django_db
def test_project_long_poll_detects_document_change():
    user = User.objects.create_user(username=f'u_{uuid.uuid4().hex[:8]}', password='password123')
    try:
        project = ReportProject.objects.create(
            user=user,
            title='SIWES Report 3',
            organization_name='Test Org'
        )
        client = APIClient()
        client.force_authenticate(user=user)

        res1 = client.get(f'/api/projects/{project.id}/poll/')
        old_hash = res1.json()['state_hash']

        # Add a document
        SourceDocument.objects.create(
            project=project,
            original_filename='page_1.png',
            file_type='png',
            file_size=1024,
            page_index=0,
            status='processed'
        )

        # Long poll with old hash should return immediately with changes
        res2 = client.get(f'/api/projects/{project.id}/poll/?since={old_hash}&timeout=5')
        assert res2.status_code == 200
        data = res2.json()
        assert data['has_changes'] is True
        assert data['state_hash'] != old_hash
        assert data['docs']['total'] == 1
        assert data['docs']['processed'] == 1
    finally:
        user.delete()
