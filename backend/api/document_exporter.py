import os
import re
import logging
from html import escape
from types import SimpleNamespace
import shutil
import subprocess
from pathlib import Path
from html.parser import HTMLParser
import docx
from docx import Document

logger = logging.getLogger(__name__)
from docx.shared import Inches, Pt, RGBColor, Cm
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.oxml import OxmlElement, parse_xml
from docx.oxml.ns import nsdecls, qn
from django.conf import settings
from django.utils import timezone
from typing import TYPE_CHECKING
if TYPE_CHECKING:
    from .models import Report, ReportSection
else:
    Report = object
    ReportSection = object
from .document_quality import QualityGateError


class SimpleHTMLDocxParser(HTMLParser):
    """
    Parses basic HTML tags (<p>, <h3>, <h4>, <ul>, <ol>, <li>, <strong>, <em>, <table>, <tr>, <th>, <td>)
    and renders them directly into a python-docx Document with proper academic formatting.
    Defaults to justified body paragraphs per LASUSTECH formatting requirements.
    """
    def __init__(self, doc, default_align=WD_ALIGN_PARAGRAPH.JUSTIFY, logo_cfg=None, compact_cover=False, project_root=None):
        super().__init__()
        self.doc = doc
        self.default_align = default_align
        self.logo_cfg = logo_cfg or {}
        self.compact_cover = compact_cover
        self.project_root = project_root
        self.current_p = None
        self.bold = False
        self.italic = False
        self.list_type = None
        self.in_table = False
        self.table_rows = []
        self.current_row_cells = []
        self.current_cell_text = []

    def handle_starttag(self, tag, attrs):
        attrs_dict = dict(attrs)
        align_str = attrs_dict.get('style', '')

        if tag == 'table':
            self.in_table = True
            self.table_rows = []
            self.current_row_cells = []
            self.current_cell_text = []
            return

        if self.in_table:
            if tag == 'tr':
                self.current_row_cells = []
            elif tag in ['th', 'td']:
                self.current_cell_text = []
                if tag == 'th':
                    self.bold = True
            return

        if tag in ['p', 'div']:
            if self.compact_cover and tag == 'div':
                return
            if self.compact_cover and self.current_p is not None and not self.current_p.text.strip() and not self.current_p.runs:
                return
            self.current_p = self.doc.add_paragraph()
            compact = self.compact_cover and self.default_align == WD_ALIGN_PARAGRAPH.CENTER
            self.current_p.paragraph_format.line_spacing = 1.05 if compact else 1.5
            self.current_p.paragraph_format.space_after = Pt(2 if compact else 4)
            if 'text-align: center' in align_str:
                self.current_p.alignment = WD_ALIGN_PARAGRAPH.CENTER
            elif 'text-align: right' in align_str:
                self.current_p.alignment = WD_ALIGN_PARAGRAPH.RIGHT
            elif 'text-align: left' in align_str:
                self.current_p.alignment = WD_ALIGN_PARAGRAPH.LEFT
            else:
                self.current_p.alignment = self.default_align

        elif tag in ['h1', 'h2']:
            self.current_p = self.doc.add_paragraph()
            compact = self.compact_cover and self.default_align == WD_ALIGN_PARAGRAPH.CENTER
            self.current_p.paragraph_format.line_spacing = 1.15 if compact else 1.5
            self.current_p.paragraph_format.space_before = Pt(4 if compact else 14)
            self.current_p.paragraph_format.space_after = Pt(2 if compact else 6)
            self.current_p.alignment = WD_ALIGN_PARAGRAPH.CENTER if 'text-align: center' in align_str or compact else WD_ALIGN_PARAGRAPH.LEFT
            self.bold = True

        elif tag in ['h3', 'h4']:
            compact = self.compact_cover and self.default_align == WD_ALIGN_PARAGRAPH.CENTER
            if not compact:
                self.current_p = self.doc.add_paragraph(style='Heading 2')
            else:
                self.current_p = self.doc.add_paragraph()
            self.current_p.paragraph_format.line_spacing = 1.15 if compact else 1.5
            self.current_p.paragraph_format.space_before = Pt(2 if compact else 8)
            self.current_p.paragraph_format.space_after = Pt(2 if compact else 3)
            self.current_p.alignment = WD_ALIGN_PARAGRAPH.CENTER if compact else WD_ALIGN_PARAGRAPH.LEFT
            self.bold = True

        elif tag in ['strong', 'b']:
            self.bold = True

        elif tag in ['em', 'i']:
            self.italic = True

        elif tag == 'img' and attrs_dict.get('data-report-image') == 'true':
            src = attrs_dict.get('src', '')
            caption = attrs_dict.get('alt', '')
            abs_path = None
            image_stream = None

            if src.startswith(('data:image/', 'data:application/', 'data:')):
                try:
                    import base64
                    header, b64_str = src.split(',', 1)
                    image_stream = io.BytesIO(base64.b64decode(b64_str))
                except Exception as exc:
                    logger.warning("Could not decode base64 report image: %s", exc)
            elif src.startswith(('http://', 'https://')):
                try:
                    import requests
                    resp = requests.get(src, timeout=15)
                    if resp.status_code == 200:
                        image_stream = io.BytesIO(resp.content)
                except Exception as exc:
                    logger.warning("Could not download remote report image %s: %s", src, exc)

            if image_stream is None and not src.startswith('data:') and len(src) < 1024:
                try:
                    p_cand = Path(src)
                    if p_cand.exists() and p_cand.is_file():
                        abs_path = p_cand
                except OSError:
                    pass
                if abs_path is None:
                    clean_src = src.replace('/media/', '', 1).lstrip('/')
                    if hasattr(settings, 'MEDIA_ROOT'):
                        try:
                            m_cand = (Path(settings.MEDIA_ROOT) / clean_src).resolve()
                            if m_cand.exists() and m_cand.is_file():
                                abs_path = m_cand
                        except OSError:
                            pass
                    if abs_path is None:
                        from .templates import get_asset_roots
                        for root in get_asset_roots():
                            try:
                                c = (root / clean_src).resolve()
                                if c.exists() and c.is_file():
                                    abs_path = c
                                    break
                            except OSError:
                                pass

            # Fallback 1: Try downloading from S3 bucket if missing on local disk
            if abs_path is None and image_stream is None and not src.startswith('data:') and len(src) < 1024:
                try:
                    from .storage import download_object
                    clean_key = src.replace('/media/', '', 1).lstrip('/')
                    for candidate_key in [clean_key, f"organograms/{clean_key}", f"media/{clean_key}"]:
                        s3_bytes = download_object(candidate_key)
                        if s3_bytes:
                            image_stream = io.BytesIO(s3_bytes)
                            break
                except Exception as s3_err:
                    logger.warning("Could not download report image from storage: %s", s3_err)

            # Fallback 2: Dynamic synthesis for organogram if missing on disk and S3
            if abs_path is None and image_stream is None and not src.startswith('data:') and len(src) < 1024:
                match = re.search(r'organogram_proj_(\d+)\.png', src)
                if match:
                    try:
                        p_id = int(match.group(1))
                        from .models import ReportProject
                        proj = ReportProject.objects.filter(id=p_id).first()
                        if proj:
                            intake = getattr(proj, 'guided_intake', {}) or {}
                            if not isinstance(intake, dict):
                                intake = {}
                            from .organogram_builder import render_organogram_chart_png
                            render_organogram_chart_png(
                                project_id=proj.id,
                                head_title=intake.get("head_title") or "Managing Director",
                                units=intake.get("organisation_units") or ["Technical Department", "Operations", "Administration"],
                                placement_unit=intake.get("student_unit") or proj.placement_department or "Technical Department",
                                supervisor_title=intake.get("supervisor_title") or "Technical Lead",
                                student_role="SIWES Intern",
                            )
                            org_path = Path(settings.MEDIA_ROOT) / "organograms" / f"organogram_proj_{p_id}.png"
                            if org_path.exists() and org_path.is_file():
                                abs_path = org_path
                    except Exception as synth_err:
                        logger.warning("Could not synthesize organogram on demand for exporter: %s", synth_err)

            if abs_path is None and image_stream is None:
                logger.warning("Report image missing during export: %s", src[:64] if src else '')
                return

            from PIL import Image as PILImage
            target_to_open = image_stream if image_stream is not None else abs_path
            with PILImage.open(target_to_open) as pil_img:
                width, height = pil_img.size
            if image_stream is not None:
                image_stream.seek(0)
            scale = min(14.5 / max(width, 1), 8.0 / max(height, 1), 1.0)
            image_p = self.doc.add_paragraph()
            image_p.alignment = WD_ALIGN_PARAGRAPH.CENTER
            image_p.paragraph_format.space_after = Pt(0)
            image_p.paragraph_format.keep_with_next = True
            run = image_p.add_run()
            pic_source = image_stream if image_stream is not None else str(abs_path)
            run.add_picture(pic_source, width=Cm(width * scale))
            drawing = run._r.find(qn('w:drawing'))
            if drawing is not None:
                doc_pr = drawing.find('.//' + qn('wp:docPr'))
                if doc_pr is not None:
                    doc_pr.set('descr', caption)
                    doc_pr.set('title', caption)
            caption_p = self.doc.add_paragraph(style='Caption')
            caption_p.alignment = WD_ALIGN_PARAGRAPH.CENTER
            caption_p.paragraph_format.line_spacing = 1.0
            caption_p.paragraph_format.space_after = Pt(12)
            caption_p.paragraph_format.keep_together = True
            caption_run = caption_p.add_run(caption)
            caption_run.italic = True
            caption_run.font.name = 'Times New Roman'
            caption_run.font.size = Pt(11)
        elif tag == 'img':
            src = attrs_dict.get('src', '')
            alt = attrs_dict.get('alt', '')
            if not src:
                return
            # Resolve API-backed logo URLs to local file paths for DOCX embedding.
            abs_path = None
            from .templates import get_asset_roots
            logo_cfg = self.logo_cfg or {}
            configured_path = logo_cfg.get('path', '')
            roots = get_asset_roots(self.project_root) if hasattr(self, 'project_root') and self.project_root else get_asset_roots()
            if (not src.startswith('data:') and len(src) < 1024 and (src.startswith('/api/institutions/') or attrs_dict.get('data-src', '').startswith('/api/institutions/'))):
                for root in roots:
                    if configured_path:
                        try:
                            candidate = (root / configured_path).resolve()
                            if candidate.exists() and candidate.suffix.lower() != '.svg':
                                abs_path = str(candidate)
                                break
                        except OSError:
                            pass
                    inst_dir = root / 'assets' / 'institutions' / 'lasustech'
                    for name in ('logo.png', 'logo.web.png', 'logo.original.png'):
                        try:
                            candidate = (inst_dir / name).resolve()
                            if candidate.exists() and candidate.suffix.lower() != '.svg':
                                abs_path = str(candidate)
                                break
                        except OSError:
                            pass
                    if abs_path:
                        break
            if abs_path is None and src.startswith(('data:image', 'data:')):
                try:
                    import base64
                    import io
                    header, b64_str = src.split(',', 1)
                    image_stream = io.BytesIO(base64.b64decode(b64_str))
                    p = self.doc.add_paragraph()
                    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
                    p.paragraph_format.space_after = Pt(float(logo_cfg.get('spacing_after_pt', 18)))
                    run = p.add_run()
                    width_cm = float(logo_cfg.get('width_cm', 3.2))
                    run.add_picture(image_stream, width=Cm(width_cm))
                    expected_alt = logo_cfg.get('alt_text', 'Lagos State University of Science and Technology Logo')
                    drawing = run._r.find(qn('w:drawing'))
                    if drawing is not None:
                        doc_pr = drawing.find('.//' + qn('wp:docPr'))
                        if doc_pr is not None:
                            doc_pr.set('descr', expected_alt)
                            doc_pr.set('title', expected_alt)
                    return
                except Exception as b64_err:
                    logger.warning("Could not decode base64 logo: %s", b64_err)

            if abs_path is None and not src.startswith('data:') and len(src) < 1024:
                # Fallback: treat src as a direct filesystem path relative to candidate roots.
                for root in roots:
                    try:
                        candidate = (root / src.lstrip('/')).resolve()
                        if candidate.exists() and candidate.suffix.lower() != '.svg':
                            abs_path = str(candidate)
                            break
                    except OSError:
                        pass

            if abs_path is None and not src.startswith('data:') and len(src) < 1024:
                clean_src = src.replace('/media/', '', 1).lstrip('/')
                if hasattr(settings, 'MEDIA_ROOT'):
                    try:
                        m_cand = (Path(settings.MEDIA_ROOT) / clean_src).resolve()
                        if m_cand.exists() and m_cand.is_file():
                            abs_path = str(m_cand)
                    except OSError:
                        pass
                if abs_path is None:
                    try:
                        from .storage import download_object
                        for candidate_key in [clean_src, f"organograms/{clean_src}", f"media/{clean_src}"]:
                            s3_bytes = download_object(candidate_key)
                            if s3_bytes:
                                image_stream = io.BytesIO(s3_bytes)
                                break
                    except Exception:
                        pass

            if abs_path is None and image_stream is not None:
                p = self.doc.add_paragraph()
                p.alignment = WD_ALIGN_PARAGRAPH.CENTER
                p.paragraph_format.space_after = Pt(float(logo_cfg.get('spacing_after_pt', 18)))
                run = p.add_run()
                width_cm = float(logo_cfg.get('width_cm', 3.2))
                run.add_picture(image_stream, width=Cm(width_cm))
                expected_alt = logo_cfg.get('alt_text', 'Lagos State University of Science and Technology Logo')
                drawing = run._r.find(qn('w:drawing'))
                if drawing is not None:
                    doc_pr = drawing.find('.//' + qn('wp:docPr'))
                    if doc_pr is not None:
                        doc_pr.set('descr', expected_alt)
                        doc_pr.set('title', expected_alt)
                return

            if abs_path is None:
                # Logo missing: do not render a placeholder; log an error and skip.
                # CI/build can enforce presence via REQUIRE_REPORT_LOGO/CI checks.
                import os
                if os.environ.get('CI', '').lower() in {'1', 'true', 'yes'} or os.environ.get('REQUIRE_REPORT_LOGO', '').lower() in {'1', 'true', 'yes'}:
                    raise FileNotFoundError(
                        "Institution logo asset is missing for DOCX cover embedding; build/export cannot continue."
                    )
                logger.error("Institution logo asset missing for src '%s'; DOCX cover will omit the logo.", src[:64] if src else '')
                return
            width_cm = float(logo_cfg.get('width_cm', 3.2))
            # Ensure a paragraph exists for the image.
            if self.current_p is None:
                self.current_p = self.doc.add_paragraph()
                self.current_p.paragraph_format.line_spacing = 1.5
                self.current_p.paragraph_format.space_after = Pt(6)
                self.current_p.alignment = self.default_align
            # Centre the image in its own paragraph.
            self.current_p.alignment = WD_ALIGN_PARAGRAPH.CENTER
            spacing_pt = float(logo_cfg.get('spacing_after_pt', 18))
            self.current_p.paragraph_format.space_after = Pt(spacing_pt)
            run = self.current_p.add_run()
            run.add_picture(abs_path, width=Cm(width_cm))
            # Add alt text on the drawing's docPr (Word/OOXML-compatible).
            drawing = run._r.find(qn('w:drawing'))
            if drawing is not None:
                doc_pr = drawing.find('.//' + qn('wp:docPr'))
                if doc_pr is not None:
                    doc_pr.set('descr', alt)
                    if not doc_pr.get('title'):
                        doc_pr.set('title', alt)

        elif tag == 'ul':
            self.list_type = 'List Bullet'

        elif tag == 'ol':
            self.list_type = 'List Number'

        elif tag == 'li':
            self.current_p = self.doc.add_paragraph(style=self.list_type or 'List Bullet')
            self.current_p.paragraph_format.line_spacing = 1.5
            self.current_p.paragraph_format.space_after = Pt(4)
            self.current_p.alignment = self.default_align

        elif tag == 'br':
            if self.current_p:
                self.current_p.add_run().add_break()

    def handle_endtag(self, tag):
        if self.in_table:
            if tag in ['th', 'td']:
                cell_str = " ".join(self.current_cell_text).strip()
                self.current_row_cells.append(cell_str)
                self.current_cell_text = []
                self.bold = False
            elif tag == 'tr':
                if self.current_row_cells:
                    self.table_rows.append(self.current_row_cells)
                    self.current_row_cells = []
            elif tag == 'table':
                self.in_table = False
                if self.table_rows:
                    num_cols = max(len(r) for r in self.table_rows)
                    num_rows = len(self.table_rows)
                    if num_cols > 0 and num_rows > 0:
                        tbl = self.doc.add_table(rows=num_rows, cols=num_cols)
                        tbl.alignment = WD_TABLE_ALIGNMENT.CENTER
                        tblPr = tbl._tbl.tblPr
                        borders = parse_xml(
                            f'<w:tblBorders {nsdecls("w")}>'
                            f'<w:top w:val="single" w:sz="4" w:space="0" w:color="CCCCCC"/>'
                            f'<w:bottom w:val="single" w:sz="4" w:space="0" w:color="CCCCCC"/>'
                            f'<w:left w:val="none"/>'
                            f'<w:right w:val="none"/>'
                            f'<w:insideH w:val="single" w:sz="4" w:space="0" w:color="CCCCCC"/>'
                            f'<w:insideV w:val="none"/>'
                            f'</w:tblBorders>'
                        )
                        tblPr.append(borders)
                        for r_idx, row_data in enumerate(self.table_rows):
                            for c_idx, cell_data in enumerate(row_data):
                                if c_idx < num_cols:
                                    cell = tbl.cell(r_idx, c_idx)
                                    p = cell.paragraphs[0]
                                    p.paragraph_format.line_spacing = 1.15
                                    p.paragraph_format.space_after = Pt(2)
                                    run = p.add_run(cell_data)
                                    run.font.name = 'Times New Roman'
                                    run.font.size = Pt(10)
                                    if r_idx == 0:
                                        run.bold = True
                        p_spacer = self.doc.add_paragraph()
                        p_spacer.paragraph_format.space_before = Pt(4)
                        p_spacer.paragraph_format.space_after = Pt(4)
                self.table_rows = []
                self.current_row_cells = []
                self.current_cell_text = []
            return

        if tag in ['strong', 'b', 'h1', 'h2', 'h3', 'h4']:
            self.bold = False
        elif tag in ['em', 'i']:
            self.italic = False
        elif tag in ['ul', 'ol']:
            self.list_type = None

    def handle_data(self, data):
        cleaned = data.strip()
        if not cleaned:
            return

        if self.in_table:
            self.current_cell_text.append(data.strip())
            return

        if self.current_p is None:
            self.current_p = self.doc.add_paragraph()
            self.current_p.paragraph_format.line_spacing = 1.5
            self.current_p.paragraph_format.space_after = Pt(6)
            self.current_p.alignment = self.default_align

        run = self.current_p.add_run(data)
        run.bold = self.bold
        run.italic = self.italic
        run.font.name = 'Times New Roman'
        run.font.size = Pt(12)


