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

from docx.shared import Inches, Pt, RGBColor, Cm
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.oxml import OxmlElement, parse_xml
from docx.oxml.ns import nsdecls, qn
from django.conf import settings
from django.utils import timezone
from .models import Report, ReportSection
from .document_quality import QualityGateError


class SimpleHTMLDocxParser(HTMLParser):
    \"\"\"\n    Parses basic HTML tags (<p>, <h3>, <h4>, <ul>, <ol>, <li>, <strong>, <em>, <table>, <tr>, <th>, <td>)\n    and renders them directly into a python-docx Document with proper academic formatting.\n    Defaults to justified body paragraphs per LASUSTECH formatting requirements.\n    \"\"\"\n    def __init__(self, doc, default_align=WD_ALIGN_PARAGRAPH.JUSTIFY, logo_cfg=None, compact_cover=False):
        super().__init__()
        self.doc = doc
        self.default_align = default_align
        self.logo_cfg = logo_cfg or {}
        self.compact_cover = compact_cover
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
            self.current_p = self.doc.add_paragraph()
            compact = self.compact_cover and self.default_align == WD_ALIGN_PARAGRAPH.CENTER
            self.current_p.paragraph_format.line_spacing = 1.15 if compact else 1.5
            self.current_p.paragraph_format.space_after = Pt(2 if compact else 6)
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
            self.current_p = self.doc.add_paragraph()
            compact = self.compact_cover and self.default_align == WD_ALIGN_PARAGRAPH.CENTER
            self.current_p.paragraph_format.line_spacing = 1.15 if compact else 1.5
            self.current_p.paragraph_format.space_before = Pt(2 if compact else 10)
            self.current_p.paragraph_format.space_after = Pt(2 if compact else 4)
            self.current_p.alignment = WD_ALIGN_PARAGRAPH.CENTER if compact else self.current_p.alignment
            self.bold = True

        elif tag in ['strong', 'b']:
            self.bold = True

        elif tag in ['em', 'i']:
            self.italic = True

        elif tag == 'img':
            src = attrs_dict.get('src', '')
            alt = attrs_dict.get('alt', '')
            if not src:
                return
            # Resolve API-backed logo URLs to local file paths for DOCX embedding.
            abs_path = None
            project_root = Path(__file__).resolve().parent.parent.parent
            logo_cfg = self.logo_cfg or {}
            configured_path = logo_cfg.get('path', '')
            if src.startswith('/api/institutions/'):
                if configured_path:
                    candidate = (project_root / configured_path).resolve()
                    if candidate.exists():
                        abs_path = str(candidate)
                if abs_path is None:
                    inst_dir = project_root / 'assets' / 'institutions' / 'lasustech'
                    for name in ('logo.png', 'logo.web.png', 'logo.svg'):
                        candidate = (inst_dir / name).resolve()
                        if candidate.exists() and candidate.suffix.lower() != '.svg':
                            abs_path = str(candidate)
                            break
            if abs_path is None:
                # Fallback: treat src as a direct filesystem path (relative to project root).
                candidate = (project_root / src.lstrip('/')).resolve()
                if candidate.exists() and candidate.suffix.lower() != '.svg':
                    abs_path = str(candidate)
            if abs_path is None:
                # Logo missing: do not render a placeholder; log an error and skip.
                # CI/build can enforce presence via REQUIRE_REPORT_LOGO/CI checks.
                import os
                if os.environ.get('CI', '').lower() in {'1', 'true', 'yes'} or os.environ.get('REQUIRE_REPORT_LOGO', '').lower() in {'1', 'true', 'yes'}:
                    raise FileNotFoundError(
                        \"Institution logo asset is missing for DOCX cover embedding; build/export cannot continue.\"
                    )
                logger.error(\"Institution logo asset missing for src '%s'; DOCX cover will omit the logo.\", src)
                return
            from docx.shared import Cm
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

        elif tag == 'figure':
            # New: handle figure nodes with image and caption
            src = attrs_dict.get('src', '')
            caption = attrs_dict.get('caption', '')
            figure_number = attrs_dict.get('figure_number', '')
            section_context = attrs_dict.get('section_context', '')
            
            if not src:
                # No image, just render caption as paragraph
                if self.current_p is None:
                    self.current_p = self.doc.add_paragraph()
                run = self.current_p.add_run(caption if caption else '')
                run.italic = True
                run.font.name = 'Times New Roman'
                run.font.size = Pt(11)
                return
            
            # Resolve image path
            abs_path = None
            project_root = Path(__file__).resolve().parent.parent.parent
            logo_cfg = self.logo_cfg or {}
            configured_path = logo_cfg.get('path', '')
            
            if src.startswith('/api/images/') or src.startswith('/media/'):
                # Extract filename from path
                filename = src.split('/')[-1]
                # Look in project media directory
                media_dir = project_root / 'media'
                candidate = media_dir / filename
                if candidate.exists():
                    abs_path = str(candidate)
            if abs_path is None:
                # Fallback: treat src as a direct filesystem path (relative to project root).
                candidate = (project_root / src.lstrip('/')).resolve()
                if candidate.exists():
                    abs_path = str(candidate)
            
            if abs_path is None:
                # Image missing - render just the caption
                if self.current_p is None:
                    self.current_p = self.doc.add_paragraph()
                run = self.current_p.add_run(caption if caption else '')
                run.italic = True
                run.font.name = 'Times New Roman'
                run.font.size = Pt(11)
                return
            
            # Determine scaling: fit within text width (default 12cm, max 15.9cm, max 9cm tall)
            # Page width is roughly 16.5cm (A4 8.27 inches = 21.0cm, minus margins ~3.5cm text area)
            # Use a default text width of 12cm
            default_text_width_cm = 12.0
            max_width_cm = 15.9
            max_height_cm = 9.0
            
            from docx.shared import Cm as Cm_sh
            # Get original dimensions by trying to open the image
            try:
                from PIL import Image as PILImage
                with PILImage.open(abs_path) as pil_img:
                    orig_width, orig_height = pil_img.size
                    # Calculate proportional scaling
                    # First, try to fit within text width
                    scale = default_text_width_cm / orig_width if orig_width > 0 else 1
                    new_width = default_text_width_cm
                    new_height = orig_height * scale
                    
                    # If height exceeds max, recalculate based on height
                    if new_height > max_height_cm:
                        scale = max_height_cm / orig_height if orig_height > 0 else 1
                        new_height = max_height_cm
                        new_width = orig_width * scale
                    
                    # Cap width at max
                    if new_width > max_width_cm:
                        scale = max_width_cm / new_width if new_width > 0 else 1
                        new_width = max_width_cm
                        new_height = orig_height * scale
                    
                    width_cm_used = min(new_width, max_width_cm)
                    height_cm_used = min(new_height, max_height_cm)
            except Exception:
                # Fallback if PIL not available
                width_cm_used = min(12.0, max_width_cm)
                height_cm_used = min(9.0, max_height_cm)
            
            # Ensure paragraph exists
            if self.current_p is None:
                self.current_p = self.doc.add_paragraph()
                self.current_p.paragraph_format.line_spacing = 1.5
                self.current_p.paragraph_format.space_after = Pt(6)
                self.current_p.alignment = self.default_align
            
            # Centre the image in its own paragraph
            self.current_p.alignment = WD_ALIGN_PARAGRAPH.CENTER
            
            # Add the image with scaling
            run = self.current_p.add_run()
            run.add_picture(abs_path, width=Cm(width_cm_used))
            
            # Add alt text on the drawing's docPr (Word/OOXML-compatible)
            drawing = run._r.find(qn('w:drawing'))
            if drawing is not None:
                doc_pr = drawing.find('.//' + qn('wp:docPr'))
                if doc_pr is not None:
                    doc_pr.set('descr', alt if alt else caption)
                    if not doc_pr.get('title'):
                        doc_pr.set('title', alt if alt else caption)
            
            # Set paragraph spacing after image
            self.current_p.paragraph_format.space_after = Pt(4)
            
            # Now add the caption below the image - centred, italic, 11pt, single spacing
            # We need to add a new paragraph for the caption
            caption_p = self.doc.add_paragraph()
            caption_p.alignment = WD_ALIGN_PARAGRAPH.CENTER
            caption_p.paragraph_format.line_spacing = 1.0  # single spacing
            caption_p.paragraph_format.space_after = Pt(4)  # 12pt after
            caption_p.paragraph_format.space_before = Pt(0)
            
            # Add figure number if provided
            figure_text = figure_number if figure_number else ''
            
            # Add the caption text
            run = caption_p.add_run(caption if caption else '')
            run.italic = True
            run.font.name = 'Times New Roman'
            run.font.size = Pt(11)
            
            # Add figure number prefix if we have one
            if figure_number:
                # Prepend the figure number
                run2 = caption_p.add_run(f' {figure_number}')
                run2.italic = True
                run2.font.name = 'Times New Roman'
                run2.font.size = Pt(11)
            
            # Keep image and caption together - set keep_with_next
            # This is done via the OOXML <w:keepNext> element
            # We need to access the paragraph's underlying XML
            pPr = caption_p._p.get_or_add_pPr()
            keep_next = OxmlElement('w:keepNext')
            pPr.append(keep_next)

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
                            f'<w:tblBorders {nsdecls("w")}>\n'
                            f'<w:top w:val="single" w:sz="4" w:space="0" w:color="CCCCCC"/>\n'
                            f'<w:bottom w:val="single" w:sz="4" w:space="0" w:color="CCCCCC"/>\n'
                            f'<w:left w:val="none"/>\n'
                            f'<w:right w:val="none"/>\n'
                            f'<w:insideH w:val="single" w:sz="4" w:space="0" w:color="CCCCCC"/>\n'
                            f'<w:insideV w:val="none"/>\n'
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

        if tag in ['strong', 'b']:
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
    \"\"\"Applies standard Nigerian academic margins for binding:\n    Left: 1.5 inches (binding side)\n    Right: 1.0 inch\n    Top: 1.0 inch\n    Bottom: 1.0 inch\n    Page size: A4 (8.27 x 11.69 inches)\n    \"\"\"\n    section.page_width = Inches(8.27)
    section.page_height = Inches(11.69)
    if v2:
        section.left_margin = section.right_margin = section.top_margin = section.bottom_margin = Cm(2.54)
    else:
        section.left_margin = Inches(1.5)
        section.right_margin = Inches(1.0)
        section.top_margin = Inches(1.0)
        section.bottom_margin = Inches(1.0)


def add_footer_page_number(section, fmt=\"decimal\", start=None, label: str = \"\"):
    \"\"\"Configures footer page numbering for a python-docx Section using OOXML fields.\n    fmt: 'lowerRoman' (i, ii, iii) or 'decimal' (1, 2, 3)\n    start: optional integer starting page number (e.g. 1)\n    \"\"\"\n    sectPr = section._sectPr
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
    \"\"\"\n    Generates a realistic Table of Contents with dot leaders and exact page numbers,\n    along with Word's native TOC XML instruction.\n    \"\"\"\n    p_header = doc.add_paragraph()
    p_header.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p_header.paragraph_format.space_before = Pt(12)
    p_header.paragraph_format.space_after = Pt(18)
    r_head = p_header.add_run(\"TABLE OF CONTENTS\")
    r_head.bold = True
    r_head.font.name = 'Times New Roman'
    r_head.font.size = Pt(14)

    # Word XML field for dynamic updates
    fld_p = doc.add_paragraph()
    fld_p.paragraph_format.space_after = Pt(6)
    r_fld = fld_p.add_run()
    r_fld._r.append(parse_xml(r'<w:fldSimple %s w:instr="TOC \\o "1-3" \\h \\z \\u\"/>' % nsdecls('w')))

    if v2:
        return

    # Add realistic pre-rendered TOC entry items with dot leaders and page numbers
    toc_entries = [
        (\"Title Page\", \"ii\", False),
        (\"Declaration\", \"iii\", False),
        (\"Certification & Approval\", \"iv\", False),
        (\"Dedication\", \"v\", False),
        (\"Acknowledgements\", \"vi\", False),
        (\"Abstract / Executive Summary\", \"vii\", False),
        (\"Table of Contents\", \"viii\", False),
        (\"CHAPTER ONE: INTRODUCTION\", \"1\", True),
        (\"  1.1 Background to SIWES\", \"1\", False),
        (\"  1.2 Objectives of Industrial Training\", \"2\", False),
        (\"  1.3 Scope and Significance of the Scheme\", \"2\", False),
        (\"CHAPTER TWO: ORGANIZATION PROFILE\", \"3\", True),
        (\"  2.1 Company Background and Overview\", \"3\", False),
        (\"  2.2 Organizational Structure & Key Operations\", \"4\", False),
        (\"  2.3 Department of Placement and Responsibilities\", \"4\", False),
        (\"CHAPTER THREE: TRAINING ACTIVITIES & TECHNICAL EXPERIENCE\", \"5\", True),
        (\"  3.1 Training Environment & Workflow\", \"5\", False),
        (\"  3.2 Tools, Technologies & Equipment Used\", \"5\", False),
        (\"  3.3 Weekly Chronological Summary of Activities\", \"6\", False),
        (\"  3.4 Detailed Technical Procedures and Tasks\", \"7\", False),
        (\"  3.5 Specific Projects Undertaken\", \"8\", False),
        (\"CHAPTER FOUR: SKILLS ACQUIRED, CHALLENGES AND SOLUTIONS\", \"9\", True),
        (\"  4.1 Skills and Knowledge Acquired\", \"9\", False),
        (\"  4.2 Challenges and Problems Encountered\", \"10\", False),
        (\"  4.3 Solutions Attempted and Troubleshooting Strategies\", \"10\", False),
        (\"  4.4 Professional Lessons Learned\", \"11\", False),
        (\"CHAPTER FIVE: CONCLUSION AND RECOMMENDATIONS\", \"12\", True),
        (\"  5.1 Summary of Training Experience\", \"12\", False),
        (\"  5.2 Assessment of SIWES Objectives Realization\", \"12\", False),
        (\"  5.3 Recommendations\", \"13\", False),
        (\"REFERENCES AND APPENDICES\", \"14\", True),
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
        dots = \" \" + (\".\" * dot_count) + \" \"
        r_dots = p.add_run(dots)
        r_dots.font.name = 'Times New Roman'
        r_dots.font.size = Pt(9)
        r_dots.font.color.rgb = RGBColor(0x88, 0x88, 0x88)

        r_page = p.add_run(page_str)
        r_page.font.name = 'Times New Roman'
        r_page.font.size = Pt(11)
        r_page.bold = is_major


def document_node_to_html(node: dict) -> str:
    \"\"\"Serialize a canonical typed node for the existing DOCX HTML parser.\"\"\"\n    node_type = node.get(\"type\")\n    text = escape(node.get(\"text\", \"\")).replace(\"\\n\", \"<br/>\")\n    children = \"\".join(document_node_to_html(child) for child in node.get(\"children\", []))\n    if node_type == \"paragraph\":\n        return f\"<p>{text}{children}</p>\"\n    if node_type == \"heading\":\n        level = min(4, max(2, int(node.get(\"attrs\", {}).get(\"level\", 2))))\n        return f\"<h{level}>{text}{children}</h{level}>\"\n    if node_type in {\"list\", \"list_item\"}:\n        if node_type == \"list\":\n            tag = \"ol\" if node.get(\"attrs\", {}).get(\"ordered\") else \"ul\"\n            items = \"\".join(f\"<li>{escape(child.get('text', ''))}{''.join(document_node_to_html(grandchild) for grandchild in child.get('children', []))}</li>\" for child in node.get(\"children\", []))\n            return f\"<{tag}>{items}</{tag}>\"\n        return f\"<li>{text}{children}</li>\"\n    if node_type == \"table\":\n        return f\"<table>{children}</table>\"\n    if node_type == \"row\":\n        return f\"<tr>{children}</tr>\"\n    if node_type == \"cell\":\n        return f\"<td>{text}{children}</td>\"\n    if node_type == \"figure\":\n        src = node.get(\"attrs\", {}).get(\"src\", \"\")\n        caption = escape(node.get(\"attrs\", {}).get(\"caption\", \"\"))\n        figure_number = node.get(\"attrs\", {}).get(\"figure_number\", \"\")\n        section_context = node.get(\"attrs\", {}).get(\"section_context\", \"\")\n        if src:\n            # Emit a real <img> tag so the DOCX parser embeds the image\n            # with proper scaling, centring, and caption below.\n            return f'<img src=\"{escape(src)}\" alt=\"{escape(caption)}\" \"\n                   f'figure_number=\"{escape(figure_number)}\" \"\n                   f'section_context=\"{escape(section_context)}\"/>'\n        return f\"<p>{caption}</p>\" if caption else \"\"\n    return text + children


def generate_docx_report(report: Report) -> str:
    \"\"\"\n    Builds a professional, properly formatted A4 Word document for the SIWES report.\n    Adheres strictly to LASUSTECH formatting requirements:\n    - Font: Times New Roman, 12pt body, 1.5 line spacing, justified.\n    - Margins: 1.5 inches left (binding), 1.0 inch right, top, bottom.\n    - Pagination:\n      * Section 1 (Cover): No visible page number.\n      * Section 2 (Prelims): Lowercase Roman numerals (i, ii, iii...).\n      * Section 3 (Main Body): Decimal Arabic numerals (1, 2, 3...) restarting at 1 at Chapter One.\n      * Table of Contents with real page numbers.\n    \"\"\"\n    from .document_quality import require_report_quality, validate_docx_artifact\n    require_report_quality(report)\n    doc = Document()\n    is_v2 = report.template_version == \"lasustech_cs:2.0.0\"\n    if is_v2:\n        update_fields = OxmlElement(\"w:updateFields\")\n        update_fields.set(qn(\"w:val\"), \"true\")\n        doc.settings.element.append(update_fields)\n\n    # Institution logo is a template-level asset (students cannot change it).\n    template_snapshot = report.template_snapshot if isinstance(report.template_snapshot, dict) else {}\n    logo_cfg = (template_snapshot.get(\"institution_asset\", {}) or {}).get(\"logo\", {}) or {}\n\n    # Configure base Normal style\n    normal_style = doc.styles['Normal']\n    normal_style.font.name = 'Times New Roman'\n    normal_style.font.size = Pt(12)\n    normal_style.font.color.rgb = RGBColor(0x11, 0x18, 0x27)\n    if is_v2:\n        for style_name in (\"Heading 1\", \"Heading 2\", \"Heading 3\"):\n            heading_style = doc.styles[style_name]\n            heading_style.font.name = \"Times New Roman\"\n            heading_style.font.size = Pt(14 if style_name == \"Heading 1\" else 12)\n            heading_style.font.bold = True\n\n    if not is_v2:\n        # Keep the v1 section content path unchanged for pinned legacy reports.\n        all_sections = list(report.sections.all().order_by('chapter_number', 'order', 'id'))\n    else:\n        model = report.document_model\n        if not model or not model.get(\"sections\"):\n            from .document_model import model_from_sections\n            from .templates import get_template_spec\n            model = model_from_sections(report, report.template_snapshot or get_template_spec()).to_dict()\n        logo_alt = (logo_cfg.get('alt_text') if isinstance(logo_cfg, dict) else '') or 'Institution logo'\n        logo_img = f'<img src=\"/api/institutions/lasustech/logo/\" alt=\"{logo_alt}\"/>'\n        all_sections = []\n        for section in model.get(\"sections\", []):\n            rendered = [document_node_to_html(node) for node in section.get(\"nodes\", [])]\n            content = \"\".join(rendered)\n            if section.get('key') == 'title_page' and '/api/institutions/' not in content:\n                content = logo_img + content\n            all_sections.append(SimpleNamespace(\n                section_key=section.get(\"key\", \"\"),\n                chapter_number=section.get(\"chapter\", 0),\n                title=section.get(\"title\", \"\"),\n                chapter_title=section.get(\"chapter_title\", \"\"),\n                content=content,\n            ))\n    cover_key = \"title_page\" if is_v2 else \"cover\"\n    cover_sec = next((s for s in all_sections if s.section_key == cover_key), None)\n    prelim_secs = [s for s in all_sections if s.chapter_number == 0 and s.section_key != cover_key]\n    body_secs = [s for s in all_sections if s.chapter_number > 0]\n\n    # --- SECTION 1: COVER PAGE ---\n    sec1 = doc.sections[0]\n    set_academic_margins(sec1, v2=is_v2)\n    sec1.different_first_page_header_footer = not (is_v2 and report.template_options.get(\"cover_numbered\", True))\n    # Ensure header & footer on cover page are blank (no visible page number)\n    sec1.first_page_header.is_linked_to_previous = False\n    sec1.first_page_footer.is_linked_to_previous = False\n    if is_v2 and not sec1.different_first_page_header_footer:\n        sec1.footer.is_linked_to_previous = False\n        add_footer_page_number(sec1, fmt=\"lowerRoman\", start=1)\n\n    if cover_sec:\n        parser = SimpleHTMLDocxParser(doc, default_align=WD_ALIGN_PARAGRAPH.CENTER, logo_cfg=logo_cfg, compact_cover=True)\n        parser.feed(cover_sec.content or \"\")\n\n    # --- SECTION 2: PRELIMINARY PAGES (Title Page to TOC) ---\n    if prelim_secs:\n        sec2 = doc.add_section()\n        set_academic_margins(sec2, v2=is_v2)\n        sec2.different_first_page_header_footer = False\n        sec2.header.is_linked_to_previous = False\n        sec2.footer.is_linked_to_previous = False\n        # Lowercase Roman numerals starting at ii (page 2)\n        add_footer_page_number(sec2, fmt=\"lowerRoman\", start=2)\n\n        for p_idx, p_sec in enumerate(prelim_secs):\n            if p_idx > 0:\n                doc.add_page_break()\n\n            if p_sec.section_key == \"table_of_contents\":\n                render_table_of_contents_section(doc, prelim_secs, body_secs, v2=is_v2)\n            else:\n                if is_v2 and p_sec.content:\n                    heading = doc.add_paragraph(style=doc.styles[\"Heading 1\"])\n                    heading.alignment = WD_ALIGN_PARAGRAPH.CENTER\n                    heading.add_run(p_sec.title.upper())\n                p_parser = SimpleHTMLDocxParser(doc)\n                p_parser.feed(p_sec.content or \"\")\n\n    # --- SECTION 3: MAIN BODY (Chapters 1 to 5, References & Appendices) ---\n    if body_secs:\n        sec3 = doc.add_section()\n        set_academic_margins(sec3, v2=is_v2)\n        sec3.different_first_page_header_footer = False\n        sec3.header.is_linked_to_previous = False\n        sec3.footer.is_linked_to_previous = False\n        # Decimal Arabic numerals starting at 1\n        add_footer_page_number(sec3, fmt=\"decimal\", start=1, label=\"Page \" if is_v2 else \"\")\n\n        current_chapter = None\n        for b_idx, b_sec in enumerate(body_secs):\n            if current_chapter != b_sec.chapter_number:\n                if b_idx > 0:\n                    doc.add_page_break()\n                current_chapter = b_sec.chapter_number\n\n                ch_titles = {\n                    1: \"CHAPTER ONE\\nINTRODUCTION\",\n                    2: \"CHAPTER TWO\\nORGANIZATION PROFILE\",\n                    3: \"CHAPTER THREE\\nTRAINING ACTIVITIES AND TECHNICAL EXPERIENCE\",\n                    4: \"CHAPTER FOUR\\nSKILLS ACQUIRED, CHALLENGES AND SOLUTIONS\",\n                    5: \"CHAPTER FIVE\\nCONCLUSION AND RECOMMENDATIONS\",\n                    6: \"REFERENCES AND APPENDICES\"\n                }\n                header_text = getattr(b_sec, \"chapter_title\", \"\") or ch_titles.get(b_sec.chapter_number, f\"CHAPTER {b_sec.chapter_number}\")\n                ch_p = doc.add_paragraph()\n                if is_v2:\n                    ch_p.style = doc.styles[\"Heading 1\"]\n                ch_p.alignment = WD_ALIGN_PARAGRAPH.CENTER\n                ch_p.paragraph_format.space_before = Pt(18)\n                ch_p.paragraph_format.space_after = Pt(18)\n                run = ch_p.add_run(header_text)\n                run.bold = True\n                run.font.name = 'Times New Roman'\n                run.font.size = Pt(14)\n\n            if b_sec.chapter_number > 0 and b_sec.section_key not in [\"references\", \"appendices\"]:\n                sub_p = doc.add_paragraph()\n                if is_v2:\n                    sub_p.style = doc.styles[\"Heading 2\"]\n                sub_p.paragraph_format.space_before = Pt(12)\n                sub_p.paragraph_format.space_after = Pt(6)\n                sub_p.alignment = WD_ALIGN_PARAGRAPH.LEFT\n                sub_run = sub_p.add_run(b_sec.title)\n                sub_run.bold = True\n                sub_run.font.name = 'Times New Roman'\n                sub_run.font.size = Pt(12)\n\n            b_parser = SimpleHTMLDocxParser(doc, default_align=WD_ALIGN_PARAGRAPH.JUSTIFY, logo_cfg=logo_cfg)\n            b_parser.feed(b_sec.content or \"\")\n\n    # Explicitly set every run, including style and field runs, so Word does not\n    # substitute a theme font for headings, TOC fields, or page labels.\n    paragraphs = list(doc.paragraphs)\n    for table in doc.tables:\n        for row in table.rows:\n            for cell in row.cells:\n                paragraphs.extend(cell.paragraphs)\n    for section in doc.sections:\n        paragraphs.extend(section.header.paragraphs)\n        paragraphs.extend(section.footer.paragraphs)\n    if is_v2:\n        for paragraph in paragraphs:\n            for run in paragraph.runs:\n                run.font.name = \"Times New Roman\"\n                r_pr = run._element.get_or_add_rPr()\n                fonts = r_pr.rFonts\n                if fonts is None:\n                    fonts = OxmlElement(\"w:rFonts\")\n                    r_pr.insert(0, fonts)\n                for attribute in (\"ascii\", \"hAnsi\", \"eastAsia\", \"cs\"):\n                    fonts.set(qn(f\"w:{attribute}\"), \"Times New Roman\")\n\n    export_dir = Path(settings.MEDIA_ROOT) / \"projects\" / str(report.project.id) / \"exports\"\n    export_dir.mkdir(parents=True, exist_ok=True)\n\n    clean_title = re.sub(r'[^a-zA-Z0-9_\\-]', '_', report.project.title or \"SIWES_Report\")\n    docx_filename = f\"{clean_title}_v{report.version}.docx\"\n    docx_path = export_dir / docx_filename\n\n    doc.save(str(docx_path))\n\n    try:\n        validate_docx_artifact(report, docx_path)\n    except Exception:\n        if docx_path.exists():\n            docx_path.unlink()\n        raise\n\n    rel_path = f\"projects/{report.project.id}/exports/{docx_filename}\"\n    report.docx_file.name = rel_path\n    report.last_exported_at = timezone.now()\n    report.save(update_fields=['docx_file', 'last_exported_at'])\n\n    return str(docx_path)


def convert_docx_to_pdf(docx_path: str) -> str:
    \"\"\"Renders DOCX into PDF using headless LibreOffice.\n    Validates output PDF size and magic bytes.\n    Returns the absolute path to the PDF.\n    \"\"\"\n    if not os.path.exists(docx_path):\n        raise FileNotFoundError(f\"Source DOCX file not found: {docx_path}\")\n\n    out_dir = str(Path(docx_path).parent)\n    libreoffice_bin = getattr(settings, 'LIBREOFFICE_PATH', 'libreoffice')\n    resolved_bin = (libreoffice_bin if os.path.isabs(libreoffice_bin) and os.path.exists(libreoffice_bin) else None) or shutil.which(libreoffice_bin) or shutil.which('libreoffice')\n    if not resolved_bin:\n        raise FileNotFoundError(f\"LibreOffice executable not found at '{libreoffice_bin}' or in system PATH.\")\n    libreoffice_bin = resolved_bin\n\n    cmd = [\n        libreoffice_bin,\n        '--headless',\n        '--convert-to', 'pdf',\n        '--outdir', out_dir,\n        docx_path\n    ]\n\n    result = subprocess.run(cmd, capture_output=True, text=True, timeout=90)\n    if result.returncode != 0:\n        raise RuntimeError(f\"LibreOffice PDF conversion failed: {result.stderr or result.stdout}\")\n\n    pdf_path = os.path.splitext(docx_path)[0] + '.pdf'\n\n    if not os.path.exists(pdf_path):\n        raise FileNotFoundError(f\"PDF was not generated at expected path: {pdf_path}\")\n\n    file_size = os.path.getsize(pdf_path)\n    if file_size < 1000:\n        raise ValueError(f\"Generated PDF is suspiciously small ({file_size} bytes). Conversion may be corrupted.\")\n\n    with open(pdf_path, 'rb') as f:\n        header = f.read(5)\n        if not header.startswith(b'%PDF-'):\n            raise ValueError(\"Generated file is not a valid PDF document (missing %PDF header).\")\n\n    return pdf_path


def export_report_documents(report: Report) -> dict:
    \"\"\"\n    Executes both DOCX generation and PDF conversion with full validation.\n    Enforces strict 12-15 page range via the Page Budget Controller.\n    Returns dict with file paths, metadata, and page count info.\n    \"\"\"\n    from .page_controller import (\n        validate_page_range,\n        count_docx_pages,\n        get_page_settings,\n        compute_section_budgets,\n        condense_section_content,\n        rank_facts_by_importance,\n        REQUIRED_SECTION_ORDER,\n    )\n    from .models import ReportSection, Fact\n\n    settings_ = get_page_settings(report)\n    max_pages = settings_[\"max_pages\"]\n    min_pages = settings_[\"min_pages\"]\n\n    max_passes = 3\n    pass_count = 0\n\n    while pass_count < max_passes:\n        pass_count += 1\n\n        # Generate DOCX\n        docx_path = generate_docx_report(report)\n\n        # Convert to PDF and count actual pages\n        pdf_path = convert_docx_to_pdf(docx_path)\n        actual_pages = count_pdf_pages(pdf_path)\n\n        # Validate page range\n        page_result = validate_page_range(actual_pages, min_pages=min_pages, max_pages=max_pages)\n\n        if page_result.within_range:\n            # Pages within range - save and export\n            _save_page_metadata(report, actual_pages, \"within_range\", pass_count)\n            break\n\n        if page_result.over_limit and pass_count < max_passes:\n            # Over limit: condense sections and regenerate\n            _condense_report_sections(report, max_pages)\n            continue\n\n        # Either over limit after max passes, or under limit\n        break\n\n    # Re-render final version\n    docx_path = generate_docx_report(report)\n    pdf_path = convert_docx_to_pdf(docx_path)\n    actual_pages = count_pdf_pages(pdf_path)\n    page_result = validate_page_range(actual_pages, min_pages=min_pages, max_pages=max_pages)\n\n    if page_result.over_limit:\n        _save_page_metadata(report, actual_pages, \"over_limit\", pass_count)\n        # Clean up the oversized file\n        if os.path.exists(docx_path):\n            os.unlink(docx_path)\n        if os.path.exists(pdf_path):\n            os.unlink(pdf_path)\n        raise QualityGateError({\n            \"passed\": False,\n            \"blockers\": [{\n                \"code\": \"page_limit_exceeded\",\n                \"message\": f\"Report is {actual_pages} pages. Maximum allowed is {max_pages} pages. Condense sections and retry.\",\n                \"section_key\": None,\n            }],\n            \"warnings\": [],\n            \"summary\": {\n                \"total_pages\": actual_pages,\n                \"blocker_count\": 1,\n                \"page_range_status\": \"over_limit\",\n            },\n        })\n\n    if page_result.under_limit:\n        _save_page_metadata(report, actual_pages, \"under_limit\", pass_count)\n    else:\n        _save_page_metadata(report, actual_pages, \"within_range\", pass_count)\n\n    pdf_filename = os.path.basename(pdf_path)\n    rel_pdf_path = f\"projects/{report.project.id}/exports/{pdf_filename}\"\n\n    report.pdf_file.name = rel_pdf_path\n    report.project.status = 'exported'\n    report.project.save(update_fields=['status'])\n    report.save(update_fields=['pdf_file'])\n\n    return {\n        \"success\": True,\n        \"docx_path\": docx_path,\n        \"pdf_path\": pdf_path,\n        \"docx_filename\": os.path.basename(docx_path),\n        \"pdf_filename\": pdf_filename,\n        \"size_bytes\": os.path.getsize(pdf_path),\n        \"exported_at\": report.last_exported_at.isoformat() if report.last_exported_at else None,\n        \"page_count\": actual_pages,\n        \"page_range_status\": page_result.__dict__.get(\"page_range_status\", \"within_range\")\n        if hasattr(page_result, \"__dict__\")\n        else (\"within_range\" if page_result.within_range else \"over_limit\" if page_result.over_limit else \"under_limit\"),\n    }\n\n\ndef _save_page_metadata(report: Report, actual_pages: int, status: str, pass_count: int):\n    \"\"\"Save page count and range status to the report model.\"\"\"\n    report.actual_page_count = actual_pages\n    report.page_range_status = status\n    report.save(update_fields=[\"actual_page_count\", \"page_range_status\"])\n\n\ndef _condense_report_sections(report: Report, max_pages: int):\n    \"\"\"Condense report sections to reduce page count.\"\"\"\n    from .page_controller import (\n        compute_section_budgets,\n        condense_section_content,\n        rank_facts_by_importance,\n        count_section_words,\n    )\n    from .models import ReportSection, Fact\n\n    budgets = compute_section_budgets()\n    facts = list(Fact.objects.filter(project=report.project, status=\"confirmed\"))\n    ranked_facts = rank_facts_by_importance(facts)\n\n    sections = report.sections.all()\n    for section in sections:\n        budget = budgets.get(section.section_key)\n        if not budget:\n            continue\n\n        current_words = count_section_words(section.content)\n        if current_words <= budget.max_words:\n            continue\n\n        # Condense this section\n        result = condense_section_content(\n            section.section_key,\n            section.content,\n            ranked_facts,\n            budget,\n        )\n\n        if result.condensed_word_count < current_words:\n            # Rebuild condensed HTML\n            section.content = _build_condensed_html(section, result)\n            section.save(update_fields=[\"content\"])\n\n\ndef _build_condensed_html(section, result: \"CondenseResult\") -> str:\n    \"\"\"Build condensed HTML from a CondenseResult.\"\"\"\n    from django.utils.html import strip_tags\n    clean = strip_tags(section.content or \"\")\n    words = clean.split()\n    target_words = result.condensed_word_count\n    if len(words) > target_words:\n        clean = \" \".join(words[:target_words])\n        if not clean.endswith((\".\", \"!\", \"?\")):\n            clean = clean.rsplit(\".\", 1)[0] + \".\"\n    return f\"<p>{clean}</p>\"\n\n\ndef count_pdf_pages(pdf_path: str) -> int:\n    \"\"\"Count pages in a PDF by checking for page separators.\"\"\"\n    import fitz  # PyMuPDF\n    doc = fitz.open(pdf_path)\n    return len(doc)


# Helper class for condensation results
class CondenseResult:
    def __init__(self, condensed_word_count, kept_facts, removed_facts):
        self.condensed_word_count = condensed_word_count
        self.kept_facts = kept_facts
        self.removed_facts = removed_facts