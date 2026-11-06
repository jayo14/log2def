from django.urls import path
from rest_framework_simplejwt.views import TokenRefreshView
from .views import (
    RegisterView, LoginView, CurrentUserView, AIStatusView, FeatureFlagsView,
    PasswordResetRequestView, PasswordResetConfirmView,
    ProjectListCreateView, ProjectDetailView, ProjectCompletenessView, MissingInfoUpdateView, GuidedIntakeView, GuidelineUploadView,
    DocumentListUploadView, DocumentReorderView, DocumentDetailView, DocumentDownloadView, DocumentReprocessView, PageUpdateView,
    LogbookEntryListCreateView, LogbookEntryDetailView, LogbookBulkVerifyView, FactListView, FactReviewView, ReportParagraphView,
    TemplateListView,
    ReportDetailView, ReportGenerateView, ReportPageStatusView, SectionUpdateView, SectionRegenerateView,
    ReportVersionListView, ReportVersionRevertView,
    ExportDocxView, ExportPdfView, ExportStatusView, ExportDownloadView,
    InstitutionLogoView,
    DefenceGenerateView, DefenceQuestionListView, DefenceQuestionDetailView, DefenceSessionView,
    DefenceSlidesView, DefenceScriptView, PaymentOrderListCreateView
)
from .squad_views import (
    SquadInitializeView, SquadCallbackView, SquadWebhookView, SquadVerifyView,
    SecureDigitalDownloadView
)

