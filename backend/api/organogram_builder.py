"""Automated organogram and structure builder from intake questions."""
from __future__ import annotations

import os
import re
import subprocess
import tempfile
from html import escape
from pathlib import Path
from typing import List, Union


def build_organogram_from_structure(
    head_title: str,
    units: Union[List[str], str],
    placement_unit: str = "",
    supervisor_title: str = "",
    student_role: str = "SIWES Intern"
) -> str:
    """
    Build a 2-space indented organogram tree from head, units, placement, and supervisor.
    Fixes the duplicated supervisor node by labeling the student node directly:
    head -> units -> student under their unit with supervisor title as a label.
    """
    if not head_title or not str(head_title).strip():
        return ""

    clean_head = str(head_title).strip()
    lines = [clean_head]
    if isinstance(units, str):
        raw_units = [u.strip() for u in re.split(r"[\n,;]+", units) if u.strip()]
    elif isinstance(units, (list, tuple)):
        raw_units = [str(u).strip() for u in units if str(u).strip()]
    else:
        raw_units = []

    clean_placement = str(placement_unit).strip()
    if clean_placement and not any(u.lower() == clean_placement.lower() for u in raw_units):
        raw_units.append(clean_placement)

    clean_super = str(supervisor_title).strip()
    clean_role = str(student_role).strip() or "SIWES Intern"

    for u in raw_units:
        lines.append(f"  {u}")
        if clean_placement and u.lower() == clean_placement.lower():
            if clean_super and clean_super.lower() != clean_role.lower():
                lines.append(f"    {clean_role} (Supervisor: {clean_super})")
            else:
                lines.append(f"    {clean_role}")

    return "\n".join(lines)


def generate_organogram_svg(
    head_title: str,
    units: List[str],
    placement_unit: str,
    supervisor_title: str,
    student_role: str = "SIWES Intern"
) -> str:
    """Generate SVG chart for the organogram with Times New Roman text and clean connectors."""
    width = 700
    height = 240
    head_w, head_h = 240, 42
    head_x = (width - head_w) // 2
    head_y = 20

    unit_count = max(1, len(units))
    unit_w = min(180, (width - 40 - (unit_count - 1) * 20) // unit_count)
    unit_h = 38
    unit_y = 100
    gap = (width - 40 - (unit_count * unit_w)) // max(1, unit_count - 1) if unit_count > 1 else 0
    start_x = 20 if unit_count > 1 else (width - unit_w) // 2

    elements = [
        f'<rect width="{width}" height="{height}" fill="#ffffff" rx="4"/>',
        f'<rect x="{head_x}" y="{head_y}" width="{head_w}" height="{head_h}" fill="#f8fafc" stroke="#1e293b" stroke-width="1.5" rx="4"/>',
        f'<text x="{head_x + head_w // 2}" y="{head_y + 26}" font-family="Times New Roman, serif" font-size="13" font-weight="bold" text-anchor="middle" fill="#0f172a">{escape(head_title)}</text>',
        f'<line x1="{width // 2}" y1="{head_y + head_h}" x2="{width // 2}" y2="{unit_y - 20}" stroke="#475569" stroke-width="1.5"/>',
    ]

    first_cx = start_x + unit_w // 2
    last_cx = start_x + (unit_count - 1) * (unit_w + gap) + unit_w // 2
    if unit_count > 1:
        elements.append(f'<line x1="{first_cx}" y1="{unit_y - 20}" x2="{last_cx}" y2="{unit_y - 20}" stroke="#475569" stroke-width="1.5"/>')

    for i, u in enumerate(units):
        ux = start_x + i * (unit_w + gap)
        ucx = ux + unit_w // 2
        elements.append(f'<line x1="{ucx}" y1="{unit_y - 20}" x2="{ucx}" y2="{unit_y}" stroke="#475569" stroke-width="1.5"/>')
        is_placement = bool(placement_unit and u.lower() == placement_unit.lower())
        fill = '#f0fdf4' if is_placement else '#ffffff'
        stroke = '#059669' if is_placement else '#64748b'
        elements.append(f'<rect x="{ux}" y="{unit_y}" width="{unit_w}" height="{unit_h}" fill="{fill}" stroke="{stroke}" stroke-width="1.2" rx="4"/>')
        elements.append(f'<text x="{ucx}" y="{unit_y + 24}" font-family="Times New Roman, serif" font-size="11.5" font-weight="bold" text-anchor="middle" fill="#0f172a">{escape(u)}</text>')

        if is_placement:
            st_w, st_h = min(unit_w + 24, 210), 48
            st_x = ucx - st_w // 2
            st_y = unit_y + unit_h + 26
            elements.append(f'<line x1="{ucx}" y1="{unit_y + unit_h}" x2="{ucx}" y2="{st_y}" stroke="#059669" stroke-width="1.5" stroke-dasharray="3,3"/>')
            elements.append(f'<rect x="{st_x}" y="{st_y}" width="{st_w}" height="{st_h}" fill="#ecfdf5" stroke="#059669" stroke-width="1.5" rx="4"/>')
            elements.append(f'<text x="{ucx}" y="{st_y + 20}" font-family="Times New Roman, serif" font-size="11" font-weight="bold" text-anchor="middle" fill="#065f46">{escape(student_role)}</text>')
            super_label = f'Supervisor: {supervisor_title}' if supervisor_title else 'Assigned Intern'
            elements.append(f'<text x="{ucx}" y="{st_y + 36}" font-family="Times New Roman, serif" font-size="9" font-style="italic" text-anchor="middle" fill="#047857">({escape(super_label)})</text>')

    return f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}">{" ".join(elements)}</svg>'


