import os
import boto3
from botocore.config import Config
from django.conf import settings

def get_s3_client():
    """
    Returns an S3 client configured for Neon Object Storage.
    Uses AWS_ENDPOINT_URL_S3, AWS_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY.
    """
    endpoint = getattr(settings, 'AWS_ENDPOINT_URL_S3', None) or os.getenv('AWS_ENDPOINT_URL_S3')
    region = getattr(settings, 'AWS_REGION', 'eu-central-1') or os.getenv('AWS_REGION', 'eu-central-1')
    access_key = getattr(settings, 'AWS_ACCESS_KEY_ID', None) or os.getenv('AWS_ACCESS_KEY_ID')
    secret_key = getattr(settings, 'AWS_SECRET_ACCESS_KEY', None) or os.getenv('AWS_SECRET_ACCESS_KEY')

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
    return getattr(settings, 'S3_BUCKET', 'assets') or os.getenv('S3_BUCKET', 'assets')

def upload_object(key: str, body, content_type: str = None) -> bool:
    """
    Uploads a file body (bytes, string, or file-like object) to the Neon S3 bucket.
    """
    s3 = get_s3_client()
    if not s3:
        return False
    
    bucket = get_bucket_name()
    params = {
        'Bucket': bucket,
        'Key': key,
        'Body': body
    }
    if content_type:
        params['ContentType'] = content_type
        
    s3.put_object(**params)
    return True

def get_presigned_url(key: str, expires_in: int = 3600) -> str:
    """
    Generates a presigned URL to view/download an object from the S3 bucket.
    """
    s3 = get_s3_client()
    if not s3:
        return None
        
    bucket = get_bucket_name()
    return s3.generate_presigned_url(
        'get_object',
        Params={'Bucket': bucket, 'Key': key},
        ExpiresIn=expires_in
    )