def set_academic_margins(section, v2: bool = False):
    """
    Applies standard Nigerian academic margins for binding:
    Left: 1.5 inches (binding side)
    Right: 1.0 inch
    Top: 1.0 inch
    Bottom: 1.0 inch
    Page size: A4 (8.27 x 11.69 inches)
    """
    section.page_width = Inches(8.27)
    section.page_height = Inches(11.69)
    if v2:
        section.left_margin = section.right_margin = section.top_margin = section.bottom_margin = Cm(2.54)
    else:
        section.left_margin = Inches(1.5)
        section.right_margin = Inches(1.0)
        section.top_margin = Inches(1.0)
        section.bottom_margin = Inches(1.0)


def add_footer_page_number(section, fmt="decimal", start=None, label: str = ""):
    """
    Configures footer page numbering for a python-docx Section using OOXML fields.
    fmt: 'lowerRoman' (i, ii, iii) or 'decimal' (1, 2, 3)
    start: optional integer starting page number (e.g. 1)
    """
    sectPr = section._sectPr
    # Clean any existing pgNumType element
    for child in list(sectPr):
        if child.tag.endswith('pgNumType'):
            sectPr.remove(child)

    pg_num_xml = f'<w:pgNumType {nsdecls("w")} w:fmt="{fmt}"'
    if start is not None:
        pg_num_xml += f' w:start="{start}"'
    pg_num_xml += '/>'
    sectPr.append(parse_xml(pg_num_xml))

    footer = section.footer
    footer_p = footer.paragraphs[0] if footer.paragraphs else footer.add_paragraph()
    footer_p.text = ""
    footer_p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    footer_p.paragraph_format.space_before = Pt(6)
    footer_p.paragraph_format.space_after = Pt(0)

    run = footer_p.add_run(label)
    run.font.name = 'Times New Roman'
    run.font.size = Pt(10)
    fldSimple = parse_xml(r'<w:fldSimple %s w:instr="PAGE"/>' % nsdecls('w'))
    run._r.append(fldSimple)


