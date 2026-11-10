import os
import sys
import uuid
from datetime import date
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
from api.models import ReportProject, LogbookEntry
from api.completeness import check_project_completeness


@pytest.mark.django_db
def test_completeness_auto_synthesizes_unit_and_duties():
    user = User.objects.create_user(username=f'u_{uuid.uuid4().hex[:8]}', password='password123')
    try:
        project = ReportProject.objects.create(
            user=user,
            title='SIWES Report',
            organization_name='Hypersence Technology',
            placement_department='Technical department',
            training_start_date=date(2026, 7, 27),
            training_end_date=date(2026, 10, 16),
            guided_intake={
                "organisation_what": "A software engineering and technology consulting company.",
                "organisation_objectives": "Building high-performance software and AI systems.",
                "head_title": "Chief Technology Officer",
                "organisation_units": ["Technical department", "Design", "Legal"],
            }
        )

        # Create verified logbook entry
        LogbookEntry.objects.create(
            project=project,
            week_number=1,
            day_of_week='Monday',
            entry_date='2026-07-27',
            verified_text='Configured developer environment and initialized git repo.',
            is_verified=True
        )

        res = check_project_completeness(project)
        # student_unit and duties should NOT be in missing_required_fields
        missing = res['missing_required_fields']
        assert 'guided_intake:student_unit' not in missing
        assert 'guided_intake:duties' not in missing
    finally:
        user.delete()
