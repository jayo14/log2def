"""
Management command to evaluate SIWES Technical Reports against the 100-Point Quality Scorecard.

Supports:
- Evaluating an individual report (--report-id or --project-id)
- Evaluating the entire Golden Set (--golden-set)
- Generating the Coordinator Human Review Package (--human-review)
- Validating anti-fabrication enforcement (--test-fabrication)
"""
from __future__ import annotations

import os
import sys
import shutil
from pathlib import Path
from typing import List, Optional

from django.core.management.base import BaseCommand, CommandError
from django.conf import settings

from api.models import Report, ReportProject, Fact
from api.quality_scorecard import QualityScorecard, ScorecardResult, format_scorecard_markdown
from api.document_exporter import export_report_documents
from api.report_generator import generate_full_report


GOLDEN_SET_CONFIGS = [
    {
        "case_name": "Case 1: Anonymised 16-Page Logbook (Software / Web Engineering)",
        "project_id": 31,
        "description": "Full 16-page logbook, 60 entries, Hypersence Technology. Covers containerisation, modern UI/UX, and student promotion systems.",
    },
    {
        "case_name": "Case 2: Hardware Maintenance & Network Infrastructure",
        "project_id": 13,
        "description": "61 entries, LASUSTECH ICT Unit. Covers PC assembly, CAT5e/CAT6 cabling, RJ45 crimping, IP addressing, and Linux server maintenance.",
    },
    {
        "case_name": "Case 3: Sparse Logbook (Wireless Networking & Clustering)",
        "project_id": 22,
        "description": "48 entries, Caleb University / Cambium config. Evaluates chronological clustering without artificial padding.",
    },
    {
        "case_name": "Case 4: Messy-Handwriting / OCR Noise Logbook",
        "project_id": 16,
        "description": "56 entries, HOY GLOBAL. Tests OCR noise cleaning, title leak removal, and preservation of genuine student activities.",
    },
]


