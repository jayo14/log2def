import os
from pathlib import Path
from datetime import timedelta
from dotenv import load_dotenv

# Build paths inside the project: BASE_DIR is backend directory
BASE_DIR = Path(__file__).resolve().parent.parent

# Load .env file from backend or root
load_dotenv(BASE_DIR / '.env')
load_dotenv(BASE_DIR.parent / '.env')

SECRET_KEY = os.getenv(
    'DJANGO_SECRET_KEY',
    'django-insecure-log2def-production-key-change-in-production-19827391'
)

DEBUG = os.getenv('DJANGO_DEBUG', 'True').lower() in ('true', '1', 'yes')

ALLOWED_HOSTS = os.getenv('DJANGO_ALLOWED_HOSTS', 'localhost,127.0.0.1,0.0.0.0').split(',')

INSTALLED_APPS = [
    'django.contrib.admin',
    'django.contrib.auth',
    'django.contrib.contenttypes',
    'django.contrib.sessions',
    'django.contrib.messages',
    'django.contrib.staticfiles',
    # Third-party apps
    'corsheaders',
    'rest_framework',
    'rest_framework_simplejwt',
    'drf_spectacular',
    # Local apps
    'api',
]

MIDDLEWARE = [
    'corsheaders.middleware.CorsMiddleware',
    'django.middleware.security.SecurityMiddleware',
    'whitenoise.middleware.WhiteNoiseMiddleware',
    'django.contrib.sessions.middleware.SessionMiddleware',
    'django.middleware.common.CommonMiddleware',
    'django.middleware.csrf.CsrfViewMiddleware',
    'django.contrib.auth.middleware.AuthenticationMiddleware',
    'django.contrib.messages.middleware.MessageMiddleware',
    'django.middleware.clickjacking.XFrameOptionsMiddleware',
]

ROOT_URLCONF = 'core.urls'

TEMPLATES = [
    {
        'BACKEND': 'django.template.backends.django.DjangoTemplates',
        'DIRS': [],
        'APP_DIRS': True,
        'OPTIONS': {
            'context_processors': [
                'django.template.context_processors.request',
                'django.contrib.auth.context_processors.auth',
                'django.contrib.messages.context_processors.messages',
            ],
        },
    },
]

WSGI_APPLICATION = 'core.wsgi.application'

# Database configuration: support DATABASE_URL, PostgreSQL, and SQLite fallback
import sys

is_migration_command = any(cmd in sys.argv for cmd in ['migrate', 'makemigrations', 'showmigrations', 'sqlmigrate'])

if is_migration_command:
    DATABASE_URL = os.getenv('DATABASE_URL_UNPOOLED') or os.getenv('DATABASE_URL', '').strip()
else:
    DATABASE_URL = os.getenv('DATABASE_URL_POOLED') or os.getenv('DATABASE_URL', '').strip()

DB_ENGINE = os.getenv('DB_ENGINE', 'postgres' if DATABASE_URL else 'sqlite').strip().lower()

if DATABASE_URL:
    import urllib.parse as urlparse
    url = urlparse.urlparse(DATABASE_URL)
    query_params = dict(urlparse.parse_qsl(url.query))
    
    db_options = {}
    if 'sslmode' in query_params:
        db_options['sslmode'] = query_params['sslmode']
    elif 'neon.tech' in (url.hostname or ''):
        db_options['sslmode'] = 'require'
        
    if 'channel_binding' in query_params:
        db_options['channel_binding'] = query_params['channel_binding']

    DATABASES = {
        'default': {
            'ENGINE': 'django.db.backends.postgresql',
            'NAME': url.path[1:] if url.path.startswith('/') else url.path,
            'USER': url.username or '',
            'PASSWORD': url.password or '',
            'HOST': url.hostname or '',
            'PORT': url.port or 5432,
            'OPTIONS': db_options,
        }
    }
