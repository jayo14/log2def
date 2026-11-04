import os
from typing import Dict
from functools import wraps
from rest_framework.exceptions import NotFound, PermissionDenied
from rest_framework.permissions import BasePermission
from django.http import Http404

# Default feature flags defined in docs/MVP_SCOPE.md section 4
DEFAULT_FEATURE_FLAGS: Dict[str, bool] = {
    # Core MVP Capabilities (Default: ON)
    "logbook_camera_capture": True,
    "logbook_bulk_upload": True,
    "logbook_pdf_upload": True,
    "logbook_image_processing": True,
    "ocr_extraction": True,
    "ai_logbook_structuring": True,
    "missing_information_collection": True,
    "report_generation": True,
    "report_editor": True,
    "report_preview": True,
    "report_docx_export": True,
    "report_pdf_export": True,
    "report_quality_validation": True,

    # Out-of-Scope Capabilities (Default: OFF)
    "defence_preparation": False,
    "slide_generation": False,
    "payment_processing": False,
    "print_fulfilment": False,
    "delivery_management": False,
    "supervisor_portal": False,
    "institution_management": False,
    "advanced_analytics": False,
    "ai_chat_assistant": False,
}


def is_feature_enabled(flag_name: str) -> bool:
    """
    Checks if a given feature flag is active.
    Permits overriding via environment variable:
    LOG2DEF_FLAG_<NAME_IN_UPPERCASE> or FEATURE_FLAG_<NAME_IN_UPPERCASE>.
    """
    if flag_name not in DEFAULT_FEATURE_FLAGS:
        return False

    default_value = DEFAULT_FEATURE_FLAGS[flag_name]
    env_key_1 = f"LOG2DEF_FLAG_{flag_name.upper()}"
    env_key_2 = f"FEATURE_FLAG_{flag_name.upper()}"

    env_val = os.getenv(env_key_1, os.getenv(env_key_2, None))
    if env_val is not None:
        return env_val.strip().lower() in ("true", "1", "yes", "on", "enabled")

    return default_value


def get_all_feature_flags() -> Dict[str, bool]:
    """
    Returns a dictionary of all feature flags with resolved values.
    """
    return {flag: is_feature_enabled(flag) for flag in DEFAULT_FEATURE_FLAGS}


def require_feature_flag(flag_name: str, return_403: bool = False):
    """
    Decorator for APIView dispatch or view functions.
    Raises Http404 (or PermissionDenied if return_403 is True) when the flag is disabled.
    """
    def decorator(view_func_or_class):
        if isinstance(view_func_or_class, type):
            # Applying to an APIView class
            orig_initial = getattr(view_func_or_class, "initial", None)

            def initial(self, request, *args, **kwargs):
                if not is_feature_enabled(flag_name):
                    if return_403:
                        raise PermissionDenied(f"Feature '{flag_name}' is disabled.")
                    raise NotFound(f"Feature '{flag_name}' is disabled.")
                if orig_initial:
                    orig_initial(self, request, *args, **kwargs)

            view_func_or_class.initial = initial
            return view_func_or_class
        else:
            # Applying to a function view
            @wraps(view_func_or_class)
            def wrapper(request, *args, **kwargs):
                if not is_feature_enabled(flag_name):
                    if return_403:
                        raise PermissionDenied(f"Feature '{flag_name}' is disabled.")
                    raise Http404(f"Feature '{flag_name}' is disabled.")
                return view_func_or_class(request, *args, **kwargs)
            return wrapper

    return decorator


class FeatureFlagPermission(BasePermission):
    """
    DRF permission class that can be parametrized by subclassing or setting required_flag.
    """
    required_flag = ""

    def has_permission(self, request, view):
        flag = getattr(view, "required_feature_flag", self.required_flag)
        if flag and not is_feature_enabled(flag):
            return False
        return True
