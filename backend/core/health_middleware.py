"""
Zero-overhead health check middleware that intercepts /, /health, /health/, and /api/health/
BEFORE SecurityMiddleware, ALLOWED_HOSTS validation, and SSL redirection.
Guarantees 200 OK for Render, container orchestrators, and uptime probes.
"""
from django.http import HttpResponse, JsonResponse


class HealthCheckMiddleware:
    HEALTH_PATHS = {'/', '/health', '/health/', '/api/health', '/api/health/'}

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        path = request.path_info
        if path in self.HEALTH_PATHS:
            if request.method == 'HEAD':
                return HttpResponse(status=200)
            if request.method == 'GET':
                return JsonResponse({'status': 'ok', 'service': 'log2def-backend'}, status=200)
        return self.get_response(request)