elif DB_ENGINE == 'postgres' and os.getenv('DB_NAME'):
    DATABASES = {
        'default': {
            'ENGINE': 'django.db.backends.postgresql',
            'NAME': os.getenv('DB_NAME'),
            'USER': os.getenv('DB_USER', 'postgres'),
            'PASSWORD': os.getenv('DB_PASSWORD', ''),
            'HOST': os.getenv('DB_HOST', 'localhost'),
            'PORT': os.getenv('DB_PORT', '5432'),
        }
    }
else:
    DATABASES = {
        'default': {
            'ENGINE': 'django.db.backends.sqlite3',
            'NAME': BASE_DIR / 'db.sqlite3',
        }
    }

AUTH_PASSWORD_VALIDATORS = [
    {
        'NAME': 'django.contrib.auth.password_validation.MinimumLengthValidator',
        'OPTIONS': {'min_length': 8},
    },
    {
        'NAME': 'django.contrib.auth.password_validation.CommonPasswordValidator',
    },
    {
        'NAME': 'django.contrib.auth.password_validation.NumericPasswordValidator',
    },
]

LANGUAGE_CODE = 'en-us'
TIME_ZONE = 'Africa/Lagos'
USE_I18N = True
USE_TZ = True

STATIC_URL = '/static/'
STATIC_ROOT = BASE_DIR / 'staticfiles'
STATICFILES_STORAGE = 'whitenoise.storage.CompressedManifestStaticFilesStorage'

MEDIA_URL = '/media/'
MEDIA_ROOT = BASE_DIR / 'media'

DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'

# REST Framework Configuration
REST_FRAMEWORK = {
    'DEFAULT_AUTHENTICATION_CLASSES': (
        'rest_framework_simplejwt.authentication.JWTAuthentication',
        'rest_framework.authentication.SessionAuthentication',
    ),
    'DEFAULT_PERMISSION_CLASSES': (
        'rest_framework.permissions.IsAuthenticated',
    ),
    'DEFAULT_PARSER_CLASSES': (
        'rest_framework.parsers.JSONParser',
        'rest_framework.parsers.FormParser',
        'rest_framework.parsers.MultiPartParser',
    ),
    'DEFAULT_THROTTLE_CLASSES': (
        'rest_framework.throttling.AnonRateThrottle',
        'rest_framework.throttling.UserRateThrottle',
    ),
    'DEFAULT_THROTTLE_RATES': {
        'anon': '120/minute',
        'user': '2000/day',
        'auth': '30/minute',
        'heavy_generation': '60/minute',
        'uploads': '120/minute',
    },
    'DEFAULT_SCHEMA_CLASS': 'drf_spectacular.openapi.AutoSchema',
}


# Spectacular OpenAPI / Swagger Settings
SPECTACULAR_SETTINGS = {
    'TITLE': 'Log2Def API',
    'DESCRIPTION': 'AI-powered SIWES Logbook-to-Defence Platform REST API for LASUSTECH and Nigerian institutions.',
    'VERSION': '1.0.0',
    'SERVE_INCLUDE_SCHEMA': False,
    'COMPONENT_SPLIT_REQUEST': True,
    'ENUM_NAME_OVERRIDES': {
        'ProjectStatusEnum': 'api.models.ReportProject.STATUS_CHOICES',
        'DocumentTypeEnum': 'api.models.SourceDocument.TYPE_CHOICES',
        'DocumentStatusEnum': 'api.models.SourceDocument.STATUS_CHOICES',
        'PageStatusEnum': 'api.models.ExtractedPage.STATUS_CHOICES',
        'DefenceCategoryEnum': 'api.models.DefenceQuestion.CATEGORY_CHOICES',
        'MasteryStatusEnum': 'api.models.DefenceQuestion.MASTERY_CHOICES',
    },
}

