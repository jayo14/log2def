"""Automated organogram and structure builder from intake questions."""
from __future__ import annotations

import re
from typing import List, Union


def build_organogram_from_structure(
    head_title: str,
    units: Union[List[str], str],
    placement_unit: str = "",
    supervisor_title: str = "",
    student_role: str = "SIWES Trainee"
) -> str:
    """
    Build a 2-space indented organogram tree from head, units, placement, and supervisor.
    Strictly avoids fabricating any boxes not entered by the student.
    """
    if not head_title or not str(head_title).strip():
        return ""

    lines = [str(head_title).strip()]
    if isinstance(units, str):
        raw_units = [u.strip() for u in re.split(r"[\n,;]+", units) if u.strip()]
    elif isinstance(units, (list, tuple)):
        raw_units = [str(u).strip() for u in units if str(u).strip()]
    else:
        raw_units = []

    clean_placement = str(placement_unit).strip()
    if clean_placement and not any(u.lower() == clean_placement.lower() for u in raw_units):
        raw_units.append(clean_placement)

    placed = False
    for u in raw_units:
        lines.append(f"  {u}")
        if clean_placement and u.lower() == clean_placement.lower() and not placed:
            placed = True
            if supervisor_title and str(supervisor_title).strip():
                lines.append(f"    {str(supervisor_title).strip()}")
                if student_role:
                    lines.append(f"      {student_role.strip()}")
            elif student_role:
                lines.append(f"    {student_role.strip()}")

    if not placed and supervisor_title and str(supervisor_title).strip():
        if len(lines) > 1:
            lines.insert(2, f"    {str(supervisor_title).strip()}")
            if student_role:
                lines.insert(3, f"      {student_role.strip()}")
        else:
            lines.append(f"  {str(supervisor_title).strip()}")
            if student_role:
                lines.append(f"    {student_role.strip()}")

    return "\n".join(lines)


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