def render_table_of_contents_section(doc, prelim_sections: list, body_sections: list, v2: bool = False):
    """
    Generates a realistic Table of Contents with dot leaders and exact page numbers,
    along with Word's native TOC XML instruction.
    """
    p_header = doc.add_paragraph()
    p_header.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p_header.paragraph_format.space_before = Pt(12)
    p_header.paragraph_format.space_after = Pt(18)
    r_head = p_header.add_run("TABLE OF CONTENTS")
    r_head.bold = True
    r_head.font.name = 'Times New Roman'
    r_head.font.size = Pt(14)

    # Word XML field for dynamic updates
    fld_p = doc.add_paragraph()
    fld_p.paragraph_format.space_after = Pt(6)
    r_fld = fld_p.add_run()
    r_fld._r.append(parse_xml(r'<w:fldSimple %s w:instr="TOC \o &quot;1-3&quot; \h \z \u"/>' % nsdecls('w')))

    # Add realistic pre-rendered TOC entry items with dot leaders and page numbers
    if v2:
        toc_entries = [
            ("Title Page", "i", False),
            ("Certification", "ii", False),
            ("Dedication", "iii", False),
            ("Acknowledgement", "iv", False),
            ("Table of Contents", "v", False),
            ("CHAPTER ONE: INTRODUCTION", "1", True),
            ("  1.1 Background of SIWES", "1", False),
            ("  1.2 Objectives of SIWES", "1", False),
            ("  1.3 Importance of SIWES", "1", False),
            ("  1.4 Scope of the Training", "2", False),
            ("  1.5 Duration of the Training", "2", False),
            ("CHAPTER TWO: BRIEF HISTORY AND ORGANISATIONAL STRUCTURE", "3", True),
            ("  2.1 Brief History of the Organisation", "3", False),
            ("  2.2 Objectives of the Organisation", "3", False),
            ("  2.3 Organisational Structure", "3", False),
            ("  2.4 Organogram of the Organisation", "3", False),
            ("CHAPTER THREE: ACTIVITIES AND EXPERIENCE DURING SIWES", "5", True),
            ("  3.1 Duties and Responsibilities", "5", False),
            ("  3.2 Activities Performed", "5", False),
            ("  3.3 Skills Acquired and Practical Experience", "8", False),
            ("  3.4 Equipment/Tools Used", "9", False),
            ("  3.5 Challenges Encountered", "9", False),
            ("  3.6 Solutions to Challenges Encountered", "10", False),
            ("CHAPTER FOUR: SUMMARY, CONCLUSION AND RECOMMENDATIONS", "11", True),
            ("  4.1 Summary", "11", False),
            ("  4.2 Conclusion", "11", False),
            ("  4.3 Recommendations", "11", False),
            ("REFERENCES", "12", True),
        ]
    else:
        toc_entries = [
        ("Title Page", "ii", False),
        ("Declaration", "iii", False),
        ("Certification & Approval", "iv", False),
        ("Dedication", "v", False),
        ("Acknowledgements", "vi", False),
        ("Abstract / Executive Summary", "vii", False),
        ("Table of Contents", "viii", False),
        ("CHAPTER ONE: INTRODUCTION", "1", True),
        ("  1.1 Background to SIWES", "1", False),
        ("  1.2 Objectives of Industrial Training", "2", False),
        ("  1.3 Scope and Significance of the Scheme", "2", False),
        ("CHAPTER TWO: ORGANIZATION PROFILE", "3", True),
        ("  2.1 Company Background and Overview", "3", False),
        ("  2.2 Organizational Structure & Key Operations", "4", False),
        ("  2.3 Department of Placement and Responsibilities", "4", False),
        ("CHAPTER THREE: TRAINING ACTIVITIES & TECHNICAL EXPERIENCE", "5", True),
        ("  3.1 Training Environment & Workflow", "5", False),
        ("  3.2 Tools, Technologies & Equipment Used", "5", False),
        ("  3.3 Weekly Chronological Summary of Activities", "6", False),
        ("  3.4 Detailed Technical Procedures and Tasks", "7", False),
        ("  3.5 Specific Projects Undertaken", "8", False),
        ("CHAPTER FOUR: SKILLS ACQUIRED, CHALLENGES AND SOLUTIONS", "9", True),
        ("  4.1 Skills and Knowledge Acquired", "9", False),
        ("  4.2 Challenges and Problems Encountered", "10", False),
        ("  4.3 Solutions Attempted and Troubleshooting Strategies", "10", False),
        ("  4.4 Professional Lessons Learned", "11", False),
        ("CHAPTER FIVE: CONCLUSION AND RECOMMENDATIONS", "12", True),
        ("  5.1 Summary of Training Experience", "12", False),
        ("  5.2 Assessment of SIWES Objectives Realization", "12", False),
        ("  5.3 Recommendations", "13", False),
        ("REFERENCES AND APPENDICES", "14", True),
    ]

    for title, page_str, is_major in toc_entries:
        p = doc.add_paragraph()
        p.paragraph_format.line_spacing = 1.15
        p.paragraph_format.space_before = Pt(3 if is_major else 1)
        p.paragraph_format.space_after = Pt(2)

        # Tab stop for dot leader
        r_title = p.add_run(title)
        r_title.font.name = 'Times New Roman'
        r_title.font.size = Pt(11)
        r_title.bold = is_major

        # Fill dots
        dot_count = max(4, 75 - len(title) - len(page_str))
        dots = " " + ("." * dot_count) + " "
        r_dots = p.add_run(dots)
        r_dots.font.name = 'Times New Roman'
        r_dots.font.size = Pt(9)
        r_dots.font.color.rgb = RGBColor(0x88, 0x88, 0x88)

        r_page = p.add_run(page_str)
        r_page.font.name = 'Times New Roman'
        r_page.font.size = Pt(11)
        r_page.bold = is_major


