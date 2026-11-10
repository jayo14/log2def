import os
import mimetypes
from pathlib import Path
from typing import Dict, Any, Optional
import boto3
from botocore.config import Config
from botocore.exceptions import ClientError
from django.core.management.base import BaseCommand
from django.conf import settings
from api.storage import get_s3_client, get_bucket_name, get_public_url


class Command(BaseCommand):
    help = (
        "Safely migrates storage objects from Neon S3 bucket or local media cache "
        "to Rumpty Cloud S3 storage, preserving S3 keys, MIME types, and metadata."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            '--source-endpoint',
            default=os.getenv('NEON_S3_ENDPOINT', 'https://br-round-flower-b9xk5fgf.storage.c-7.eu-central-1.aws.neon.tech'),
            help='Source S3 endpoint URL (Neon storage).',
        )
        parser.add_argument(
            '--source-access-key',
            default=os.getenv('NEON_S3_ACCESS_KEY', 'nak_live_c1e62df314084e3eaf932d3c2337f217'),
            help='Source S3 Access Key ID.',
        )
        parser.add_argument(
            '--source-secret-key',
            default=os.getenv('NEON_S3_SECRET_KEY', 'nsk_live_62e7a217b6daacfc40e0fc855f570f472d7470a43e70e1aae457abe28e27ddac'),
            help='Source S3 Secret Access Key.',
        )
        parser.add_argument(
            '--source-bucket',
            default=os.getenv('NEON_S3_BUCKET', 'assets'),
            help='Source S3 bucket name (default: assets).',
        )
        parser.add_argument(
            '--source-dir',
            default=str(getattr(settings, 'MEDIA_ROOT', 'backend/media')),
            help='Local media directory fallback when Neon S3 endpoint is quota-blocked.',
        )
        parser.add_argument(
            '--target-bucket',
            default=None,
            help='Target S3 bucket name (defaults to settings.S3_BUCKET).',
        )
        parser.add_argument(
            '--prefix',
            default='',
            help='Filter or namespace objects by prefix.',
        )
        parser.add_argument(
            '--skip-existing',
            action='store_true',
            default=True,
            help='Skip uploading objects that already exist in target bucket to prevent tampering (default: True).',
        )
        parser.add_argument(
            '--force',
            action='store_true',
            help='Overwrite existing objects in target bucket.',
        )
        parser.add_argument(
            '--dry-run',
            action='store_true',
            help='Simulate migration without uploading to target bucket.',
        )

    def handle(self, *args, **options):
        dry_run = options.get('dry_run', False)
        skip_existing = not options.get('force') and options.get('skip_existing', True)
        prefix = options.get('prefix', '').strip('/')

        target_bucket = options.get('target_bucket') or get_bucket_name()
        target_s3 = get_s3_client()

        self.stdout.write(self.style.MIGRATE_HEADING("Safe S3 Storage Asset Migration"))
        self.stdout.write(f"Target Bucket:   {target_bucket}")
        self.stdout.write(f"Skip Existing:   {skip_existing}")
        self.stdout.write(f"Dry Run Mode:    {dry_run}\n")

        if not target_s3 and not dry_run:
            self.stderr.write(self.style.ERROR(
                "Target S3 client could not be initialized. Please check AWS_ACCESS_KEY_ID "
                "and AWS_SECRET_ACCESS_KEY in backend/.env."
            ))
            return

        # Attempt to connect to Source Neon S3
        source_endpoint = options.get('source_endpoint')
        source_ak = options.get('source_access_key')
        source_sk = options.get('source_secret_key')
        source_bucket = options.get('source_bucket')

        source_s3 = None
        source_online = False

        if source_endpoint and source_ak and source_sk:
            try:
                source_s3 = boto3.client(
                    's3',
                    endpoint_url=source_endpoint,
                    aws_access_key_id=source_ak,
                    aws_secret_access_key=source_sk,
                    config=Config(s3={'addressing_style': 'path'}, connect_timeout=5, retries={'max_attempts': 1})
                )
                # Test connectivity
                source_s3.list_objects_v2(Bucket=source_bucket, MaxKeys=1)
                source_online = True
                self.stdout.write(self.style.SUCCESS(f"Connected to Neon Source S3 bucket '{source_bucket}'."))
            except Exception as e:
                self.stdout.write(self.style.WARNING(
                    f"Neon Source S3 bucket is unavailable or quota-locked: {e}\n"
                    f"Falling back to local cached media directory."
                ))

        transferred = 0
        skipped = 0
        errors = 0

        if source_online and source_s3:
            # Migrate directly from Neon S3 bucket
            self.stdout.write(self.style.MIGRATE_LABEL("\nStreaming objects from Neon S3 bucket..."))
            paginator = source_s3.get_paginator('list_objects_v2')
            page_kwargs = {'Bucket': source_bucket}
            if prefix:
                page_kwargs['Prefix'] = prefix

            for page in paginator.paginate(**page_kwargs):
                for obj in page.get('Contents', []):
                    key = obj['Key']
                    size = obj['Size']

                    # Check if already in target
                    if skip_existing and not dry_run and target_s3:
                        try:
                            target_s3.head_object(Bucket=target_bucket, Key=key)
                            self.stdout.write(f"  [EXISTS] {key} (preserving target, skipped)")
                            skipped += 1
                            continue
                        except ClientError as ce:
                            if ce.response.get('Error', {}).get('Code') != '404':
                                pass

                    if dry_run:
                        self.stdout.write(f"  [DRY-RUN] Would migrate S3 object: {key} ({size} bytes)")
                        transferred += 1
                        continue

                    try:
                        # Stream object and preserve content type / metadata
                        resp = source_s3.get_object(Bucket=source_bucket, Key=key)
                        body = resp['Body'].read()
                        content_type = resp.get('ContentType') or mimetypes.guess_type(key)[0] or 'application/octet-stream'
                        metadata = resp.get('Metadata', {})

                        put_params: Dict[str, Any] = {
                            'Bucket': target_bucket,
                            'Key': key,
                            'Body': body,
                            'ContentType': content_type,
                        }
                        if metadata:
                            put_params['Metadata'] = metadata

                        target_s3.put_object(**put_params)
                        transferred += 1
                        public_url = get_public_url(key)
                        self.stdout.write(self.style.SUCCESS(f"  Copied: {key} -> {public_url}"))
                    except Exception as exc:
                        self.stdout.write(self.style.ERROR(f"  Error copying {key}: {exc}"))
                        errors += 1

        # Local directory sync (ensures all local files are also present in target bucket)
        local_dir = Path(options.get('source_dir')).resolve()
        if local_dir.exists():
            self.stdout.write(self.style.MIGRATE_LABEL(f"\nSyncing local cached media from '{local_dir}'..."))
            local_files = [p for p in local_dir.rglob('*') if p.is_file()]

            for path in local_files:
                rel_path = path.relative_to(local_dir).as_posix()
                key = f"{prefix}/{rel_path}".lstrip('/') if prefix else rel_path
                size = path.stat().st_size
                content_type, _ = mimetypes.guess_type(str(path))
                content_type = content_type or 'application/octet-stream'

                if skip_existing and not dry_run and target_s3:
                    try:
                        target_s3.head_object(Bucket=target_bucket, Key=key)
                        self.stdout.write(f"  [EXISTS] {key} (preserving target, skipped)")
                        skipped += 1
                        continue
                    except ClientError as ce:
                        if ce.response.get('Error', {}).get('Code') != '404':
                            pass

                if dry_run:
                    self.stdout.write(f"  [DRY-RUN] Would upload local file: {key} ({size} bytes, {content_type})")
                    transferred += 1
                    continue

                try:
                    with open(path, 'rb') as f:
                        target_s3.put_object(
                            Bucket=target_bucket,
                            Key=key,
                            Body=f.read(),
                            ContentType=content_type,
                        )
                    transferred += 1
                    public_url = get_public_url(key)
                    self.stdout.write(self.style.SUCCESS(f"  Uploaded local file: {key} -> {public_url}"))
                except Exception as exc:
                    self.stdout.write(self.style.ERROR(f"  Error uploading {key}: {exc}"))
                    errors += 1

        self.stdout.write(self.style.SUCCESS(
            f"\nStorage Migration Complete! Transferred: {transferred}, Skipped: {skipped}, Errors: {errors}"
        ))
