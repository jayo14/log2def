import os
import re
import uuid
import zipfile
from html.parser import HTMLParser
from django.core.exceptions import ValidationError
from django.utils.text import get_valid_filename

# Magic byte signatures
MAGIC_SIGNATURES = {
    'pdf': [b'%PDF-'],
    'png': [b'\x89PNG\r\n\x1a\n'],
    'jpeg': [b'\xff\xd8\xff'],
    'docx': [b'PK\x03\x04', b'PK\x05\x06', b'PK\x07\x08'],
}

MAX_FILE_SIZE_BYTES = 15 * 1024 * 1024  # 15 MB


def get_safe_upload_filename(original_filename: str) -> str:
    """
    Generates a cryptographically randomized, sanitized filename
    preserving only valid, normalized extension. Prevents path traversal.
    """
    clean_name = get_valid_filename(os.path.basename(original_filename))
    ext = os.path.splitext(clean_name)[1].lower()
    safe_token = uuid.uuid4().hex
    return f"{safe_token}{ext}"


def validate_file_content(file_obj) -> str:
    """
    Inspects actual file bytes to detect the real file type,
    preventing extension spoofing (e.g., .exe or .sh renamed to .pdf).
    Returns verified type ('pdf', 'image', 'docx').
    Raises ValidationError if invalid or suspicious.
    """
    if file_obj.size > MAX_FILE_SIZE_BYTES:
        raise ValidationError(f"File size exceeds maximum permitted limit of 15MB.")

    pos = file_obj.tell()
    file_obj.seek(0)
    header = file_obj.read(32)
    file_obj.seek(pos)

    if not header:
        raise ValidationError("Uploaded file is empty.")

    # Check PDF
    if any(header.startswith(sig) for sig in MAGIC_SIGNATURES['pdf']):
        return 'pdf'

    # Check PNG
    if any(header.startswith(sig) for sig in MAGIC_SIGNATURES['png']):
        return 'image'

    # Check JPEG
    if any(header.startswith(sig) for sig in MAGIC_SIGNATURES['jpeg']):
        return 'image'

    # Check DOCX (Zip archive containing word/document.xml)
    if any(header.startswith(sig) for sig in MAGIC_SIGNATURES['docx']):
        try:
            file_obj.seek(0)
            with zipfile.ZipFile(file_obj, 'r') as zf:
                namelist = zf.namelist()
                if any(name.startswith('word/') for name in namelist):
                    return 'docx'
        except Exception:
            pass
        finally:
            file_obj.seek(pos)

    ext = os.path.splitext(file_obj.name)[1].lower()
    raise ValidationError(
        f"File content does not match allowed document types (PDF, JPG, PNG, DOCX). "
        f"Detected signature does not validate for extension '{ext}'."
    )


class HTMLSanitizer(HTMLParser):
    """
    Strict HTML sanitizer that strips scripts, iframes, styles, objects,
    and event handlers to prevent stored XSS attacks.
    """
    ALLOWED_TAGS = {
        'p', 'div', 'span', 'br', 'hr',
        'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
        'strong', 'b', 'em', 'i', 'u', 's', 'sub', 'sup',
        'ul', 'ol', 'li', 'blockquote',
        'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td'
    }

    ALLOWED_ATTRS = {'style', 'class', 'colspan', 'rowspan'}

    def __init__(self):
        super().__init__()
        self.result = []

    def handle_starttag(self, tag, attrs):
        if tag.lower() in self.ALLOWED_TAGS:
            clean_attrs = []
            for attr_name, attr_val in attrs:
                attr_lower = attr_name.lower()
                # Block event handlers (onclick, onload, etc.)
                if attr_lower.startswith('on'):
                    continue
                # Block javascript: pseudo-protocols
                if 'javascript:' in str(attr_val).lower():
                    continue
                if attr_lower in self.ALLOWED_ATTRS:
                    clean_attrs.append(f'{attr_name}="{attr_val}"')
            
            attrs_str = f" {' '.join(clean_attrs)}" if clean_attrs else ""
            self.result.append(f"<{tag}{attrs_str}>")

    def handle_endtag(self, tag):
        if tag.lower() in self.ALLOWED_TAGS:
            self.result.append(f"</{tag}>")

    def handle_data(self, data):
        self.result.append(data)

    def get_clean_html(self) -> str:
        return ''.join(self.result)


def sanitize_html(raw_html: str) -> str:
    """
    Sanitizes HTML content by stripping disallowed tags and dangerous attributes.
    """
    if not raw_html:
        return ""
    parser = HTMLSanitizer()
    parser.feed(raw_html)
    return parser.get_clean_html()


def wrap_untrusted_prompt_input(content: str, label: str = "STUDENT_UNTRUSTED_CONTENT") -> str:
    """
    Wraps untrusted student text inside strict boundary tags
    to prevent prompt injection and instruction overrides.
    """
    clean_content = content.replace("<<<", "").replace(">>>", "")
    return f"\n<<<{label}>>>\n{clean_content}\n<<<END_{label}>>>\n"


from rest_framework.throttling import ScopedRateThrottle


class AuthRateThrottle(ScopedRateThrottle):
    scope = 'auth'


class HeavyGenerationRateThrottle(ScopedRateThrottle):
    scope = 'heavy_generation'


class UploadRateThrottle(ScopedRateThrottle):
    scope = 'uploads'

