"""Run the current OCR flow on local fixtures and retain per-stage trace files."""
from __future__ import annotations

import re
import uuid
from pathlib import Path

from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.files import File
from django.core.management.base import BaseCommand, CommandError
from django.db import connection
from django.test.utils import override_settings

from api.document_processor import process_source_document
from api.models import ReportProject, SourceDocument


def natural_key(path: Path):
    return [int(part) if part.isdigit() else part.lower() for part in re.split(r"(\d+)", path.name)]


class Command(BaseCommand):
    help = "Trace the existing OCR pipeline on PDF/image fixture(s), without changing the OCR engine."

    def add_arguments(self, parser):
        parser.add_argument("input", help="A PDF/image file or a directory of page images")
        parser.add_argument("--trace-dir", default="eval/ocr/runs/latest", help="Directory for original, preprocessed, OCR, and structured artifacts")

    def handle(self, *args, **options):
        if not settings.DEBUG or connection.vendor != "sqlite":
            raise CommandError("OCR fixture tracing is dev-only: run with DEBUG=True and an isolated SQLite database.")
        input_path = Path(options["input"]).expanduser().resolve()
        output_path = Path(options["trace_dir"]).expanduser().resolve()
        if not input_path.exists():
            raise CommandError(f"Fixture path does not exist: {input_path}")
        if input_path.is_dir():
            files = sorted((p for p in input_path.iterdir() if p.suffix.lower() in {".jpg", ".jpeg", ".png", ".webp", ".tif", ".tiff"}), key=natural_key)
        else:
            files = [input_path]
        if not files:
            raise CommandError("No supported PDF or image pages found in the fixture path.")
        if any(path.suffix.lower() not in {".pdf", ".jpg", ".jpeg", ".png", ".webp", ".tif", ".tiff"} for path in files):
            raise CommandError("Only PDF and image fixtures are supported.")
        if input_path.is_dir() and any(path.suffix.lower() == ".pdf" for path in files):
            raise CommandError("A fixture directory may contain page images, or pass one PDF file directly.")

        output_path.mkdir(parents=True, exist_ok=True)
        media_root = output_path / "media"
        User = get_user_model()
        username = f"ocr-trace-{uuid.uuid4().hex}"
        user = None
        project = None
        document_ids = []
        with override_settings(MEDIA_ROOT=media_root, LOG2DEF_OCR_TRACE_DIR=output_path):
            try:
                user = User.objects.create(username=username, email="")
                project = ReportProject.objects.create(user=user, title="Local OCR evaluation fixture")
                for index, path in enumerate(files):
                    file_type = "pdf" if path.suffix.lower() == ".pdf" else "image"
                    with path.open("rb") as source:
                        source_document = SourceDocument.objects.create(
                            project=project,
                            file=File(source, name=path.name),
                            original_filename=path.name,
                            file_type=file_type,
                            file_size=path.stat().st_size,
                            page_index=index,
                        )
                    document_ids.append(source_document.id)
                    if not process_source_document(source_document.id):
                        raise CommandError(f"The current pipeline failed for {path.name}.")
            finally:
                # Keep the trace artifacts; remove temporary rows and copied uploads.
                if project is not None:
                    project.delete()
                if user is not None:
                    user.delete()

        self.stdout.write(self.style.SUCCESS(
            f"Traced {len(files)} input file(s). Per-page artifacts: {output_path / 'document-<id>' / 'page-<number>'}"
        ))
