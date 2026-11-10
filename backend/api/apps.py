import os
import sys
import logging
from pathlib import Path
from django.apps import AppConfig

logger = logging.getLogger(__name__)


class ApiConfig(AppConfig):
    name = 'api'

    def ready(self):
        # Startup / CI check: ensure the institution logo asset is present
        from .templates import get_template_spec, resolve_institution_logo_path
        spec = get_template_spec(code="lasustech", version="2.0.0")
        logo_path = resolve_institution_logo_path(spec)
        if not logo_path or not logo_path.exists():
            msg = f"CRITICAL: Institution logo asset missing. Cover page generation will fail."
            logger.error(msg)
            # If CI or REQUIRE_REPORT_LOGO is set, fail startup
            if os.environ.get("CI", "").lower() in {"1", "true", "yes"} or os.environ.get("REQUIRE_REPORT_LOGO", "").lower() in {"1", "true", "yes"}:
                raise FileNotFoundError(msg)
        else:
            logger.info("Verified institution logo asset at %s", logo_path)