urlpatterns = [
    # Auth & System (support both with and without trailing slashes)
    path('auth/register/', RegisterView.as_view(), name='auth-register'),
    path('auth/register', RegisterView.as_view()),
    path('auth/login/', LoginView.as_view(), name='auth-login'),
    path('auth/login', LoginView.as_view()),
    path('auth/password-reset/', PasswordResetRequestView.as_view(), name='auth-password-reset'),
    path('auth/password-reset', PasswordResetRequestView.as_view()),
    path('auth/password-reset/confirm/', PasswordResetConfirmView.as_view(), name='auth-password-reset-confirm'),
    path('auth/password-reset/confirm', PasswordResetConfirmView.as_view()),
    path('auth/token/refresh/', TokenRefreshView.as_view(), name='auth-token-refresh'),
    path('auth/token/refresh', TokenRefreshView.as_view()),
    path('auth/me/', CurrentUserView.as_view(), name='auth-me'),
    path('auth/me', CurrentUserView.as_view()),
    path('ai/status/', AIStatusView.as_view(), name='ai-status'),
    path('ai/status', AIStatusView.as_view()),
    path('config/flags/', FeatureFlagsView.as_view(), name='config-flags'),
    path('config/flags', FeatureFlagsView.as_view()),

    # Projects
    path('projects/', ProjectListCreateView.as_view(), name='project-list-create'),
    path('projects', ProjectListCreateView.as_view()),
    path('projects/<int:pk>/', ProjectDetailView.as_view(), name='project-detail'),
    path('projects/<int:pk>', ProjectDetailView.as_view()),
    path('projects/<int:project_id>/completeness/', ProjectCompletenessView.as_view(), name='project-completeness'),
    path('projects/<int:project_id>/completeness', ProjectCompletenessView.as_view()),
    path('projects/<int:project_id>/missing-info/', MissingInfoUpdateView.as_view(), name='project-missing-info'),
    path('projects/<int:project_id>/missing-info', MissingInfoUpdateView.as_view()),
    path('projects/<int:project_id>/intake/', GuidedIntakeView.as_view(), name='guided-intake'),
    path('projects/<int:project_id>/upload-guideline/', GuidelineUploadView.as_view(), name='project-upload-guideline'),
    path('projects/<int:project_id>/upload-guideline', GuidelineUploadView.as_view()),

    # Documents & Pages
    path('projects/<int:project_id>/documents/', DocumentListUploadView.as_view(), name='document-list-upload'),
    path('projects/<int:project_id>/documents', DocumentListUploadView.as_view()),
    path('projects/<int:project_id>/documents/reorder/', DocumentReorderView.as_view(), name='document-reorder'),
    path('projects/<int:project_id>/documents/reorder', DocumentReorderView.as_view()),
    path('projects/<int:project_id>/documents/<int:doc_id>/', DocumentDetailView.as_view(), name='document-detail'),
    path('projects/<int:project_id>/documents/<int:doc_id>', DocumentDetailView.as_view()),
    path('projects/<int:project_id>/documents/<int:doc_id>/download/', DocumentDownloadView.as_view(), name='document-download'),
    path('projects/<int:project_id>/documents/<int:doc_id>/download', DocumentDownloadView.as_view()),
    path('projects/<int:project_id>/documents/<int:doc_id>/reprocess/', DocumentReprocessView.as_view(), name='document-reprocess'),
    path('projects/<int:project_id>/documents/<int:doc_id>/reprocess', DocumentReprocessView.as_view()),
    path('projects/<int:project_id>/pages/<int:page_id>/', PageUpdateView.as_view(), name='page-update'),
    path('projects/<int:project_id>/pages/<int:page_id>', PageUpdateView.as_view()),

    # Logbook Entries
    path('projects/<int:project_id>/logbook-entries/', LogbookEntryListCreateView.as_view(), name='logbook-entries'),
    path('projects/<int:project_id>/logbook-entries', LogbookEntryListCreateView.as_view()),
    path('projects/<int:project_id>/logbook-entries/<int:entry_id>/', LogbookEntryDetailView.as_view(), name='logbook-entry-detail'),
    path('projects/<int:project_id>/logbook-entries/<int:entry_id>', LogbookEntryDetailView.as_view()),
    path('projects/<int:project_id>/logbook-entries/bulk-verify/', LogbookBulkVerifyView.as_view(), name='logbook-bulk-verify'),
    path('projects/<int:project_id>/logbook-entries/bulk-verify', LogbookBulkVerifyView.as_view()),

    # Provenance-backed fact review
    path('projects/<int:project_id>/facts/', FactListView.as_view(), name='fact-list'),
    path('projects/<int:project_id>/facts/<int:fact_id>/', FactReviewView.as_view(), name='fact-review'),
    path('projects/<int:project_id>/report/paragraphs/', ReportParagraphView.as_view(), name='report-paragraphs'),

    # Templates
    path('templates/', TemplateListView.as_view(), name='template-list'),
    path('templates', TemplateListView.as_view()),
    path('institutions/<str:institution_code>/logo/', InstitutionLogoView.as_view(), name='institution-logo'),
    path('institutions/<str:institution_code>/logo', InstitutionLogoView.as_view()),

    # Report & Sections
    path('projects/<int:project_id>/report/page-status/', ReportPageStatusView.as_view(), name='report-page-status'),
    path('projects/<int:project_id>/report/page-status', ReportPageStatusView.as_view()),
    path('projects/<int:project_id>/report/', ReportDetailView.as_view(), name='report-detail'),
    path('projects/<int:project_id>/report', ReportDetailView.as_view()),
    path('projects/<int:project_id>/report/generate/', ReportGenerateView.as_view(), name='report-generate'),
    path('projects/<int:project_id>/report/generate', ReportGenerateView.as_view()),
    path('projects/<int:project_id>/report/sections/<int:section_id>/', SectionUpdateView.as_view(), name='section-update'),
    path('projects/<int:project_id>/report/sections/<int:section_id>', SectionUpdateView.as_view()),
    path('projects/<int:project_id>/report/sections/<int:section_id>/regenerate/', SectionRegenerateView.as_view(), name='section-regenerate'),
    path('projects/<int:project_id>/report/sections/<int:section_id>/regenerate', SectionRegenerateView.as_view()),
    path('projects/<int:project_id>/report/versions/', ReportVersionListView.as_view(), name='report-versions'),
    path('projects/<int:project_id>/report/versions', ReportVersionListView.as_view()),
    path('projects/<int:project_id>/report/versions/<int:version_id>/revert/', ReportVersionRevertView.as_view(), name='report-version-revert'),
    path('projects/<int:project_id>/report/versions/<int:version_id>/revert', ReportVersionRevertView.as_view()),

    # Document Export
    path('projects/<int:project_id>/export/docx/', ExportDocxView.as_view(), name='export-docx'),
    path('projects/<int:project_id>/export/docx', ExportDocxView.as_view()),
    path('projects/<int:project_id>/export/pdf/', ExportPdfView.as_view(), name='export-pdf'),
    path('projects/<int:project_id>/export/pdf', ExportPdfView.as_view()),
    path('projects/<int:project_id>/export/status/', ExportStatusView.as_view(), name='export-status'),
    path('projects/<int:project_id>/export/status', ExportStatusView.as_view()),
    path('projects/<int:project_id>/export/download/', ExportDownloadView.as_view(), name='export-download'),
    path('projects/<int:project_id>/export/download', ExportDownloadView.as_view()),

    # Payment & Delivery Orders
    path('projects/<int:project_id>/payments/', PaymentOrderListCreateView.as_view(), name='project-payments'),
    path('projects/<int:project_id>/payments', PaymentOrderListCreateView.as_view()),

    # Squad Payment Integration
    path('projects/<int:project_id>/squad/initialize/', SquadInitializeView.as_view(), name='squad-initialize'),
    path('projects/<int:project_id>/squad/initialize', SquadInitializeView.as_view()),
    path('projects/<int:project_id>/squad/verify/', SquadVerifyView.as_view(), name='squad-verify'),
    path('projects/<int:project_id>/squad/verify', SquadVerifyView.as_view()),
    path('projects/<int:project_id>/squad/download/<str:format_type>/', SecureDigitalDownloadView.as_view(), name='squad-secure-download'),
    path('projects/<int:project_id>/squad/download/<str:format_type>', SecureDigitalDownloadView.as_view()),

    # Squad Callback & Webhook (public, no auth required)
    path('squad/callback/', SquadCallbackView.as_view(), name='squad-callback'),
    path('squad/callback', SquadCallbackView.as_view()),
    path('squad/webhook/', SquadWebhookView.as_view(), name='squad-webhook'),
    path('squad/webhook', SquadWebhookView.as_view()),

    # Defence Preparation
    path('projects/<int:project_id>/defence/generate/', DefenceGenerateView.as_view(), name='defence-generate'),
    path('projects/<int:project_id>/defence/generate', DefenceGenerateView.as_view()),
    path('projects/<int:project_id>/defence/questions/', DefenceQuestionListView.as_view(), name='defence-questions'),
    path('projects/<int:project_id>/defence/questions', DefenceQuestionListView.as_view()),
    path('projects/<int:project_id>/defence/questions/<int:question_id>/', DefenceQuestionDetailView.as_view(), name='defence-question-detail'),
    path('projects/<int:project_id>/defence/questions/<int:question_id>', DefenceQuestionDetailView.as_view()),
    path('projects/<int:project_id>/defence/session/', DefenceSessionView.as_view(), name='defence-session'),
    path('projects/<int:project_id>/defence/session', DefenceSessionView.as_view()),
    path('projects/<int:project_id>/defence/slides/', DefenceSlidesView.as_view(), name='defence-slides'),
    path('projects/<int:project_id>/defence/slides', DefenceSlidesView.as_view()),
    path('projects/<int:project_id>/defence/script/', DefenceScriptView.as_view(), name='defence-script'),
    path('projects/<int:project_id>/defence/script', DefenceScriptView.as_view()),
]
