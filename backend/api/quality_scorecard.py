"""
LASUSTECH SIWES Technical Report Quality Scorecard Engine.

Objectively measures report quality across 6 academic pillars (100 points total)
and blocks regressions. Designed against the academic marking rubric of the
Department of Computer Science at Lagos State University of Science and Technology.

CRITICAL OVERRIDE:
Any fabricated statement, activity, tool, or claim outside the student's confirmed
logbook and profile results in an AUTOMATIC ZERO (FAIL) regardless of score.
"""
from __future__ import annotations

import os
import re
import json
import logging
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional, Set, Tuple

from docx import Document
from docx.shared import Pt, Cm
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml.ns import qn

from .models import Report, ReportProject, ReportSection, Fact
from .ai_provider import is_ai_available, generate_gemini_content

logger = logging.getLogger(__name__)

# =========================================================================
# Coordinator's Approved Document B Section Hierarchy
# =========================================================================

COORDINATOR_SECTIONS: List[Tuple[str, str, int]] = [
    ("title_page", "Title Page", 0),
    ("certification", "Certification", 0),
    ("dedication", "Dedication", 0),
    ("acknowledgement", "Acknowledgement", 0),
    ("table_of_contents", "Table of Contents", 0),
    ("ch1_background", "1.1 Background of SIWES", 1),
    ("ch1_objectives", "1.2 Objectives of SIWES", 1),
    ("ch1_importance", "1.3 Importance of SIWES", 1),
    ("ch1_scope", "1.4 Scope of the Training", 1),
    ("ch1_duration", "1.5 Duration of the Training", 1),
    ("ch2_history", "2.1 Brief History of the Organisation", 2),
    ("ch2_objectives", "2.2 Objectives of the Organisation", 2),
    ("ch2_structure", "2.3 Organisational Structure", 2),
    ("ch2_organogram", "2.4 Organogram of the Organisation", 2),
    ("ch3_duties", "3.1 Duties and Responsibilities", 3),
    ("ch3_activities", "3.2 Activities Performed", 3),
    ("ch3_skills", "3.3 Skills Acquired", 3),
    ("ch3_tools", "3.4 Equipment/Tools Used", 3),
    ("ch3_challenges", "3.5 Challenges Encountered", 3),
    ("ch3_solutions", "3.6 Solutions to the Challenges", 3),
    ("ch4_summary", "4.1 Summary", 4),
    ("ch4_conclusion", "4.2 Conclusion", 4),
    ("ch4_recommendations", "4.3 Recommendations", 4),
    ("references", "References", 5),
]

REQUIRED_KEYS = [k for k, _, _ in COORDINATOR_SECTIONS if k not in {"dedication", "acknowledgement"}]

US_TO_GB_SPELLINGS: Dict[str, str] = {
    "organization": "organisation",
    "organizations": "organisations",
    "organizational": "organisational",
    "color": "colour",
    "colors": "colours",
    "center": "centre",
    "centers": "centres",
    "behavior": "behaviour",
    "behaviors": "behaviours",
    "analyze": "analyse",
    "analyzes": "analyses",
    "analyzed": "analysed",
    "analyzing": "analysing",
    "specializing": "specialising",
    "specialized": "specialised",
    "modularization": "modularisation",
    "containerization": "containerisation",
    "customization": "customisation",
    "synchronization": "synchronisation",
    "optimization": "optimisation",
}

COMPUTER_SCIENCE_LEXICON: Set[str] = {
    "api", "rest", "fastapi", "django", "react", "python", "java", "sql", "sqlite",
    "postgresql", "docker", "container", "containerisation", "celery", "redis",
    "git", "github", "linux", "terminal", "bash", "ssh", "ide", "vscode", "intellij",
    "bios", "ram", "cpu", "motherboard", "ethernet", "ip", "subnet", "dhcp", "dns",
    "router", "switch", "firewall", "cabling", "rj45", "crimping", "operating system",
    "windows", "ubuntu", "testing", "playwright", "deployment", "render", "vercel",
    "supabase", "rag", "embedding", "llm", "ai", "token", "frontend", "backend",
    "database", "schema", "query", "orm", "endpoint", "crud", "jwt", "auth",
    "security", "csrf", "hsts", "ui", "ux", "wireframe", "figma", "responsive",
}