def document_node_to_html(node: dict) -> str:
    """Serialize a canonical typed node for the existing DOCX HTML parser."""
    node_type = node.get("type")
    text = escape(node.get("text", "")).replace("\n", "<br/>")
    children = "".join(document_node_to_html(child) for child in node.get("children", []))
    if node_type == "container":
        return f"<div>{children}</div>" if children else (f"<div>{text}</div>" if text else "")
    if node_type == "paragraph":
        return f"<p>{text}{children}</p>"
    if node_type == "heading":
        level = min(4, max(2, int(node.get("attrs", {}).get("level", 2))))
        return f"<h{level}>{text}{children}</h{level}>"
    if node_type in {"list", "list_item"}:
        if node_type == "list":
            tag = "ol" if node.get("attrs", {}).get("ordered") else "ul"
            items = "".join(f"<li>{escape(child.get('text', ''))}{''.join(document_node_to_html(grandchild) for grandchild in child.get('children', []))}</li>" for child in node.get("children", []))
            return f"<{tag}>{items}</{tag}>"
        return f"<li>{text}{children}</li>"
    if node_type == "table":
        return f"<table>{children}</table>"
    if node_type == "row":
        return f"<tr>{children}</tr>"
    if node_type == "cell":
        return f"<td>{text}{children}</td>"
    if node_type == "figure":
        src = node.get("attrs", {}).get("src", "")
        caption = escape(node.get("attrs", {}).get("caption", ""))
        if src:
            if src.startswith("/api/institutions/") or "logo" in src:
                return f'<img src="{escape(src)}" alt="{escape(caption)}"/>'
            return f'<img data-report-image="true" src="{escape(src)}" alt="{escape(caption)}"/>'
        return f"<p>{caption}</p>" if caption else ""
    return text + children


