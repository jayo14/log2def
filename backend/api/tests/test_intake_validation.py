import os
import sys
from pathlib import Path
import pytest

BACKEND = Path(__file__).resolve().parents[2]
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "core.settings")
import django
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
