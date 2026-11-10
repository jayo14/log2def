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

from api.views import validate_intake_answer


def test_student_unit_short_text_allowed():
    # 2 words, short title
    err = validate_intake_answer("student_unit", "Technical department", required=True)
    assert err == ""

    # 1 word unit
    err_one_word = validate_intake_answer("student_unit", "Design", required=True)
    assert err_one_word == ""


def test_head_title_short_text_allowed():
    err = validate_intake_answer("head_title", "CTO", required=False)
    assert err == ""

    err_full = validate_intake_answer("head_title", "Chief Technology Officer", required=False)
    assert err_full == ""


def test_acknowledgement_allowed():
    err = validate_intake_answer("acknowledgement", "I appreciate the support of my team and mentors.", required=False)
    assert err == ""


def test_duties_and_tech_paragraphs_not_flagged_as_repetitive():
    text = (
        "I didn't go to the office due to the heavy downpour.\n"
        "I worked on an ideation board for the Rate & Blue board, focusing on user-tests, and good visual communication.\n"
        "I worked on the report card system by adding preview, system, and bulk-processing features, later improved the student promotion system & password ratings, and tested the new features in Butane.\n"
        "I studied text contrast and layout tuning concepts using standard colours, and executed visual elements.\n"
        "I developed the teaching assignment module, improved the dashboard, fixed system errors, added access control, and tested the new features on Butane."
    )
    err = validate_intake_answer("duties", text, required=True)
    assert err == ""

