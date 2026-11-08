import os
import sys
import uuid
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
from api.models import ReportProject, Report, ReportSection, ReportParagraph, Fact, ReportTemplate


@pytest.mark.django_db
def test_cross_tenant_fact_citation_blocked():
    user1 = User.objects.create_user(username=f"u_{uuid.uuid4().hex[:8]}", password="password123")
    user2 = User.objects.create_user(username=f"u_{uuid.uuid4().hex[:8]}", password="password123")

    proj1 = ReportProject.objects.create(user=user1, title="Student 1 Project")
    proj2 = ReportProject.objects.create(user=user2, title="Student 2 Project")

    fact1 = Fact.objects.create(project=proj1, kind="activity", text="Student 1 Activity", status="confirmed")
    fact2 = Fact.objects.create(project=proj2, kind="activity", text="Student 2 Activity", status="confirmed")

    template, _ = ReportTemplate.objects.get_or_create(code="lasustech_cs", version="2.0.0")
    report1 = Report.objects.create(project=proj1, title="Report 1", template=template, template_version="lasustech_cs:2.0.0")

    # 1. Test ReportParagraph isolation: citing a fact from proj2 in report1 MUST be blocked
    para = ReportParagraph.objects.create(
        report=report1,
        section_key="ch3_activities",
        order=0,
        text="Student 1 claimed an action.",
        student_confirmed=True,
        origin="STUDENT_EDITED"
    )

    with pytest.raises(ValidationError, match="ReportParagraph cannot cite Facts belonging to another project"):
        para.facts.add(fact2)

    # 2. Citing proj1's own fact MUST succeed
    para.facts.add(fact1)
    assert fact1 in para.facts.all()

    # 3. Test ReportSection isolation: setting source_links to foreign fact MUST be blocked
    sec = ReportSection.objects.create(
        report=report1,
        section_key="ch3_activities",
        chapter_number=3,
        title="Activities Performed",
        order=10,
        is_required=True,
    )

    sec.source_links = [fact2.id]
    with pytest.raises(ValidationError, match="ReportSection cannot cite facts from another project"):
        sec.save()

    # 4. Setting source_links to proj1's own fact MUST succeed
    sec.source_links = [fact1.id]
    sec.save()
    assert sec.source_links == [fact1.id]
