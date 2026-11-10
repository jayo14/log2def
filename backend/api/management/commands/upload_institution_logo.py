import os
import mimetypes
from pathlib import Path
from django.core.management.base import BaseCommand
from django.conf import settings
from api.templates import get_template_spec, resolve_institution_logo_path
from api.storage import get_bucket_name, get_public_url
import boto3
from botocore.config import Config


class Command(BaseCommand):
    help = "Uploads the LASUSTECH institution logo to Rumpty Cloud S3 storage."

    def add_arguments(self, parser):
        parser.add_argument(
            '--institution',
            default='lasustech',
            help='Institution code (default: lasustech)',
        )
        parser.add_argument(
            '--access-key',
            default=None,
            help='Override S3 Access Key ID',
        )
        parser.add_argument(
            '--secret-key',
            default=None,
            help='Override S3 Secret Access Key',
        )

    def handle(self, *args, **options):
        inst_code = options.get('institution', 'lasustech')
        spec = get_template_spec(code=inst_code, version="2.0.0")
        logo_path = resolve_institution_logo_path(spec)

        if not logo_path or not logo_path.exists():
            self.stderr.write(self.style.ERROR(f"Could not locate logo asset on disk for {inst_code}."))
            return

        self.stdout.write(self.style.SUCCESS(f"Located local logo asset: {logo_path} ({logo_path.stat().st_size} bytes)"))

        endpoint = getattr(settings, 'AWS_ENDPOINT_URL_S3', 'https://s3.rumptycloud.com')
        region = getattr(settings, 'AWS_REGION', 'olas-closet')
        bucket = get_bucket_name()

        access_key = options.get('access_key') or getattr(settings, 'AWS_ACCESS_KEY_ID', None) or os.getenv('AWS_ACCESS_KEY_ID')
        secret_key = options.get('secret_key') or getattr(settings, 'AWS_SECRET_ACCESS_KEY', None) or os.getenv('AWS_SECRET_ACCESS_KEY')

        if not access_key or not secret_key or "YOUR_RUMPTY" in str(secret_key) or access_key == "production-uploader":
            self.stderr.write(self.style.WARNING(
                "S3 credentials in backend/.env are currently placeholder/incomplete.\n"
                f"  Endpoint: {endpoint}\n"
                f"  Region:   {region}\n"
                f"  Bucket:   {bucket}\n"
                "Please update AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY in backend/.env with your "
                "generated access key from Rumpty Cloud dashboard (Buckets -> Access keys -> Create)."
            ))
            return

        s3 = boto3.client(
            's3',
            endpoint_url=endpoint,
            region_name=region,
            aws_access_key_id=access_key,
            aws_secret_access_key=secret_key,
            config=Config(s3={'addressing_style': 'path'})
        )

        # Upload files in the institution folder
        inst_dir = logo_path.parent
        files_to_upload = list(inst_dir.glob('*.png'))

        for file_path in files_to_upload:
            mime_type, _ = mimetypes.guess_type(str(file_path))
            content_type = mime_type or 'image/png'
            with open(file_path, 'rb') as f:
                data = f.read()

            for key in [
                f"assets/institutions/{inst_code}/{file_path.name}",
                f"institutions/{inst_code}/{file_path.name}",
            ]:
                try:
                    s3.put_object(
                        Bucket=bucket,
                        Key=key,
                        Body=data,
                        ContentType=content_type,
                        ACL='public-read',
                    )
                    public_url = get_public_url(key)
                    self.stdout.write(self.style.SUCCESS(f"Uploaded: s3://{bucket}/{key}"))
                    self.stdout.write(f"  Public URL: {public_url}")
                except Exception as e:
                    self.stderr.write(self.style.ERROR(f"Failed to upload {key}: {e}"))
