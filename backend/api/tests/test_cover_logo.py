"""Pure tests for cover logo embedding, placement metadata, and resolver behavior.

Avoid Django app setup by loading modules with django/docx model deps mocked
where necessary.
"""
from __future__ import annotations

from pathlib import Path
import importlib.util
import sys
import types

import pytest
from docx import Document
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml.ns import qn
from docx.shared import Cm, Pt
from PIL import Image

BACKEND = Path(__file__).resolve().parents[2]
API = BACKEND / "api"


def _load(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    assert spec.loader
    spec.loader.exec_module(mod)
    return mod


_did_mock = False


def _mock_django_for_exporter():
    global _did_mock
    if "django" in sys.modules and getattr(sys.modules["django"], "__file__", None):
        return
    _did_mock = True
    django = types.ModuleType("django")
    conf = types.ModuleType("django.conf")
    conf.settings = types.SimpleNamespace(MEDIA_ROOT="/tmp")
    utils = types.ModuleType("django.utils")
    timezone = types.ModuleType("django.utils.timezone")
    timezone.now = lambda: None
    utils.timezone = timezone
    sys.modules["django"] = django
    sys.modules["django.conf"] = conf
    sys.modules["django.utils"] = utils
    sys.modules["django.utils.timezone"] = timezone
    models_mod = types.ModuleType("api.models")
    for n in ["Report", "ReportSection", "Fact", "LogbookEntry", "ReportParagraph"]:
        setattr(models_mod, n, type(n, (), {}))
    sys.modules["api.models"] = models_mod
    q_mod = types.ModuleType("api.document_quality")
    q_mod.QualityGateError = Exception
    q_mod.require_report_quality = lambda *a, **k: None
    q_mod.validate_docx_artifact = lambda *a, **k: None
    sys.modules["api.document_quality"] = q_mod
    if "api" not in sys.modules:
        pkg = types.ModuleType("api")
        pkg.__path__ = [str(API)]
        sys.modules["api"] = pkg


@pytest.fixture(autouse=True, scope="module")
def cleanup_mock_modules():
    yield
    if _did_mock:
        for name in ["api.document_quality", "api.models", "django", "django.conf", "django.utils", "django.utils.timezone"]:
            sys.modules.pop(name, None)


def _make_logo(path: Path, size=(400, 400)) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    Image.new("RGBA", size, (10, 40, 120, 255)).save(path, format="PNG")
    return path


def test_resolver_finds_configured_logo(tmp_path: Path):
    templates = _load("api.templates_testcover", API / "templates.py")
    logo = _make_logo(tmp_path / "assets/institutions/lasustech/logo.png")
    spec = {"institution_asset": {"logo": {"path": "assets/institutions/lasustech/logo.png"}}}
    resolved = templates.resolve_institution_logo_path(spec, tmp_path)
    assert resolved == logo.resolve()


def test_resolver_falls_back_to_canonical_name(tmp_path: Path):
    templates = _load("api.templates_testcover2", API / "templates.py")
    logo = _make_logo(tmp_path / "assets/institutions/lasustech/logo.png")
    spec = {"institution_asset": {"logo": {"path": "assets/institutions/lasustech/missing.png"}}}
    resolved = templates.resolve_institution_logo_path(spec, tmp_path)
    assert resolved == logo.resolve()


def test_parser_embeds_centered_inline_logo_with_alt_and_spacing(tmp_path: Path):
    _mock_django_for_exporter()
    exporter = _load("api.document_exporter_testcover", API / "document_exporter.py")
    # Make exporter's project_root resolve under tmp_path (backend/api/document_exporter.py -> parents[2]=project root)
    fake_backend_api = tmp_path / "backend" / "api"
    fake_backend_api.mkdir(parents=True)
    exporter.__file__ = str(fake_backend_api / "document_exporter.py")

    _make_logo(tmp_path / "assets/institutions/lasustech/logo.png", size=(700, 700))
    doc = Document()
    logo_cfg = {"path": "assets/institutions/lasustech/logo.png", "width_cm": 3.2, "spacing_after_pt": 18}
    html = (
        '<p style="text-align:center; margin:0 0 18pt 0;">'
        '<img src="/api/institutions/lasustech/logo/" alt="LASUSTECH logo"/></p>'
        '<p style="text-align:center">A TECHNICAL REPORT ON</p>'
    )
    parser = exporter.SimpleHTMLDocxParser(doc, default_align=WD_ALIGN_PARAGRAPH.CENTER, logo_cfg=logo_cfg)
    parser.feed(html)

    drawings = list(doc.element.body.iter(qn("w:drawing")))
    assert len(drawings) == 1
    drawing = drawings[0]
    assert drawing.find(qn("wp:inline")) is not None
    assert drawing.find(qn("wp:anchor")) is None
    doc_pr = drawing.find(".//" + qn("wp:docPr"))
    assert doc_pr is not None
    assert (doc_pr.get("descr") or doc_pr.get("title")) == "LASUSTECH logo"
    extent = drawing.find(".//" + qn("wp:extent"))
    cx = int(extent.get("cx")); cy = int(extent.get("cy"))
    expected = int(Cm(3.2).emu)
    assert abs(cx - expected) <= int(Cm(0.05).emu)
    assert abs(cx - cy) <= max(1, int(cx * 0.02))
    p = next(para for para in doc.paragraphs if para._p.find('.//' + qn('w:drawing')) is not None)
    assert p.alignment == WD_ALIGN_PARAGRAPH.CENTER
    assert p.paragraph_format.space_after == Pt(18)


def test_template_config_has_required_logo_fields():
    templates = _load("api.templates_testcover3", API / "templates.py")
    cfg = templates.LASUSTECH_STANDARD_V1["institution_asset"]["logo"]
    assert cfg["path"].endswith("logo.png")
    assert cfg["width_cm"] == pytest.approx(3.2)
    assert cfg["spacing_after_pt"] == 18
    assert "Lagos State University" in cfg["alt_text"]
