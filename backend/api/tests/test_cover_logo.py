"""Pure tests for cover logo embedding, placement metadata, and resolver behavior.

These avoid Django DB setup by exercising the HTML->DOCX parser and resolver
directly with temporary assets.
"""
from __future__ import annotations

from pathlib import Path
import sys

import pytest
from docx import Document
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml.ns import qn
from docx.shared import Cm, Pt
from PIL import Image

# page_controller tests add backend/api to sys.path via MagicMock patterns; make
# local api package imports resilient when run from repo root.
BACKEND = Path(__file__).resolve().parents[2]
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

from api.document_exporter import SimpleHTMLDocxParser
from api.templates import LASUSTECH_STANDARD_V1, resolve_institution_logo_path


def _make_logo(path: Path, size=(400, 400)) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    Image.new("RGBA", size, (10, 40, 120, 255)).save(path, format="PNG")
    return path


def test_resolver_finds_configured_logo(tmp_path: Path):
    logo = _make_logo(tmp_path / "assets/institutions/lasustech/logo.png")
    spec = {
        "institution_asset": {
            "logo": {"path": "assets/institutions/lasustech/logo.png"}
        }
    }
    resolved = resolve_institution_logo_path(spec, tmp_path)
    assert resolved == logo.resolve()


def test_resolver_falls_back_to_canonical_name(tmp_path: Path):
    logo = _make_logo(tmp_path / "assets/institutions/lasustech/logo.png")
    spec = {
        "institution_asset": {
            "logo": {"path": "assets/institutions/lasustech/missing.png"}
        }
    }
    resolved = resolve_institution_logo_path(spec, tmp_path)
    assert resolved == logo.resolve()


def test_parser_embeds_centered_inline_logo_with_alt_and_spacing(tmp_path: Path, monkeypatch):
    # Make parser resolve project_root to tmp path by patching Path(__file__) in module? Easier: use a direct filesystem path in src.
    logo = _make_logo(tmp_path / "logo.png", size=(700, 700))
    doc = Document()
    logo_cfg = {
        "path": "assets/institutions/lasustech/logo.png",
        "width_cm": 3.2,
        "spacing_after_pt": 18,
        "alt_text": "LASUSTECH logo",
    }
    html = (
        f'<p style="text-align:center; margin:0 0 18pt 0;">'
        f'<img src="{logo}" alt="LASUSTECH logo"/></p>'
        '<p style="text-align:center">A TECHNICAL REPORT ON</p>'
    )
    parser = SimpleHTMLDocxParser(doc, default_align=WD_ALIGN_PARAGRAPH.CENTER, logo_cfg=logo_cfg)
    parser.feed(html)

    drawings = list(doc.element.body.iter(qn("w:drawing")))
    assert len(drawings) == 1
    drawing = drawings[0]
    # Inline picture (wp:inline), not floating anchor.
    assert drawing.find(qn("wp:inline")) is not None
    assert drawing.find(qn("wp:anchor")) is None

    doc_pr = drawing.find(".//" + qn("wp:docPr"))
    assert doc_pr is not None
    assert (doc_pr.get("descr") or doc_pr.get("title")) == "LASUSTECH logo"

    extent = drawing.find(".//" + qn("wp:extent"))
    cx = int(extent.get("cx"))
    cy = int(extent.get("cy"))
    expected = int(Cm(3.2).emu)
    assert abs(cx - expected) <= int(Cm(0.05).emu)
    assert abs(cx - cy) <= max(1, int(cx * 0.02))

    # Image paragraph centered with 18pt spacing after.
    p = None
    for para in doc.paragraphs:
        if para._p.find('.//' + qn('w:drawing')) is not None:
            p = para
            break
    assert p is not None
    assert p.alignment == WD_ALIGN_PARAGRAPH.CENTER
    assert p.paragraph_format.space_after == Pt(18)


def test_template_config_has_required_logo_fields():
    cfg = LASUSTECH_STANDARD_V1["institution_asset"]["logo"]
    assert cfg["path"].endswith("logo.png")
    assert cfg["width_cm"] == pytest.approx(3.2)
    assert cfg["spacing_after_pt"] == 18
    assert "Lagos State University" in cfg["alt_text"]
