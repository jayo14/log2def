import os
import uuid
from django.core.management.base import BaseCommand
from django.conf import settings
from api.storage import (
    get_s3_client,
    get_bucket_name,
    get_public_url,
    get_presigned_url,
    upload_object,
    download_object,
    delete_object,
    _get_setting,
)


class Command(BaseCommand):
    help = "Diagnoses S3 Object Storage connectivity, credentials, bucket access, and URL generation."

    def add_arguments(self, parser):
        parser.add_argument(
            '--test-rw',
            action='store_true',
            help='Perform a non-destructive read/write/delete test object check.',
        )

    def handle(self, *args, **options):
        self.stdout.write(self.style.MIGRATE_HEADING("Diagnosing S3 Object Storage Configuration..."))

        endpoint = _get_setting('AWS_ENDPOINT_URL_S3')
        region = _get_setting('AWS_REGION')
        bucket = get_bucket_name()
        access_key = _get_setting('AWS_ACCESS_KEY_ID')
        public_url_base = _get_setting('S3_PUBLIC_URL')

        self.stdout.write(f"  Endpoint:        {endpoint or 'Not configured'}")
        self.stdout.write(f"  Region:          {region or 'Not configured'}")
        self.stdout.write(f"  Bucket:          {bucket}")
        self.stdout.write(f"  Access Key ID:   {'Configured' if access_key else 'Missing'}")
        self.stdout.write(f"  Public URL Base: {public_url_base or 'Not configured'}")

        sample_key = "test/sample-asset.pdf"
        self.stdout.write(f"  Sample Public URL:    {get_public_url(sample_key)}")
        self.stdout.write(f"  Sample Presigned URL: {get_presigned_url(sample_key)}")

        s3 = get_s3_client()
        if not s3:
            self.stdout.write(self.style.WARNING(
                "\nS3 client could not be initialized because access keys are missing or placeholder. "
                "Update AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY in backend/.env to enable live uploads."
            ))
            return

        self.stdout.write(self.style.MIGRATE_LABEL("\nTesting S3 Connectivity..."))
        try:
            resp = s3.list_objects_v2(Bucket=bucket, MaxKeys=5)
            contents = resp.get('Contents', [])
            self.stdout.write(self.style.SUCCESS(f"Successfully connected to bucket '{bucket}'!"))
            self.stdout.write(f"  Found {len(contents)} item(s) in initial listing.")
            for obj in contents:
                self.stdout.write(f"    - {obj['Key']} ({obj['Size']} bytes)")
        except Exception as exc:
            self.stdout.write(self.style.ERROR(f"Failed to list objects in bucket '{bucket}': {exc}"))

        if options['test_rw']:
            test_key = f"__healthcheck__/{uuid.uuid4().hex}.txt"
            test_content = b"healthcheck ok"
            self.stdout.write(f"\nAttempting write test with key '{test_key}'...")
            try:
                uploaded = upload_object(test_key, test_content, content_type="text/plain")
                if uploaded:
                    self.stdout.write(self.style.SUCCESS("  Write test succeeded."))
                    downloaded = download_object(test_key)
                    if downloaded == test_content:
                        self.stdout.write(self.style.SUCCESS("  Read test succeeded."))
                    else:
                        self.stdout.write(self.style.WARNING("  Read test returned unexpected content."))
                    deleted = delete_object(test_key)
                    if deleted:
                        self.stdout.write(self.style.SUCCESS("  Delete test succeeded."))
                    else:
                        self.stdout.write(self.style.WARNING("  Delete test failed."))
                else:
                    self.stdout.write(self.style.ERROR("  Write test failed."))
            except Exception as e:
                self.stdout.write(self.style.ERROR(f"  Read/write test failed: {e}"))