# SimpleJWT Settings
SIMPLE_JWT = {
    'ACCESS_TOKEN_LIFETIME': timedelta(days=7),
    'REFRESH_TOKEN_LIFETIME': timedelta(days=30),
    'ROTATE_REFRESH_TOKENS': False,
    'ALGORITHM': 'HS256',
    'SIGNING_KEY': SECRET_KEY,
    'AUTH_HEADER_TYPES': ('Bearer',),
}

# CORS Configuration
CORS_ALLOW_ALL_ORIGINS = True
CORS_ALLOW_CREDENTIALS = True
CORS_ALLOWED_ORIGIN_REGEXES = [
    r"^http://localhost:\d+$",
    r"^http://127\.0\.0\.1:\d+$",
]

# AI Provider Configuration
AI_PROVIDER = os.getenv('AI_PROVIDER', 'gemini')
AI_API_KEY = os.getenv('AI_API_KEY', '')
AI_MODEL = os.getenv('AI_MODEL', 'gpt-4o-mini')
AI_BASE_URL = os.getenv('AI_BASE_URL', '')

# Google Gemini Flash Configuration
GEMINI_API_KEY = os.getenv('GEMINI_API_KEY', os.getenv('AI_API_KEY', ''))
GEMINI_MODEL = os.getenv('GEMINI_MODEL', 'gemini-2.0-flash')

# External binary configuration (LibreOffice for PDF exports & Tesseract for OCR)
import shutil
LIBREOFFICE_PATH = os.getenv('LIBREOFFICE_PATH') or shutil.which('libreoffice') or '/usr/bin/libreoffice'
TESSERACT_CMD = os.getenv('TESSERACT_CMD') or shutil.which('tesseract') or '/usr/bin/tesseract'

# File Upload Limits (15MB)
MAX_UPLOAD_SIZE_BYTES = 15 * 1024 * 1024

# Reverse Proxy & Cloud Deployment Headers (Render, Railway, Fly, Heroku, AWS)
SECURE_PROXY_SSL_HEADER = ('HTTP_X_FORWARDED_PROTO', 'https')
USE_X_FORWARDED_HOST = True
USE_X_FORWARDED_PORT = True

CSRF_TRUSTED_ORIGINS_RAW = os.getenv('CSRF_TRUSTED_ORIGINS', '')
if CSRF_TRUSTED_ORIGINS_RAW:
    CSRF_TRUSTED_ORIGINS = [origin.strip() for origin in CSRF_TRUSTED_ORIGINS_RAW.split(',') if origin.strip()]
else:
    CSRF_TRUSTED_ORIGINS = [
        'http://localhost:3000',
        'http://127.0.0.1:3000',
        'http://localhost:8000',
        'http://127.0.0.1:8000',
        'https://*.onrender.com',
        'https://*.railway.app',
        'https://*.fly.dev',
    ]

# Security Hardening & Headers
SECURE_BROWSER_XSS_FILTER = True
SECURE_CONTENT_TYPE_NOSNIFF = True
X_FRAME_OPTIONS = 'DENY'

if not DEBUG:
    CSRF_COOKIE_SECURE = True
    SESSION_COOKIE_SECURE = True
    SECURE_SSL_REDIRECT = os.getenv('DJANGO_SECURE_SSL_REDIRECT', 'False').lower() in ('true', '1')
    if 'insecure' in SECRET_KEY:
        raise RuntimeError("DJANGO_SECRET_KEY must be configured with a secure secret in production mode.")

# Neon Object Storage (S3-compatible) Configuration
AWS_ENDPOINT_URL_S3 = os.getenv('AWS_ENDPOINT_URL_S3', '').strip()
AWS_ACCESS_KEY_ID = os.getenv('AWS_ACCESS_KEY_ID', '').strip()
AWS_SECRET_ACCESS_KEY = os.getenv('AWS_SECRET_ACCESS_KEY', '').strip()
AWS_REGION = os.getenv('AWS_REGION', 'eu-central-1').strip()
S3_BUCKET = os.getenv('S3_BUCKET', 'assets').strip()


