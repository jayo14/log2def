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
        project_root = Path(__file__).resolve().parent.parent.parent
        logo_path = project_root / 'assets' / 'institutions' / 'lasustech' / 'logo.png'
        if not logo_path.exists():
            msg = f"CRITICAL: Institution logo asset missing at {logo_path}. Cover page generation will fail."
            logger.error(msg)
            # If CI or REQUIRE_REPORT_LOGO is set, fail startup
            if os.environ.get("CI", "").lower() in {"1", "true", "yes"} or os.environ.get("REQUIRE_REPORT_LOGO", "").lower() in {"1", "true", "yes"}:
                raise FileNotFoundError(msg)