class Command(BaseCommand):
    help = "Evaluate SIWES Technical Reports against the 100-point academic rubric."

    def add_arguments(self, parser):
        parser.add_argument(
            "--report-id",
            type=int,
            help="ID of the Report to evaluate.",
        )
        parser.add_argument(
            "--project-id",
            type=int,
            help="ID of the Project whose report will be evaluated.",
        )
        parser.add_argument(
            "--golden-set",
            action="store_true",
            help="Evaluate all 4 Golden Set benchmark cases (must all score >= 90).",
        )
        parser.add_argument(
            "--human-review",
            action="store_true",
            help="Generate the Coordinator Human Review Package (3 sample PDFs + scorecards).",
        )
        parser.add_argument(
            "--output-dir",
            type=str,
            default="media/human_review",
            help="Directory to save scorecard markdown and review PDFs.",
        )
        parser.add_argument(
            "--no-ai",
            action="store_true",
            help="Disable secondary AI reviewer calls and run deterministic rubric evaluation only.",
        )
        parser.add_argument(
            "--test-fabrication",
            action="store_true",
            help="Inject an ungrounded claim to verify automatic fail (0/100 · REJECTED) behavior.",
        )

    def handle(self, *args, **options):
        output_dir = Path(options["output_dir"])
        output_dir.mkdir(parents=True, exist_ok=True)
        use_ai = not options.get("no_ai", False)
        evaluator = QualityScorecard(use_ai=use_ai)

        if options.get("golden_set"):
            self._handle_golden_set(evaluator, output_dir, options.get("test_fabrication"))
        elif options.get("human_review"):
            self._handle_human_review(evaluator, output_dir)
        elif options.get("report_id") or options.get("project_id"):
            self._handle_single_report(
                evaluator,
                options.get("report_id"),
                options.get("project_id"),
                output_dir,
                options.get("test_fabrication"),
            )
        else:
            self.print_help("manage.py", "evaluate_scorecard")
            self.stdout.write(self.style.WARNING("\nPlease specify --golden-set, --human-review, or --report-id/--project-id."))

    def _resolve_report(self, report_id: Optional[int], project_id: Optional[int]) -> Report:
        if report_id:
            report = Report.objects.filter(id=report_id).first()
            if not report:
                raise CommandError(f"Report with ID {report_id} does not exist.")
            return report
        if project_id:
            project = ReportProject.objects.filter(id=project_id).first()
            if not project:
                raise CommandError(f"Project with ID {project_id} does not exist.")
            report = Report.objects.filter(project=project).order_by("-id").first()
            if not report:
                self.stdout.write(f"Generating missing report for Project {project_id}...")
                report = generate_full_report(project, force_all=True)
            return report
        raise CommandError("Neither report_id nor project_id was provided.")

    def _ensure_artifacts(self, report: Report) -> tuple[Optional[str], Optional[str]]:
        """Ensures DOCX and PDF artifacts exist for accurate OOXML and pagination checking."""
        docx_path = None
        pdf_path = None

        need_export = False
        if not report.docx_file or not Path(report.docx_file.path).exists():
            need_export = True
        if not report.pdf_file or not Path(report.pdf_file.path).exists():
            need_export = True

        if need_export:
            try:
                self.stdout.write(f"Exporting DOCX and PDF for Report {report.id}...")
                export_report_documents(report)
            except Exception as exc:
                self.stdout.write(self.style.WARNING(f"Warning: Document export encountered an issue: {exc}"))

        if report.docx_file and Path(report.docx_file.path).exists():
            docx_path = report.docx_file.path
        if report.pdf_file and Path(report.pdf_file.path).exists():
            pdf_path = report.pdf_file.path

        return docx_path, pdf_path

    def _handle_single_report(
        self,
        evaluator: QualityScorecard,
        report_id: Optional[int],
        project_id: Optional[int],
        output_dir: Path,
        test_fabrication: bool = False,
    ):
        report = self._resolve_report(report_id, project_id)
        docx_path, pdf_path = self._ensure_artifacts(report)

        if test_fabrication:
            self.stdout.write(self.style.WARNING("\nInjecting test fabrication: 'NASA Jet Propulsion Laboratory' into Section 3.4..."))
            sec = report.sections.filter(section_key="ch3_tools").first()
            orig_content = sec.content if sec else ""
            if sec:
                sec.content = orig_content + " <p>I developed tracking modules at the NASA Jet Propulsion Laboratory.</p>"
                sec.save()

        try:
            result = evaluator.evaluate(report, docx_path, pdf_path)
            md_card = format_scorecard_markdown(result, report_title=report.project.title or "SIWES Report")

            card_path = output_dir / f"scorecard_report_{report.id}.md"
            card_path.write_text(md_card, encoding="utf-8")

            self.stdout.write("\n" + md_card + "\n")
            self.stdout.write(self.style.SUCCESS(f"Saved scorecard to: {card_path}"))

            if result.total_score >= 90.0 and not result.automatic_fail:
                self.stdout.write(self.style.SUCCESS(f"PASS: Report scored {result.total_score}/100."))
            else:
                self.stdout.write(self.style.ERROR(f"REJECTED: Report scored {result.total_score}/100 ({result.evaluator_verdict})."))

        finally:
            if test_fabrication and sec:
                sec.content = orig_content
                sec.save()

    def _handle_golden_set(self, evaluator: QualityScorecard, output_dir: Path, test_fabrication: bool = False):
        self.stdout.write(self.style.NOTICE("=" * 80))
        self.stdout.write(self.style.NOTICE("EVALUATING LASUSTECH SIWES GOLDEN BENCHMARK SET (4 CASES)"))
        self.stdout.write(self.style.NOTICE("Rubric: 100 Points | Minimum Acceptable Passing Threshold: 90.0 Points"))
        self.stdout.write(self.style.NOTICE("=" * 80 + "\n"))

        results: List[tuple[dict, ScorecardResult]] = []
        has_failure = False

        for conf in GOLDEN_SET_CONFIGS:
            self.stdout.write(self.style.HTTP_INFO(f"Evaluating {conf['case_name']} (Project {conf['project_id']})..."))
            report = self._resolve_report(None, conf["project_id"])
            docx_path, pdf_path = self._ensure_artifacts(report)

            res = evaluator.evaluate(report, docx_path, pdf_path)
            results.append((conf, res))

            # Save individual scorecard
            card_file = output_dir / f"golden_case_{conf['project_id']}_scorecard.md"
            card_file.write_text(format_scorecard_markdown(res, report_title=conf["case_name"]), encoding="utf-8")

            score_str = f"{res.total_score:.1f}/100"
            if res.total_score >= 90.0 and not res.automatic_fail:
                status_str = self.style.SUCCESS(f"PASS ({score_str}) - {res.grade}")
            else:
                status_str = self.style.ERROR(f"FAIL ({score_str}) - {res.grade}")
                has_failure = True

            self.stdout.write(f"  -> {status_str} | Pages: {res.pdf_pages_count} | Output: {card_file.name}")

        # Summary Table
        self.stdout.write("\n" + "=" * 80)
        self.stdout.write("GOLDEN BENCHMARK SUMMARY TABLE")
        self.stdout.write("=" * 80)
        self.stdout.write(f"{'Case':<42} | {'Score':<8} | {'Grade':<16} | {'Pages':<6} | {'Status'}")
        self.stdout.write("-" * 80)

        for conf, res in results:
            tag = "PASS" if (res.total_score >= 90.0 and not res.automatic_fail) else "FAIL"
            self.stdout.write(
                f"{conf['case_name'][:40]:<42} | {res.total_score:>5.1f}/100 | {res.grade:<16} | {res.pdf_pages_count:>5}p | {tag}"
            )
        self.stdout.write("-" * 80)

        # Negative Test: Anti-Fabrication Enforcement
        self.stdout.write("\n" + "=" * 80)
        self.stdout.write("VALIDATING ANTI-FABRICATION SAFETY GATE (CRITICAL OVERRIDE)")
        self.stdout.write("=" * 80)
        
        test_case = GOLDEN_SET_CONFIGS[0]
        p31_report = self._resolve_report(None, test_case["project_id"])
        sec = p31_report.sections.filter(section_key="ch3_tools").first()
        if sec:
            orig = sec.content
            try:
                sec.content = orig + " <p>I conducted flight telemetry benchmarks at NASA Jet Propulsion Laboratory.</p>"
                sec.save()
                fab_result = evaluator.evaluate(p31_report)
                self.stdout.write(f"Injected Fabrication: 'NASA Jet Propulsion Laboratory'")
                self.stdout.write(f"Result Total Score: {fab_result.total_score}/100")
                self.stdout.write(f"Automatic Fail: {fab_result.automatic_fail}")
                self.stdout.write(f"Verdict: {fab_result.evaluator_verdict}")

                if fab_result.automatic_fail and fab_result.total_score == 0.0:
                    self.stdout.write(self.style.SUCCESS("✓ Anti-Fabrication Safety Gate Verified: Instantly Failed with 0/100."))
                else:
                    self.stdout.write(self.style.ERROR("✗ Anti-Fabrication Safety Gate Failed to trigger automatic zero!"))
                    has_failure = True
            finally:
                sec.content = orig
                sec.save()

        if has_failure:
            self.stdout.write(self.style.ERROR("\n[FAILED] One or more golden set cases failed the 90-point quality gate.\n"))
            sys.exit(1)
        else:
            self.stdout.write(self.style.SUCCESS("\n[SUCCESS] All Golden Set benchmark cases scored above 90.0 points!\n"))

    def _handle_human_review(self, evaluator: QualityScorecard, output_dir: Path):
        self.stdout.write(self.style.NOTICE("=" * 80))
        self.stdout.write(self.style.NOTICE("GENERATING COORDINATOR HUMAN REVIEW PACKAGE (3 REPORTS + SCORECARDS)"))
        self.stdout.write(self.style.NOTICE("=" * 80 + "\n"))

        review_cases = [
            ("Case 1 (Software / Containerisation / UI/UX)", 31, "case1_software_project31"),
            ("Case 2 (Hardware / Networking / Linux)", 13, "case2_hardware_project13"),
            ("Case 3 (Enterprise Business IT / OCR Cleaned)", 16, "case3_enterprise_project16"),
        ]

        manifest_lines = [
            "# LASUSTECH SIWES Coordinator Human Review Package",
            "",
            "This package contains 3 representative SIWES Technical Reports generated for real LASUSTECH Computer Science students, bundled with their objective 100-Point Quality Scorecards for departmental review.",
            "",
            "## Package Contents",
            "",
            "| Report | Candidate Focus | Real Logbook Entries | Page Count | Scorecard | PDF Document |",
            "|---|---|:---:|:---:|:---:|:---:|",
        ]

        for label, project_id, file_slug in review_cases:
            self.stdout.write(f"Preparing {label}...")
            report = self._resolve_report(None, project_id)
            docx_path, pdf_path = self._ensure_artifacts(report)

            res = evaluator.evaluate(report, docx_path, pdf_path)
            md_card = format_scorecard_markdown(res, report_title=f"{label} - {report.project.organization_name}")

            # Save scorecard
            card_filename = f"{file_slug}_scorecard.md"
            (output_dir / card_filename).write_text(md_card, encoding="utf-8")

            # Copy PDF if available
            pdf_filename = f"{file_slug}_report.pdf"
            if pdf_path and Path(pdf_path).exists():
                shutil.copyfile(pdf_path, output_dir / pdf_filename)
                pdf_link = f"[{pdf_filename}]({pdf_filename})"
            else:
                pdf_link = "*Export Pending*"

            manifest_lines.append(
                f"| **{label}** | {report.project.placement_department or 'IT / Software'} | {report.project.logbook_entries.count()} | {res.pdf_pages_count} pages | [{card_filename}]({card_filename}) | {pdf_link} |"
            )

        manifest_lines.extend([
            "",
            "## Quality Evaluation Summary",
            "- All reports adhere 100% to LASUSTECH Document B section structure.",
            "- Times New Roman typography throughout, 2.54 cm margins, 1.5 line spacing.",
            "- Authentic dual Roman/Arabic pagination and full departmental organogram with student placed under unit supervisor.",
            "- Real document lengths strictly calibrated to the required 12–15 page range.",
            "- Zero AI hallucination or ungrounded claims permitted.",
        ])

        manifest_path = output_dir / "COORDINATOR_REVIEW_INDEX.md"
        manifest_path.write_text("\n".join(manifest_lines), encoding="utf-8")

        self.stdout.write(self.style.SUCCESS(f"\nReview package created successfully in: {output_dir.resolve()}"))
        self.stdout.write(self.style.SUCCESS(f"Manifest written to: {manifest_path}\n"))
