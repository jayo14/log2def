import os
import mimetypes
from pathlib import Path
from django.core.management.base import BaseCommand
from django.conf import settings
from api.storage import get_s3_client, get_bucket_name, upload_object


class Command(BaseCommand):
    help = "Synchronizes local media assets (backend/media) to Rumpty Cloud S3 storage."

    def add_arguments(self, parser):
        parser.add_argument(
            '--media-dir',
            default=None,
            help='Local media directory path (default: settings.MEDIA_ROOT)',
        )
        parser.add_argument(
            '--prefix',
            default='',
            help='S3 key prefix for uploaded objects.',
        )
        parser.add_argument(
            '--dry-run',
            action='store_true',
            help='Scan local files without uploading.',
        )

    def handle(self, *args, **options):
        media_dir_str = options.get('media_dir') or str(getattr(settings, 'MEDIA_ROOT', 'backend/media'))
        media_dir = Path(media_dir_str).resolve()
        prefix = options.get('prefix', '').strip('/')
        dry_run = options.get('dry_run', False)

        self.stdout.write(self.style.MIGRATE_HEADING(f"Syncing media assets from '{media_dir}' to S3..."))

        if not media_dir.exists():
            self.stderr.write(self.style.ERROR(f"Directory '{media_dir}' does not exist."))
            return

        s3 = get_s3_client()
        bucket = get_bucket_name()
        if not s3 and not dry_run:
            self.stdout.write(self.style.WARNING(
                "S3 client not initialized (missing credentials). Running in dry-run mode."
            ))
            dry_run = True

        files_to_sync = []
        for path in media_dir.rglob('*'):
            if path.is_file():
                rel_path = path.relative_to(media_dir).as_posix()
                s3_key = f"{prefix}/{rel_path}".lstrip('/') if prefix else rel_path
                files_to_sync.append((path, s3_key))

        self.stdout.write(f"Discovered {len(files_to_sync)} local media file(s).")

        synced_count = 0
        error_count = 0

        for local_path, s3_key in files_to_sync:
            file_size = local_path.stat().st_size
            content_type, _ = mimetypes.guess_type(str(local_path))
            content_type = content_type or 'application/octet-stream'

            if dry_run:
                self.stdout.write(f"  [DRY-RUN] Would upload: {s3_key} ({file_size} bytes, {content_type})")
                synced_count += 1
            else:
                try:
                    with open(local_path, 'rb') as f:
                        success = upload_object(s3_key, f, content_type=content_type)
                    if success:
                        self.stdout.write(self.style.SUCCESS(f"  Uploaded: {s3_key} ({file_size} bytes)"))
                        synced_count += 1
                    else:
                        self.stdout.write(self.style.ERROR(f"  Failed upload: {s3_key}"))
                        error_count += 1
                except Exception as exc:
                    self.stdout.write(self.style.ERROR(f"  Error uploading {s3_key}: {exc}"))
                    error_count += 1

        self.stdout.write(self.style.SUCCESS(
            f"\nSync complete! Processed {synced_count} file(s), {error_count} error(s)."
        ))
