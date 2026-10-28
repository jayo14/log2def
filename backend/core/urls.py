from django.contrib import admin
from django.urls import path, include
from django.conf import settings
from django.conf.urls.static import static
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
from drf_spectacular.views import (
    SpectacularAPIView, 
    SpectacularSwaggerView, 
    SpectacularRedocView
)

@csrf_exempt
def health_check(request):
    """Ultra-fast, zero-overhead health check endpoint for keep-alive pings and frontend warmup."""
    return JsonResponse({'status': 'ok', 'service': 'log2def-backend'})

urlpatterns = [
    # Health checks (both root and api prefixes, trailing-slash agnostic)
    path('health/', health_check, name='health-check'),
    path('health', health_check),
    path('api/health/', health_check, name='api-health-check'),
    path('api/health', health_check),

    path('admin/', admin.site.urls),
    path('api/', include('api.urls')),
    
    # OpenAPI Schema & Documentation at /docs (Swagger)
    path('api/schema/', SpectacularAPIView.as_view(), name='schema'),
    path('docs/', SpectacularSwaggerView.as_view(url_name='schema'), name='swagger-ui'),
    path('docs', SpectacularSwaggerView.as_view(url_name='schema')),
    path('redoc/', SpectacularRedocView.as_view(url_name='schema'), name='redoc'),
]

if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
