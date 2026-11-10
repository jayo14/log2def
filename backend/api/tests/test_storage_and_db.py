import os
from io import StringIO
from unittest.mock import patch, MagicMock
import django
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'core.settings')
django.setup()
from django.test import TestCase, override_settings
from django.core.management import call_command
from api.storage import (
    _get_setting,
    get_bucket_name,
    get_public_url,
    get_presigned_url,
    upload_object,
    download_object,
    delete_object,
)


class StorageAndDatabaseTests(TestCase):
    def test_get_setting_fallback(self):
        val = _get_setting('NON_EXISTENT_KEY_12345', 'default_val')
        self.assertEqual(val, 'default_val')

    @override_settings(S3_BUCKET='test-rumpty-bucket')
    def test_get_bucket_name_from_settings(self):
        self.assertEqual(get_bucket_name(), 'test-rumpty-bucket')

    @override_settings(S3_PUBLIC_URL='https://assets.rumptycloud.app/projects/test-proj/test-bucket')
    def test_get_public_url_with_prefix(self):
        url = get_public_url('reports/siwes_report.pdf')
        expected = 'https://assets.rumptycloud.app/projects/test-proj/test-bucket/reports/siwes_report.pdf'
        self.assertEqual(url, expected)

    @override_settings(S3_PUBLIC_URL='')
    @patch('api.storage.get_s3_client')
    def test_get_presigned_url_fallback(self, mock_client):
        mock_s3 = MagicMock()
        mock_s3.generate_presigned_url.return_value = 'https://s3.rumptycloud.com/presigned'
        mock_client.return_value = mock_s3

        url = get_presigned_url('test.pdf')
        self.assertEqual(url, 'https://s3.rumptycloud.com/presigned')
        mock_s3.generate_presigned_url.assert_called_once()

    @patch('api.storage.get_s3_client')
    def test_upload_object_success(self, mock_client):
        mock_s3 = MagicMock()
        mock_client.return_value = mock_s3

        res = upload_object('key.txt', b'content', content_type='text/plain')
        self.assertTrue(res)
        mock_s3.put_object.assert_called_once()

    @patch('api.storage.get_s3_client')
    def test_download_object_success(self, mock_client):
        mock_s3 = MagicMock()
        mock_body = MagicMock()
        mock_body.read.return_value = b'downloaded data'
        mock_s3.get_object.return_value = {'Body': mock_body}
        mock_client.return_value = mock_s3

        data = download_object('key.txt')
        self.assertEqual(data, b'downloaded data')

    @patch('api.storage.get_s3_client')
    def test_delete_object_success(self, mock_client):
        mock_s3 = MagicMock()
        mock_client.return_value = mock_s3

        res = delete_object('key.txt')
        self.assertTrue(res)
        mock_s3.delete_object.assert_called_once()

    def test_check_storage_command(self):
        out = StringIO()
        call_command('check_storage', stdout=out)
        output = out.getvalue()
        self.assertIn('Diagnosing S3 Object Storage Configuration', output)
        self.assertIn('Endpoint:', output)
        self.assertIn('Bucket:', output)

    def test_sync_storage_assets_dry_run(self):
        out = StringIO()
        call_command('sync_storage_assets', '--dry-run', stdout=out)
        output = out.getvalue()
        self.assertIn('Syncing media assets', output)
        self.assertIn('Sync complete', output)