def render_organogram_chart_png(
    project_id: int,
    head_title: str,
    units: List[str],
    placement_unit: str,
    supervisor_title: str,
    student_role: str = "SIWES Intern"
) -> str:
    """Render organogram SVG to PNG file in media/organograms and return relative media path."""
    import pymupdf
    svg = generate_organogram_svg(head_title, units, placement_unit, supervisor_title, student_role)
    media_dir = Path(__file__).resolve().parent.parent / "media" / "organograms"
    media_dir.mkdir(parents=True, exist_ok=True)
    out_png = media_dir / f"organogram_proj_{project_id}.png"

    doc = pymupdf.open(stream=svg.encode("utf-8"), filetype="svg")
    pix = doc[0].get_pixmap(dpi=150)
    pix.save(str(out_png))

    # Return relative path for web and docx embedding
    return f"/media/organograms/organogram_proj_{project_id}.png"


def build_structure_narrative(
    head_title: str,
    units: Union[List[str], str],
    placement_unit: str = "",
    supervisor_title: str = ""
) -> str:
    """Generate section 2.3 narrative text grounded solely in student-provided structure inputs."""
    if not head_title:
        return ""
    if isinstance(units, str):
        unit_list = [u.strip() for u in re.split(r"[\n,;]+", units) if u.strip()]
    elif isinstance(units, (list, tuple)):
        unit_list = [str(u).strip() for u in units if str(u).strip()]
    else:
        unit_list = []

    narrative = [f"The organisation is headed by the {head_title.strip()}."]
    if unit_list:
        if len(unit_list) == 1:
            narrative.append(f"The primary operating unit is the {unit_list[0]}.")
        else:
            units_str = ", ".join(unit_list[:-1]) + f" and {unit_list[-1]}"
            narrative.append(f"The operational divisions comprise the {units_str}.")

    if placement_unit:
        super_str = f" under the supervision of the {supervisor_title.strip()}" if supervisor_title else ""
        narrative.append(f"During the training period, the student was assigned to the {placement_unit.strip()}{super_str}.")

    return " ".join(narrative)