def generate_docx_report(report: Report, enforce_quality: bool = True) -> str:
    """
    Builds a professional, properly formatted A4 Word document for the SIWES report.
    Adheres strictly to LASUSTECH formatting requirements:
    - Font: Times New Roman, 12pt body, 1.5 line spacing, justified.
    - Margins: 1.5 inches left (binding), 1.0 inch right, top, bottom.
    - Pagination:
      * Section 1 (Cover): No visible page number.
      * Section 2 (Prelims): Lowercase Roman numerals (i, ii, iii...).
      * Section 3 (Main Body): Decimal Arabic numerals (1, 2, 3...) restarting at 1 at Chapter One.
      * Table of Contents with real page numbers.
    """
    from .document_quality import require_report_quality, validate_docx_artifact
    if enforce_quality:
        require_report_quality(report)
    doc = Document()
    is_v2 = report.template_version == "lasustech_cs:2.0.0"
    if is_v2:
        update_fields = OxmlElement("w:updateFields")
        update_fields.set(qn("w:val"), "true")
        doc.settings.element.append(update_fields)

    # Institution logo is a template-level asset (students cannot change it).
    template_snapshot = report.template_snapshot if isinstance(report.template_snapshot, dict) else {}
    logo_cfg = (template_snapshot.get("institution_asset", {}) or {}).get("logo", {}) or {}

    # Configure base Normal style
    normal_style = doc.styles['Normal']
    normal_style.font.name = 'Times New Roman'
    normal_style.font.size = Pt(12)
    normal_style.font.color.rgb = RGBColor(0x11, 0x18, 0x27)
    if is_v2:
        for style_name in ("Heading 1", "Heading 2", "Heading 3"):
            heading_style = doc.styles[style_name]
            heading_style.font.name = "Times New Roman"
            heading_style.font.size = Pt(14 if style_name == "Heading 1" else 12)
            heading_style.font.bold = True

    if not is_v2:
        # Keep the v1 section content path unchanged for pinned legacy reports.
        all_sections = list(report.sections.all().order_by('chapter_number', 'order', 'id'))
    else:
        model = report.document_model
        if not model or not model.get("sections"):
            from .document_model import model_from_sections
            from .templates import get_template_spec
            model = model_from_sections(report, report.template_snapshot or get_template_spec()).to_dict()
        logo_alt = (logo_cfg.get('alt_text') if isinstance(logo_cfg, dict) else '') or 'Institution logo'
        logo_img = f'<img src="/api/institutions/lasustech/logo/" alt="{logo_alt}"/>'
        all_sections = []
        for section in model.get("sections", []):
            rendered = [document_node_to_html(node) for node in section.get("nodes", [])]
            content = "".join(rendered)
            if section.get('key') == 'title_page' and '/api/institutions/' not in content:
                content = logo_img + content
            all_sections.append(SimpleNamespace(
                section_key=section.get("key", ""),
                chapter_number=section.get("chapter", 0),
                title=section.get("title", ""),
                chapter_title=section.get("chapter_title", ""),
                content=content,
            ))
    cover_key = "title_page" if is_v2 else "cover"
    cover_sec = next((s for s in all_sections if s.section_key == cover_key), None)
    prelim_secs = [s for s in all_sections if s.chapter_number == 0 and s.section_key != cover_key]
    body_secs = [s for s in all_sections if s.chapter_number > 0]

    # --- SECTION 1: COVER PAGE ---
    sec1 = doc.sections[0]
    set_academic_margins(sec1, v2=is_v2)
    sec1.different_first_page_header_footer = not (is_v2 and report.template_options.get("cover_numbered", True))
    # Ensure header & footer on cover page are blank (no visible page number)
    sec1.first_page_header.is_linked_to_previous = False
    sec1.first_page_footer.is_linked_to_previous = False
    if is_v2 and not sec1.different_first_page_header_footer:
        sec1.footer.is_linked_to_previous = False
        add_footer_page_number(sec1, fmt="lowerRoman", start=1)

    if cover_sec:
        parser = SimpleHTMLDocxParser(doc, default_align=WD_ALIGN_PARAGRAPH.CENTER, logo_cfg=logo_cfg, compact_cover=True)
        parser.feed(cover_sec.content or "")

    # --- SECTION 2: PRELIMINARY PAGES (Title Page to TOC) ---
    if prelim_secs:
        sec2 = doc.add_section()
        set_academic_margins(sec2, v2=is_v2)
        sec2.different_first_page_header_footer = False
        sec2.header.is_linked_to_previous = False
        sec2.footer.is_linked_to_previous = False
        # Lowercase Roman numerals starting at ii (page 2)
        add_footer_page_number(sec2, fmt="lowerRoman", start=2)

        for p_idx, p_sec in enumerate(prelim_secs):
            if p_idx > 0:
                doc.add_page_break()

            if p_sec.section_key == "table_of_contents":
                render_table_of_contents_section(doc, prelim_secs, body_secs, v2=is_v2)
            else:
                if is_v2 and p_sec.content:
                    heading = doc.add_paragraph(style=doc.styles["Heading 1"])
                    heading.alignment = WD_ALIGN_PARAGRAPH.CENTER
                    heading.add_run(p_sec.title.upper())
                p_parser = SimpleHTMLDocxParser(doc)
                p_parser.feed(p_sec.content or "")

    # --- SECTION 3: MAIN BODY (Chapters 1 to 5, References & Appendices) ---
    if body_secs:
        sec3 = doc.add_section()
        set_academic_margins(sec3, v2=is_v2)
        sec3.different_first_page_header_footer = False
        sec3.header.is_linked_to_previous = False
        sec3.footer.is_linked_to_previous = False
        # Decimal Arabic numerals starting at 1
        add_footer_page_number(sec3, fmt="decimal", start=1, label="Page " if is_v2 else "")

        current_chapter = None
        for b_idx, b_sec in enumerate(body_secs):
            if current_chapter != b_sec.chapter_number:
                if b_idx > 0:
                    doc.add_page_break()
                current_chapter = b_sec.chapter_number

                if is_v2:
                    ch_titles_v2 = {
                        1: "CHAPTER ONE\nINTRODUCTION",
                        2: "CHAPTER TWO\nBRIEF HISTORY AND ORGANISATIONAL STRUCTURE",
                        3: "CHAPTER THREE\nACTIVITIES AND EXPERIENCE DURING SIWES",
                        4: "CHAPTER FOUR\nSUMMARY, CONCLUSION AND RECOMMENDATIONS",
                        5: "REFERENCES",
                        6: "APPENDICES"
                    }
                    header_text = ch_titles_v2.get(b_sec.chapter_number, f"CHAPTER {b_sec.chapter_number}")
                else:
                    ch_titles = {
                        1: "CHAPTER ONE\nINTRODUCTION",
                        2: "CHAPTER TWO\nORGANIZATION PROFILE",
                        3: "CHAPTER THREE\nTRAINING ACTIVITIES AND TECHNICAL EXPERIENCE",
                        4: "CHAPTER FOUR\nSKILLS ACQUIRED, CHALLENGES AND SOLUTIONS",
                        5: "CHAPTER FIVE\nCONCLUSION AND RECOMMENDATIONS",
                        6: "REFERENCES AND APPENDICES"
                    }
                    header_text = getattr(b_sec, "chapter_title", "") or ch_titles.get(b_sec.chapter_number, f"CHAPTER {b_sec.chapter_number}")
                ch_p = doc.add_paragraph()
                if is_v2:
                    ch_p.style = doc.styles["Heading 1"]
                ch_p.alignment = WD_ALIGN_PARAGRAPH.CENTER
                ch_p.paragraph_format.space_before = Pt(12)
                ch_p.paragraph_format.space_after = Pt(10)
                run = ch_p.add_run(header_text)
                run.bold = True
                run.font.name = 'Times New Roman'
                run.font.size = Pt(14)

            if b_sec.chapter_number > 0 and b_sec.section_key not in ["references", "appendices"]:
                sub_p = doc.add_paragraph()
                if is_v2:
                    sub_p.style = doc.styles["Heading 2"]
                sub_p.paragraph_format.space_before = Pt(8)
                sub_p.paragraph_format.space_after = Pt(3)
                sub_p.alignment = WD_ALIGN_PARAGRAPH.LEFT
                sub_run = sub_p.add_run(b_sec.title)
                sub_run.bold = True
                sub_run.font.name = 'Times New Roman'
                sub_run.font.size = Pt(12)

            b_parser = SimpleHTMLDocxParser(doc, default_align=WD_ALIGN_PARAGRAPH.JUSTIFY, logo_cfg=logo_cfg)
            b_parser.feed(b_sec.content or "")

    # Explicitly set every run, including style and field runs, so Word does not
    # substitute a theme font for headings, TOC fields, or page labels.
    paragraphs = list(doc.paragraphs)
    for table in doc.tables:
        for row in table.rows:
            for cell in row.cells:
                paragraphs.extend(cell.paragraphs)
    for section in doc.sections:
        paragraphs.extend(section.header.paragraphs)
        paragraphs.extend(section.footer.paragraphs)
    if is_v2:
        for paragraph in paragraphs:
            for run in paragraph.runs:
                run.font.name = "Times New Roman"
                r_pr = run._element.get_or_add_rPr()
                fonts = r_pr.rFonts
                if fonts is None:
                    fonts = OxmlElement("w:rFonts")
                    r_pr.insert(0, fonts)
                for attribute in ("ascii", "hAnsi", "eastAsia", "cs"):
                    fonts.set(qn(f"w:{attribute}"), "Times New Roman")

    export_dir = Path(settings.MEDIA_ROOT) / "projects" / str(report.project.id) / "exports"
    export_dir.mkdir(parents=True, exist_ok=True)

    clean_title = re.sub(r'[^a-zA-Z0-9_\-]', '_', report.project.title or "SIWES_Report")
    docx_filename = f"{clean_title}_v{report.version}.docx"
    docx_path = export_dir / docx_filename

    doc.save(str(docx_path))

    if enforce_quality:
        try:
            validate_docx_artifact(report, docx_path)
        except Exception:
            if docx_path.exists():
                docx_path.unlink()
            raise

    rel_path = f"projects/{report.project.id}/exports/{docx_filename}"
    report.docx_file.name = rel_path
    report.last_exported_at = timezone.now()
    report.save(update_fields=['docx_file', 'last_exported_at'])

    try:
        from .storage import upload_object
        upload_object(key=rel_path, body=str(docx_path), content_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document")
    except Exception as exc:
        logger.warning("Failed to upload DOCX to S3: %s", exc)

    return str(docx_path)


def convert_docx_to_pdf(docx_path: str) -> str:
    """
    Renders DOCX into PDF using headless LibreOffice.
    Validates output PDF size and magic bytes.
    Returns the absolute path to the PDF.
    """
    if not os.path.exists(docx_path):
        raise FileNotFoundError(f"Source DOCX file not found: {docx_path}")

    out_dir = str(Path(docx_path).parent)
    libreoffice_bin = getattr(settings, 'LIBREOFFICE_PATH', 'libreoffice')
    resolved_bin = (libreoffice_bin if os.path.isabs(libreoffice_bin) and os.path.exists(libreoffice_bin) else None) or shutil.which(libreoffice_bin) or shutil.which('libreoffice')
    if not resolved_bin:
        raise FileNotFoundError(f"LibreOffice executable not found at '{libreoffice_bin}' or in system PATH.")
    libreoffice_bin = resolved_bin

    import tempfile
    with tempfile.TemporaryDirectory(prefix="lo_profile_") as profile_dir:
        cmd = [
            libreoffice_bin,
            f"-env:UserInstallation=file://{profile_dir}",
            '--headless',
            '--convert-to', 'pdf',
            '--outdir', out_dir,
            docx_path
        ]

        result = subprocess.run(cmd, capture_output=True, text=True, timeout=90)
        if result.returncode != 0:
            raise RuntimeError(f"LibreOffice PDF conversion failed: {result.stderr or result.stdout}")

    pdf_path = os.path.splitext(docx_path)[0] + '.pdf'

    if not os.path.exists(pdf_path):
        raise FileNotFoundError(f"PDF was not generated at expected path: {pdf_path}")

    file_size = os.path.getsize(pdf_path)
    if file_size < 1000:
        raise ValueError(f"Generated PDF is suspiciously small ({file_size} bytes). Conversion may be corrupted.")

    with open(pdf_path, 'rb') as f:
        header = f.read(5)
        if not header.startswith(b'%PDF-'):
            raise ValueError("Generated file is not a valid PDF document (missing %PDF header).")

    return pdf_path


def export_report_documents(report: Report, enforce_quality: bool = True) -> dict:
    """
    Executes both DOCX generation and PDF conversion with full validation.
    Enforces strict 12-15 page range via the Page Budget Controller.
    Returns dict with file paths, metadata, and page count info.
    """
    from .page_controller import (
        validate_page_range,
        count_docx_pages,
        count_pdf_pages,
        get_page_settings,
        compute_section_budgets,
        condense_section_content,
        rank_facts_by_importance,
        REQUIRED_SECTION_ORDER,
    )
    from .models import ReportSection, Fact

    settings_ = get_page_settings(report)
    max_pages = settings_["max_pages"]
    min_pages = settings_["min_pages"]

    max_passes = 3
    pass_count = 0

    while pass_count < max_passes:
        pass_count += 1

        # Generate DOCX
        docx_path = generate_docx_report(report, enforce_quality=enforce_quality)

        # Convert to PDF and count actual pages
        pdf_path = convert_docx_to_pdf(docx_path)
        actual_pages = count_pdf_pages(pdf_path)

        # Validate page range
        page_result = validate_page_range(actual_pages, min_pages=min_pages, max_pages=max_pages)

        if page_result.within_range:
            # Pages within range - save and export
            _save_page_metadata(report, actual_pages, "within_range", pass_count)
            break

        if page_result.over_limit and pass_count < max_passes:
            # Over limit: condense sections and regenerate
            _condense_report_sections(report, max_pages)
            continue

        # Either over limit after max passes, or under limit
        break

    # Re-render final version
    docx_path = generate_docx_report(report, enforce_quality=enforce_quality)
    pdf_path = convert_docx_to_pdf(docx_path)
    actual_pages = count_pdf_pages(pdf_path)
    page_result = validate_page_range(actual_pages, min_pages=min_pages, max_pages=max_pages)

    if page_result.over_limit:
        _save_page_metadata(report, actual_pages, "over_limit", pass_count)
        if enforce_quality:
            # Clean up the oversized file
            if os.path.exists(docx_path):
                os.unlink(docx_path)
            if os.path.exists(pdf_path):
                os.unlink(pdf_path)
            raise QualityGateError({
                "passed": False,
                "blockers": [{
                    "code": "page_limit_exceeded",
                    "message": f"Report is {actual_pages} pages. Maximum allowed is {max_pages} pages. Condense sections and retry.",
                    "section_key": None,
                }],
                "warnings": [],
                "summary": {
                    "total_pages": actual_pages,
                    "blocker_count": 1,
                    "page_range_status": "over_limit",
                },
            })

    if page_result.under_limit:
        _save_page_metadata(report, actual_pages, "under_limit", pass_count)
    else:
        _save_page_metadata(report, actual_pages, "within_range", pass_count)

    pdf_filename = os.path.basename(pdf_path)
    rel_pdf_path = f"projects/{report.project.id}/exports/{pdf_filename}"

    report.pdf_file.name = rel_pdf_path
    report.project.status = 'exported'
    report.project.save(update_fields=['status'])
    report.save(update_fields=['pdf_file'])

    try:
        from .storage import upload_object
        upload_object(key=rel_pdf_path, body=str(pdf_path), content_type="application/pdf")
    except Exception as exc:
        logger.warning("Failed to upload PDF to S3: %s", exc)

    return {
        "success": True,
        "docx_path": docx_path,
        "pdf_path": pdf_path,
        "docx_filename": os.path.basename(docx_path),
        "pdf_filename": pdf_filename,
        "size_bytes": os.path.getsize(pdf_path),
        "exported_at": report.last_exported_at.isoformat() if report.last_exported_at else None,
        "page_count": actual_pages,
        "page_range_status": page_result.__dict__.get("page_range_status", "within_range")
        if hasattr(page_result, "__dict__")
        else ("within_range" if page_result.within_range else "over_limit" if page_result.over_limit else "under_limit"),
    }


def _save_page_metadata(report: Report, actual_pages: int, status: str, pass_count: int):
    """Save page count and range status to the report model."""
    report.actual_page_count = actual_pages
    report.page_range_status = status
    report.save(update_fields=["actual_page_count", "page_range_status"])


def _condense_report_sections(report: Report, max_pages: int):
    """Condense report sections to reduce page count."""
    from .page_controller import (
        compute_section_budgets,
        condense_section_content,
        rank_facts_by_importance,
        count_section_words,
    )
    from .models import ReportSection, Fact

    budgets = compute_section_budgets()
    facts = list(Fact.objects.filter(project=report.project, status="confirmed"))
    ranked_facts = rank_facts_by_importance(facts)

    sections = report.sections.all()
    for section in sections:
        budget = budgets.get(section.section_key)
        if not budget:
            continue

        current_words = count_section_words(section.content)
        if current_words <= budget.max_words:
            continue

        # Condense this section
        result = condense_section_content(
            section.section_key,
            section.content,
            ranked_facts,
            budget,
        )

        if result.condensed_word_count < current_words:
            # Rebuild condensed HTML
            section.content = _build_condensed_html(section, result)
            section.save(update_fields=["content"])


def _build_condensed_html(section, result: "CondenseResult") -> str:
    """Build condensed HTML from a CondenseResult."""
    from django.utils.html import strip_tags
    clean = strip_tags(section.content or "")
    words = clean.split()
    target_words = result.condensed_word_count
    if len(words) > target_words:
        clean = " ".join(words[:target_words])
        if not clean.endswith((".", "!", "?")):
            clean = clean.rsplit(".", 1)[0] + "."
    return f"<p>{clean}</p>"
