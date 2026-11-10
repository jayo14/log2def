import os
import boto3
from botocore.config import Config
from boto3.s3.transfer import TransferConfig

# High-speed multi-threaded multipart transfer configuration (supports 500MB+ files)
S3_MULTIPART_CONFIG = TransferConfig(
    multipart_threshold=8 * 1024 * 1024,  # 8 MB
    max_concurrency=10,
    multipart_chunksize=8 * 1024 * 1024,   # 8 MB chunks
    use_threads=True,
)
from django.conf import settings
import logging

logger = logging.getLogger(__name__)

def _get_setting(name: str, default=None):
    """
    Safely retrieve a setting from Django settings if configured,
    otherwise falling back to environment variable or default.
    """
    if settings.configured:
        val = getattr(settings, name, None)
        if val is not None and val != '':
            return val
    return os.getenv(name, default)

def get_s3_client():
    """
    Returns an S3 client configured for Object Storage (Rumpty Cloud / Neon / AWS).
    Uses AWS_ENDPOINT_URL_S3, AWS_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY.
    """
    endpoint = _get_setting('AWS_ENDPOINT_URL_S3')
    region = _get_setting('AWS_REGION', 'olas-closet')
    access_key = _get_setting('AWS_ACCESS_KEY_ID')
    secret_key = _get_setting('AWS_SECRET_ACCESS_KEY')

    if not (access_key and secret_key):
        return None

    return boto3.client(
        's3',
        endpoint_url=endpoint,
        region_name=region,
        aws_access_key_id=access_key,
        aws_secret_access_key=secret_key,
        config=Config(s3={'addressing_style': 'path'})
    )

def get_bucket_name():
    return _get_setting('S3_BUCKET', 'assets-mika-01a0f86f-84afac')

def get_public_url(key: str) -> str:
    """
    Returns public URL for an asset key if a public URL prefix is configured.
    """
    public_url_base = _get_setting('S3_PUBLIC_URL', '')
    if public_url_base:
        return f"{public_url_base.rstrip('/')}/{key.lstrip('/')}"
    return get_presigned_url(key)

def upload_object(key: str, body, content_type: str = None) -> bool:
    """
    Uploads a file body (file path, file-like object, bytes, or string) to S3.
    Uses multi-threaded multipart transfers for high-speed streaming on large files (500MB+).
    """
    s3 = get_s3_client()
    if not s3:
        return False
    
    bucket = get_bucket_name()
    extra_args = {}
    if content_type:
        extra_args['ContentType'] = content_type

    try:
        # If body is a filepath on disk, stream directly via high-speed multipart upload
        if isinstance(body, (str, os.PathLike)) and os.path.isfile(str(body)):
            s3.upload_file(str(body), bucket, key, ExtraArgs=extra_args or None, Config=S3_MULTIPART_CONFIG)
            return True
        elif hasattr(body, 'read'):
            s3.upload_fileobj(body, bucket, key, ExtraArgs=extra_args or None, Config=S3_MULTIPART_CONFIG)
            return True
        else:
            params = {
                'Bucket': bucket,
                'Key': key,
                'Body': body
            }
            if content_type:
                params['ContentType'] = content_type
            s3.put_object(**params)
            return True
    except Exception as e:
        logger.error(f"Error uploading object {key} to {bucket}: {e}")
        return False

def get_presigned_url(key: str, expires_in: int = 3600) -> str:
    """
    Generates a presigned URL to view/download an object from the S3 bucket.
    Falls back to public asset URL if presigning is unavailable.
    """
    public_url_base = _get_setting('S3_PUBLIC_URL', '')
    s3 = get_s3_client()
    if not s3:
        if public_url_base:
            return f"{public_url_base.rstrip('/')}/{key.lstrip('/')}"
        return None
        
    bucket = get_bucket_name()
    try:
        return s3.generate_presigned_url(
            'get_object',
            Params={'Bucket': bucket, 'Key': key},
            ExpiresIn=expires_in
        )
    except Exception as e:
        logger.error(f"Error generating presigned URL for {key}: {e}")
        if public_url_base:
            return f"{public_url_base.rstrip('/')}/{key.lstrip('/')}"
        return None

def download_object(key: str) -> bytes | None:
    """
    Downloads an object from the S3 bucket as bytes.
    """
    s3 = get_s3_client()
    if not s3:
        return None
    bucket = get_bucket_name()
    try:
        resp = s3.get_object(Bucket=bucket, Key=key)
        return resp['Body'].read()
    except Exception as e:
        logger.error(f"Error downloading object {key} from {bucket}: {e}")
        return None

def delete_object(key: str) -> bool:
    """
    Deletes an object from the S3 bucket.
    """
    s3 = get_s3_client()
    if not s3:
        return False
    bucket = get_bucket_name()
    try:
        s3.delete_object(Bucket=bucket, Key=key)
        return True
    except Exception as e:
        logger.error(f"Error deleting object {key} from {bucket}: {e}")
        return False