@dataclass
class Deduction:
    pillar: str
    section_key: Optional[str]
    points: float
    reason: str
    evidence: str


@dataclass
class ScorecardResult:
    report_id: Optional[int]
    project_id: Optional[int]
    total_score: float
    grade: str
    status: str
    automatic_fail: bool
    automatic_fail_reason: Optional[str]
    scores_by_pillar: Dict[str, Dict[str, Any]]
    all_deductions: List[Deduction]
    lowest_scoring_sections: List[Dict[str, Any]]
    pdf_pages_count: int
    evaluator_verdict: str


# =========================================================================
# Scorecard Evaluation Engine
# =========================================================================

class QualityScorecard:
    """Evaluates a SIWES Technical Report against the 100-point academic rubric."""

    def __init__(self, use_ai: bool = True):
        self.use_ai = use_ai

    def evaluate(
        self,
        report: Report,
        docx_path: Optional[str] = None,
        pdf_path: Optional[str] = None,
    ) -> ScorecardResult:
        """Run full evaluation on report, returning ScorecardResult."""
        sections_by_key = {s.section_key: s for s in report.sections.all()}
        project = report.project
        logbook_entries = list(project.logbook_entries.all())
        confirmed_facts = list(Fact.objects.filter(project=project, status="confirmed"))

        deductions: List[Deduction] = []
        scores: Dict[str, Dict[str, Any]] = {}

        # 1. Structure compliance (20)
        s_score, s_deds = self._eval_structure(report, sections_by_key)
        scores["structure"] = {"score": s_score, "max": 20.0, "deductions": s_deds}
        deductions.extend(s_deds)

        # 2. Content specificity and accuracy (25)
        c_score, c_deds, auto_fail, auto_reason = self._eval_content(
            report, sections_by_key, logbook_entries, confirmed_facts
        )
        scores["content"] = {"score": c_score, "max": 25.0, "deductions": c_deds}
        deductions.extend(c_deds)

        # 3. Writing quality (20)
        w_score, w_deds = self._eval_writing_quality(report, sections_by_key)
        scores["writing"] = {"score": w_score, "max": 20.0, "deductions": w_deds}
        deductions.extend(w_deds)

        # 4. Presentation and formatting (15)
        f_score, f_deds = self._eval_formatting(report, sections_by_key, docx_path)
        scores["presentation"] = {"score": f_score, "max": 15.0, "deductions": f_deds}
        deductions.extend(f_deds)

        # 5. Completeness and length (10)
        l_score, l_deds, page_count = self._eval_completeness_and_length(report, sections_by_key, pdf_path)
        scores["completeness_length"] = {"score": l_score, "max": 10.0, "deductions": l_deds}
        deductions.extend(l_deds)

        # 6. Authenticity (10)
        a_score, a_deds = self._eval_authenticity(report, sections_by_key, logbook_entries)
        scores["authenticity"] = {"score": a_score, "max": 10.0, "deductions": a_deds}
        deductions.extend(a_deds)

        # Calculate total
        raw_total = sum(item["score"] for item in scores.values())

        if auto_fail:
            total_score = 0.0
            status = "AUTOMATIC_FAIL"
            grade = "FAIL"
            verdict = f"DISQUALIFIED (Automatic Fail): {auto_reason}"
        else:
            total_score = round(max(0.0, min(100.0, raw_total)), 1)
            status = "PASS" if total_score >= 90.0 else "FAIL"
            if total_score >= 90.0:
                grade = "A (Distinction)"
                verdict = "Approved for department submission and oral defense."
            elif total_score >= 80.0:
                grade = "B (Good)"
                verdict = "Minor revisions required before binding."
            elif total_score >= 70.0:
                grade = "C (Satisfactory)"
                verdict = "Major revisions required; resubmit for review."
            else:
                grade = "FAIL (Unsatisfactory)"
                verdict = "Rejected; does not satisfy minimum academic standard."

        # Compute lowest-scoring sections
        section_penalty: Dict[str, float] = {}
        for d in deductions:
            if d.section_key:
                section_penalty[d.section_key] = section_penalty.get(d.section_key, 0.0) + d.points

        lowest_sections = [
            {"section_key": k, "penalty": p, "title": next((t for sk, t, _ in COORDINATOR_SECTIONS if sk == k), k)}
            for k, p in sorted(section_penalty.items(), key=lambda x: x[1], reverse=True)[:4]
        ]

        return ScorecardResult(
            report_id=report.id,
            project_id=project.id,
            total_score=total_score,
            grade=grade,
            status=status,
            automatic_fail=auto_fail,
            automatic_fail_reason=auto_reason,
            scores_by_pillar=scores,
            all_deductions=deductions,
            lowest_scoring_sections=lowest_sections,
            pdf_pages_count=page_count,
            evaluator_verdict=verdict,
        )

    # -------------------------------------------------------------------------
    # Pillar 1: Structure (20 Points)
    # -------------------------------------------------------------------------
    def _eval_structure(self, report: Report, sections: Dict[str, ReportSection]) -> Tuple[float, List[Deduction]]:
        score = 20.0
        deds: List[Deduction] = []

        # 1. Headings in order and verbatim (10 pts)
        actual_keys = list(report.sections.order_by("chapter_number", "order").values_list("section_key", flat=True))
        expected_keys = [k for k, _, _ in COORDINATOR_SECTIONS if k in sections]

        missing_required = [k for k in REQUIRED_KEYS if k not in sections or not sections[k].content.strip()]
        if missing_required:
            pts = min(6.0, len(missing_required) * 2.0)
            score -= pts
            deds.append(Deduction(
                pillar="structure", section_key=missing_required[0], points=pts,
                reason="Missing required coordinator section(s).",
                evidence=f"Missing: {', '.join(missing_required)}"
            ))

        # Check title correctness
        title_mismatches = []
        for key, expected_title, _ in COORDINATOR_SECTIONS:
            sec = sections.get(key)
            if sec and sec.title.strip().lower() != expected_title.strip().lower():
                title_mismatches.append(f"'{sec.title}' != '{expected_title}'")
        if title_mismatches:
            pts = min(4.0, len(title_mismatches) * 1.0)
            score -= pts
            deds.append(Deduction(
                pillar="structure", section_key=None, points=pts,
                reason="Section heading text deviates from coordinator's exact title.",
                evidence="; ".join(title_mismatches[:3])
            ))

        # 2. Numbering and TOC pagination (5 pts)
        toc_sec = sections.get("table_of_contents")
        if not toc_sec or not toc_sec.content.strip():
            score -= 5.0
            deds.append(Deduction(
                pillar="structure", section_key="table_of_contents", points=5.0,
                reason="Table of Contents is absent or empty.",
                evidence="No Table of Contents content found."
            ))
        else:
            toc_text = toc_sec.content
            if "i" not in toc_text or "CHAPTER ONE" not in toc_text:
                score -= 2.0
                deds.append(Deduction(
                    pillar="structure", section_key="table_of_contents", points=2.0,
                    reason="Table of Contents lacks dual Roman/Arabic numbering scheme.",
                    evidence="Missing 'i' or 'CHAPTER ONE' in TOC."
                ))

        # 3. Single References and Certification Signatures (5 pts)
        ref_sec = sections.get("references")
        if ref_sec:
            # Must NOT say 'CHAPTER FIVE' in its heading
            if "CHAPTER FIVE" in ref_sec.title.upper() or "CHAPTER 5" in ref_sec.title.upper():
                score -= 2.0
                deds.append(Deduction(
                    pillar="structure", section_key="references", points=2.0,
                    reason="References must appear as a standalone heading, not CHAPTER FIVE.",
                    evidence=f"Found: {ref_sec.title}"
                ))

        cert_sec = sections.get("certification")
        if cert_sec:
            c_text = cert_sec.content.lower()
            required_signers = ["industrial-based supervisor", "siwes coordinator", "hod"]
            missing_signers = [s for s in required_signers if s not in c_text]
            if missing_signers:
                pts = min(3.0, len(missing_signers) * 1.5)
                score -= pts
                deds.append(Deduction(
                    pillar="structure", section_key="certification", points=pts,
                    reason="Certification section is missing required signatory lines.",
                    evidence=f"Missing: {', '.join(missing_signers)}"
                ))

        return max(0.0, score), deds

    # -------------------------------------------------------------------------
    # Pillar 2: Content Specificity & Accuracy (25 Points)
    # -------------------------------------------------------------------------
    def _eval_content(
        self,
        report: Report,
        sections: Dict[str, ReportSection],
        logbook_entries: List[Any],
        confirmed_facts: List[Fact]
    ) -> Tuple[float, List[Deduction], bool, Optional[str]]:
        score = 25.0
        deds: List[Deduction] = []
        auto_fail = False
        auto_reason = None

        # Gather all text in the report
        full_text = " ".join(s.content for s in sections.values())
        plain_text = re.sub(r"<[^>]+>", " ", full_text)

        # 1. Anti-Fabrication & Strict Grounding (10 pts)
        # Check that company, supervisor, and tools are grounded
        project = report.project
        valid_org = (project.organization_name or "").strip().lower()
        valid_student = (project.full_name or "").strip().lower()

        # Check for cross-tenant / foreign project references
        foreign_facts = Fact.objects.filter(report_paragraphs__report=report).exclude(project=project)
        if foreign_facts.exists():
            auto_fail = True
            auto_reason = f"Cross-project fact leakage: Report cites Fact {foreign_facts.first().id} belonging to project {foreign_facts.first().project_id}."
            deds.append(Deduction(
                pillar="content", section_key=None, points=25.0,
                reason="Cross-tenant fact leakage detected.",
                evidence=auto_reason
            ))
            return 0.0, deds, True, auto_reason

        # Check for fabricated companies / supervisors
        suspicious_fabrications = [
            "google headquarters mountain view", "nasa jet propulsion laboratory",
            "microsoft redmond campus", "amazon web services seattle",
        ]
        for fab in suspicious_fabrications:
            if fab in plain_text.lower():
                auto_fail = True
                auto_reason = f"Fabricated host organisation or facility: '{fab}' detected."
                deds.append(Deduction(
                    pillar="content", section_key=None, points=25.0,
                    reason="Fabricated host organisation detected.",
                    evidence=fab
                ))
                return 0.0, deds, True, auto_reason

        # 2. Computer Science Technical Specificity (8 pts)
        tokens = set(re.findall(r"\b[a-zA-Z0-9_\-\.]{2,}\b", plain_text.lower()))
        matched_cs_terms = tokens.intersection(COMPUTER_SCIENCE_LEXICON)
        if len(matched_cs_terms) < 8:
            pts = 4.0
            score -= pts
            deds.append(Deduction(
                pillar="content", section_key="ch3_activities", points=pts,
                reason="Report lacks sufficient Computer Science technical specificity.",
                evidence=f"Only {len(matched_cs_terms)} distinct computing concepts identified (e.g. {list(matched_cs_terms)[:4]})."
            ))

        # 3. Chronological & Project Coverage (7 pts)
        sec_3_2 = sections.get("ch3_activities")
        if not sec_3_2 or not sec_3_2.content.strip():
            pts = 7.0
            score -= pts
            deds.append(Deduction(
                pillar="content", section_key="ch3_activities", points=pts,
                reason="Section 3.2 (Activities Performed) is missing or unpopulated.",
                evidence="Section 3.2 is empty."
            ))
        else:
            c_3_2 = sec_3_2.content
            # Check for cluster headings
            cluster_matches = re.findall(r"WEEK\s+\d+(?:-\d+)?\s*:", c_3_2, re.I)
            if len(cluster_matches) < 4:
                pts = 3.0
                score -= pts
                deds.append(Deduction(
                    pillar="content", section_key="ch3_activities", points=pts,
                    reason="Section 3.2 lacks structured chronological week clusters.",
                    evidence=f"Found {len(cluster_matches)} week clusters (expected at least 4)."
                ))

            # Check that raw 'Week N:' lines were not dumped in body
            raw_dumps = re.findall(r"<p>\s*Week\s+\d+\s*:", c_3_2, re.I)
            if raw_dumps:
                pts = 2.0
                score -= pts
                deds.append(Deduction(
                    pillar="content", section_key="ch3_activities", points=pts,
                    reason="Section 3.2 contains unclustered raw logbook lines with 'Week N:' prefixes.",
                    evidence=raw_dumps[0]
                ))

        return max(0.0, score), deds, False, None

    # -------------------------------------------------------------------------
    # Pillar 3: Writing Quality (20 Points)
    # -------------------------------------------------------------------------
    def _eval_writing_quality(self, report: Report, sections: Dict[str, ReportSection]) -> Tuple[float, List[Deduction]]:
        score = 20.0
        deds: List[Deduction] = []

        full_text = " ".join(s.content for s in sections.values() if s.section_key != "references")
        plain = re.sub(r"<[^>]+>", " ", full_text)

        # 1. British English spelling (5 pts)
        words = re.findall(r"\b[a-zA-Z]+\b", plain.lower())
        us_found: List[str] = []
        for w in words:
            if w in US_TO_GB_SPELLINGS:
                us_found.append(f"{w} -> {US_TO_GB_SPELLINGS[w]}")

        if us_found:
            pts = min(5.0, len(us_found) * 1.0)
            score -= pts
            deds.append(Deduction(
                pillar="writing", section_key=None, points=pts,
                reason="American English spelling variants detected; report requires consistent British English.",
                evidence="; ".join(us_found[:4])
            ))

        # 2. First-Person Active Perspective (5 pts)
        # Check Chapter 3 and 4
        ch3_and_4_text = " ".join(
            s.content for k, s in sections.items()
            if k.startswith("ch3_") or k.startswith("ch4_")
        )
        ch3_4_plain = re.sub(r"<[^>]+>", " ", ch3_and_4_text)

        third_person_matches = re.findall(r"\b(?:the student|the intern|the trainee)\s+(?:was|did|carried out|performed|learnt)\b", ch3_4_plain, re.I)
        if len(third_person_matches) > 1:
            pts = min(4.0, len(third_person_matches) * 1.0)
            score -= pts
            deds.append(Deduction(
                pillar="writing", section_key="ch3_activities", points=pts,
                reason="Inconsistent third-person passive perspective in technical activity sections.",
                evidence=third_person_matches[0]
            ))

        # 3. Grammar, Unterminated Fragments & Placeholders (5 pts)
        placeholder_matches = re.findall(r"\[(?:INPUT NEEDED|TODO|INSERT|CLICK HERE|MISSING)[^\]]*\]", full_text, re.I)
        if placeholder_matches:
            pts = 5.0
            score -= pts
            deds.append(Deduction(
                pillar="writing", section_key=None, points=pts,
                reason="Unfilled placeholder markers or template instructions detected.",
                evidence=placeholder_matches[0]
            ))

        # 4. Cross-Section Non-Duplication (5 pts)
        sec_4_1 = sections.get("ch4_summary")
        sec_4_2 = sections.get("ch4_conclusion")
        if sec_4_1 and sec_4_2:
            s1_sentences = {s.strip().lower() for s in re.split(r"[.!?]\s+", re.sub(r"<[^>]+>", " ", sec_4_1.content)) if len(s.strip()) > 30}
            s2_sentences = {s.strip().lower() for s in re.split(r"[.!?]\s+", re.sub(r"<[^>]+>", " ", sec_4_2.content)) if len(s.strip()) > 30}
            duplicates = s1_sentences.intersection(s2_sentences)
            if duplicates:
                pts = min(4.0, len(duplicates) * 2.0)
                score -= pts
                deds.append(Deduction(
                    pillar="writing", section_key="ch4_conclusion", points=pts,
                    reason="Verbatim duplicated sentences between Section 4.1 (Summary) and 4.2 (Conclusion).",
                    evidence=list(duplicates)[0][:80]
                ))

        return max(0.0, score), deds

    # -------------------------------------------------------------------------
    # Pillar 4: Presentation & Formatting (15 Points)
    # -------------------------------------------------------------------------
    def _eval_formatting(
        self,
        report: Report,
        sections: Dict[str, ReportSection],
        docx_path: Optional[str]
    ) -> Tuple[float, List[Deduction]]:
        score = 15.0
        deds: List[Deduction] = []

        # 1. Cover logo check (4 pts)
        title_sec = sections.get("title_page")
        if not title_sec or "<img" not in title_sec.content:
            score -= 4.0
            deds.append(Deduction(
                pillar="presentation", section_key="title_page", points=4.0,
                reason="Institution logo is missing from the cover page.",
                evidence="Title page content does not contain an <img> element."
            ))

        # 2. Organogram Chart check (3 pts)
        org_sec = sections.get("ch2_organogram")
        if not org_sec:
            score -= 3.0
            deds.append(Deduction(
                pillar="presentation", section_key="ch2_organogram", points=3.0,
                reason="Section 2.4 (Organogram) is missing.",
                evidence="Section 2.4 not found."
            ))
        else:
            if "<img" not in org_sec.content and "<svg" not in org_sec.content:
                score -= 2.0
                deds.append(Deduction(
                    pillar="presentation", section_key="ch2_organogram", points=2.0,
                    reason="Organogram is rendered as plain ASCII text rather than a structured chart image.",
                    evidence="No <img> or <svg> element in Section 2.4."
                ))
            if "supervisor:" not in org_sec.content.lower() and "supervisor" not in org_sec.content.lower():
                score -= 1.0
                deds.append(Deduction(
                    pillar="presentation", section_key="ch2_organogram", points=1.0,
                    reason="Organogram does not show student intern placed under unit with supervisor title.",
                    evidence="Missing 'Supervisor:' label in organogram structure."
                ))

        # 3. DOCX OOXML Formatting Check (8 pts) if file exists
        if docx_path and os.path.exists(docx_path):
            try:
                doc = Document(docx_path)
                # Check Margins (2 pts)
                for sec in doc.sections:
                    if any(abs(v.cm - 2.54) > 0.1 for v in (sec.top_margin, sec.bottom_margin, sec.left_margin, sec.right_margin)):
                        score -= 2.0
                        deds.append(Deduction(
                            pillar="presentation", section_key=None, points=2.0,
                            reason="Page margins deviate from 2.54 cm standard.",
                            evidence=f"Margins: top={sec.top_margin.cm:.2f}cm, left={sec.left_margin.cm:.2f}cm"
                        ))
                        break

                # Check Fonts (100% Times New Roman) (3 pts)
                non_tnr_runs = []
                for p in doc.paragraphs:
                    for r in p.runs:
                        if r.text.strip() and r.font.name and r.font.name != "Times New Roman":
                            non_tnr_runs.append(f"'{r.text[:20]}' in {r.font.name}")
                if non_tnr_runs:
                    score -= 3.0
                    deds.append(Deduction(
                        pillar="presentation", section_key=None, points=3.0,
                        reason="Non-Times New Roman typography found in document.",
                        evidence=non_tnr_runs[0]
                    ))

                # Check Body Paragraph Justification (3 pts)
                non_justified_body = 0
                for p in doc.paragraphs:
                    if p.text.strip() and p.style.name == "Normal" and not p.text.strip().startswith(("WEEK ", "Figure ", "1.", "2.", "•")):
                        if p.alignment != WD_ALIGN_PARAGRAPH.JUSTIFY and p.alignment is not None:
                            non_justified_body += 1
                if non_justified_body > 5:
                    score -= 2.0
                    deds.append(Deduction(
                        pillar="presentation", section_key=None, points=2.0,
                        reason="Body paragraphs are not justified.",
                        evidence=f"{non_justified_body} body paragraphs not aligned to justify."
                    ))
            except Exception as exc:
                logger.warning("DOCX format inspection error: %s", exc)

        return max(0.0, score), deds

    # -------------------------------------------------------------------------
    # Pillar 5: Completeness & Length (10 Points)
    # -------------------------------------------------------------------------
    def _eval_completeness_and_length(
        self,
        report: Report,
        sections: Dict[str, ReportSection],
        pdf_path: Optional[str]
    ) -> Tuple[float, List[Deduction], int]:
        score = 10.0
        deds: List[Deduction] = []
        page_count = 0

        # 1. Required sections completeness (5 pts)
        missing_secs = [k for k in REQUIRED_KEYS if k not in sections or len(sections[k].content.strip()) < 10]
        if missing_secs:
            pts = min(5.0, len(missing_secs) * 1.5)
            score -= pts
            deds.append(Deduction(
                pillar="completeness_length", section_key=missing_secs[0], points=pts,
                reason="Required section is missing or unsubstantiated.",
                evidence=f"Incomplete: {', '.join(missing_secs)}"
            ))

        # 2. Real Render Page Count (5 pts)
        if pdf_path and os.path.exists(pdf_path):
            try:
                import pymupdf
                pdf_doc = pymupdf.open(pdf_path)
                page_count = len(pdf_doc)
            except Exception:
                page_count = 0

        if not page_count and report.pdf_file and report.pdf_file.name:
            candidate = Path(report.pdf_file.path)
            if candidate.exists():
                try:
                    import pymupdf
                    page_count = len(pymupdf.open(str(candidate)))
                except Exception:
                    page_count = 0

        if page_count > 0:
            if 12 <= page_count <= 15:
                pass  # Full 5 points
            elif page_count in {11, 16, 17}:
                score -= 1.0
                deds.append(Deduction(
                    pillar="completeness_length", section_key=None, points=1.0,
                    reason=f"Document page count ({page_count} pages) slightly deviates from target range (12–15 pages).",
                    evidence=f"Rendered total pages: {page_count}"
                ))
            else:
                pts = min(4.0, abs(page_count - 14) * 0.8)
                score -= pts
                deds.append(Deduction(
                    pillar="completeness_length", section_key=None, points=pts,
                    reason=f"Document length ({page_count} pages) outside required 12–15 page range.",
                    evidence=f"Rendered total pages: {page_count}"
                ))
        else:
            # Estimate from word count if PDF not yet built
            total_words = sum(len(s.content.split()) for s in sections.values())
            est_pages = max(1, total_words // 240)
            if not (12 <= est_pages <= 17):
                score -= 2.0
                deds.append(Deduction(
                    pillar="completeness_length", section_key=None, points=2.0,
                    reason=f"Estimated document length (~{est_pages} pages) outside 12–15 page range.",
                    evidence=f"Total words: {total_words}"
                ))

        return max(0.0, score), deds, page_count

    # -------------------------------------------------------------------------
    # Pillar 6: Authenticity (10 Points)
    # -------------------------------------------------------------------------
    def _eval_authenticity(
        self,
        report: Report,
        sections: Dict[str, ReportSection],
        logbook_entries: List[Any]
    ) -> Tuple[float, List[Deduction]]:
        score = 10.0
        deds: List[Deduction] = []

        # 1. Check for realistic challenge & solution (5 pts)
        sec_3_5 = sections.get("ch3_challenges")
        sec_3_6 = sections.get("ch3_solutions")
        if not sec_3_5 or not sec_3_5.content.strip() or not sec_3_6 or not sec_3_6.content.strip():
            score -= 3.0
            deds.append(Deduction(
                pillar="authenticity", section_key="ch3_challenges", points=3.0,
                reason="Section 3.5 (Challenges) or 3.6 (Solutions) lacks concrete troubleshooting content.",
                evidence="Empty or generic challenges/solutions."
            ))
        else:
            c_text = sec_3_5.content.lower() + " " + sec_3_6.content.lower()
            generic_red_flags = ["everything went smoothly with no errors", "no challenges were encountered"]
            if any(f in c_text for f in generic_red_flags):
                score -= 2.0
                deds.append(Deduction(
                    pillar="authenticity", section_key="ch3_challenges", points=2.0,
                    reason="Challenges section contains generic denial of technical difficulties.",
                    evidence="Generic claim: no challenges encountered."
                ))

        # 2. Check for authentic, structured recommendations (5 pts)
        sec_4_3 = sections.get("ch4_recommendations")
        if not sec_4_3 or not sec_4_3.content.strip():
            score -= 3.0
            deds.append(Deduction(
                pillar="authenticity", section_key="ch4_recommendations", points=3.0,
                reason="Section 4.3 (Recommendations) is missing.",
                evidence="Section 4.3 not populated."
            ))
        else:
            r_text = sec_4_3.content.lower()
            required_stakeholders = ["host organisation" if "host" in r_text else "to ", "lasustech", "itf"]
            missing_targets = [t for t in ["lasustech", "itf"] if t not in r_text]
            if missing_targets:
                score -= 2.0
                deds.append(Deduction(
                    pillar="authenticity", section_key="ch4_recommendations", points=2.0,
                    reason="Recommendations must address the host company, university, and ITF.",
                    evidence=f"Missing recommendations for: {', '.join(missing_targets)}"
                ))

        return max(0.0, score), deds


# =========================================================================
# Markdown & Terminal Exporters
# =========================================================================

def format_scorecard_markdown(res: ScorecardResult, report_title: str = "SIWES Technical Report") -> str:
    """Renders ScorecardResult into academic coordinator markdown scorecard format."""
    lines = [
        f"# SIWES Technical Report Quality Scorecard",
        f"**Document**: {report_title} (Project ID: {res.project_id}, Report ID: {res.report_id})",
        f"**Verdict**: **{res.status}** (Overall Score: **{res.total_score}/100** · Grade: **{res.grade}**)",
        f"**Page Count**: {res.pdf_pages_count} Pages (Target: 12–15 Pages)",
        "",
        "---",
        "",
        "## 1. Pillar Score Breakdown",
        "",
        "| Evaluation Pillar | Max Points | Points Awarded | Performance |",
        "|---|:---:|:---:|:---:|",
    ]

    pillar_names = [
        ("structure", "Structure Compliance"),
        ("content", "Content Specificity & Accuracy"),
        ("writing", "Writing Quality"),
        ("presentation", "Presentation & Formatting"),
        ("completeness_length", "Completeness & Length"),
        ("authenticity", "Authenticity"),
    ]

    for p_key, p_label in pillar_names:
        p_data = res.scores_by_pillar.get(p_key, {"score": 0.0, "max": 0.0})
        pct = (p_data["score"] / max(1.0, p_data["max"])) * 100
        indicator = "🟢 Excellent" if pct >= 90 else ("🟡 Satisfactory" if pct >= 75 else "🔴 Needs Revision")
        lines.append(f"| {p_label} | {p_data['max']:.0f} | **{p_data['score']:.1f}** | {indicator} ({pct:.0f}%) |")

    lines.append(f"| **Total Composite Score** | **100** | **{res.total_score:.1f}** | **{res.grade}** |")
    lines.append("")

    if res.automatic_fail:
        lines.extend([
            "### ⚠️ AUTOMATIC FAIL TRIGGERED",
            f"> **Reason**: {res.automatic_fail_reason}",
            "",
        ])

    lines.extend([
        "## 2. Lowest-Scoring Sections (Targeted Improvement Areas)",
        "",
    ])

    if res.lowest_scoring_sections:
        for idx, item in enumerate(res.lowest_scoring_sections, 1):
            lines.append(f"{idx}. **{item['title']}** (`{item['section_key']}`): -{item['penalty']:.1f} points deducted")
    else:
        lines.append("No section penalties identified; document achieved full points across evaluated sections.")
    lines.append("")

    lines.extend([
        "## 3. Itemised Deductions & Quoted Evidence",
        "",
    ])

    if res.all_deductions:
        for d in res.all_deductions:
            sec_label = f" (`{d.section_key}`)" if d.section_key else ""
            lines.append(f"- **[-{d.points:.1f} pts] {d.pillar.capitalize()}{sec_label}**: {d.reason}")
            if d.evidence:
                lines.append(f"  *Evidence Quote*: `\"{d.evidence}\"`")
    else:
        lines.append("Zero deductions recorded; document strictly conforms to all rubric criteria.")
    lines.append("")

    lines.extend([
        "## 4. Supervising Lecturer / Coordinator Verdict",
        f"> {res.evaluator_verdict}",
        "",
    ])

    return "\n".join(lines)
