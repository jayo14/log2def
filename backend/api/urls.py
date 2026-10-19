from django.urls import path
from rest_framework_simplejwt.views import TokenRefreshView
from .views import (
    RegisterView, LoginView, CurrentUserView, AIStatusView,
    ProjectListCreateView, ProjectDetailView,
    DocumentListUploadView, DocumentDetailView, DocumentReprocessView, PageUpdateView,
    LogbookEntryListCreateView, LogbookEntryDetailView, LogbookBulkVerifyView,
    ReportDetailView, ReportGenerateView, SectionUpdateView, SectionRegenerateView,
    ExportDocxView, ExportPdfView,
    DefenceGenerateView, DefenceQuestionListView, DefenceQuestionDetailView, DefenceSessionView
)

urlpatterns = [
    # Auth & System
    path('auth/register/', RegisterView.as_view(), name='auth-register'),
    path('auth/login/', LoginView.as_view(), name='auth-login'),
    path('auth/token/refresh/', TokenRefreshView.as_view(), name='auth-token-refresh'),
    path('auth/me/', CurrentUserView.as_view(), name='auth-me'),
    path('ai/status/', AIStatusView.as_view(), name='ai-status'),

    # Projects
    path('projects/', ProjectListCreateView.as_view(), name='project-list-create'),
    path('projects/<int:pk>/', ProjectDetailView.as_view(), name='project-detail'),

    # Documents & Pages
    path('projects/<int:project_id>/documents/', DocumentListUploadView.as_view(), name='document-list-upload'),
    path('projects/<int:project_id>/documents/<int:doc_id>/', DocumentDetailView.as_view(), name='document-detail'),
    path('projects/<int:project_id>/documents/<int:doc_id>/reprocess/', DocumentReprocessView.as_view(), name='document-reprocess'),
    path('projects/<int:project_id>/pages/<int:page_id>/', PageUpdateView.as_view(), name='page-update'),

    # Logbook Entries
    path('projects/<int:project_id>/logbook-entries/', LogbookEntryListCreateView.as_view(), name='logbook-entries'),
    path('projects/<int:project_id>/logbook-entries/<int:entry_id>/', LogbookEntryDetailView.as_view(), name='logbook-entry-detail'),
    path('projects/<int:project_id>/logbook-entries/bulk-verify/', LogbookBulkVerifyView.as_view(), name='logbook-bulk-verify'),

    # Report & Sections
    path('projects/<int:project_id>/report/', ReportDetailView.as_view(), name='report-detail'),
    path('projects/<int:project_id>/report/generate/', ReportGenerateView.as_view(), name='report-generate'),
    path('projects/<int:project_id>/report/sections/<int:section_id>/', SectionUpdateView.as_view(), name='section-update'),
    path('projects/<int:project_id>/report/sections/<int:section_id>/regenerate/', SectionRegenerateView.as_view(), name='section-regenerate'),

    # Document Export
    path('projects/<int:project_id>/export/docx/', ExportDocxView.as_view(), name='export-docx'),
    path('projects/<int:project_id>/export/pdf/', ExportPdfView.as_view(), name='export-pdf'),

    # Defence Preparation
    path('projects/<int:project_id>/defence/generate/', DefenceGenerateView.as_view(), name='defence-generate'),
    path('projects/<int:project_id>/defence/questions/', DefenceQuestionListView.as_view(), name='defence-questions'),
    path('projects/<int:project_id>/defence/questions/<int:question_id>/', DefenceQuestionDetailView.as_view(), name='defence-question-detail'),
    path('projects/<int:project_id>/defence/session/', DefenceSessionView.as_view(), name='defence-session'),
]
