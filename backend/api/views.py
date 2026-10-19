import os
from django.conf import settings
from django.contrib.auth.models import User
from django.shortcuts import get_object_or_404
from django.http import FileResponse, Http404
from rest_framework import generics, status, views
from rest_framework.response import Response
from rest_framework.permissions import AllowAny, IsAuthenticated
from django.core.exceptions import ValidationError
from .security import (
    validate_file_content, sanitize_html,
    AuthRateThrottle, HeavyGenerationRateThrottle, UploadRateThrottle
)
from rest_framework_simplejwt.tokens import RefreshToken
from rest_framework_simplejwt.views import TokenObtainPairView
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer
from drf_spectacular.utils import extend_schema, extend_schema_view, OpenApiParameter, OpenApiTypes, OpenApiResponse

from .models import (
    ReportProject, ReportTemplate, SourceDocument, 
    ExtractedPage, LogbookEntry, Report, ReportSection, 
    DefenceQuestion, DefenceSession
)
from .serializers import (
    UserRegistrationSerializer, UserSerializer,
    ReportProjectSerializer, ReportProjectDetailSerializer,
    SourceDocumentSerializer, ExtractedPageSerializer,
    LogbookEntrySerializer, ReportSerializer, ReportSectionSerializer,
    DefenceQuestionSerializer, DefenceSessionSerializer,
    DocumentUploadRequestSerializer, ReportGenerateRequestSerializer,
    BulkVerifyRequestSerializer, SectionUpdateRequestSerializer,
    DefenceQuestionUpdateRequestSerializer, AIStatusResponseSerializer,
    PasswordResetRequestSerializer, PasswordResetConfirmSerializer
)
from .document_processor import process_source_document
from .report_generator import generate_full_report, regenerate_single_section
from .document_exporter import generate_docx_report, export_report_documents
from .defence_generator import generate_defence_questions
from .ai_provider import get_ai_status


# --- Auth Views ---

@extend_schema(
    tags=['Authentication'],
    summary='Register student account',
    description='Registers a new student account and returns JWT access and refresh tokens.',
    responses={201: UserSerializer}
)
class RegisterView(generics.CreateAPIView):
    permission_classes = (AllowAny,)
    throttle_classes = (AuthRateThrottle,)
    serializer_class = UserRegistrationSerializer

    def post(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = serializer.save()
        refresh = RefreshToken.for_user(user)
        return Response({
            "user": UserSerializer(user).data,
            "tokens": {
                "refresh": str(refresh),
                "access": str(refresh.access_token),
            }
        }, status=status.HTTP_201_CREATED)


class CustomTokenObtainPairSerializer(TokenObtainPairSerializer):
    def validate(self, attrs):
        username = attrs.get('username')
        if username and '@' in username:
            user = User.objects.filter(email__iexact=username).first()
            if user:
                attrs['username'] = user.username
        data = super().validate(attrs)
        data['user'] = UserSerializer(self.user).data
        return data


@extend_schema(
    tags=['Authentication'],
    summary='Login and obtain JWT token pair',
    description='Authenticates student credentials and returns JWT access token, refresh token, and student profile.'
)
class LoginView(TokenObtainPairView):
    permission_classes = (AllowAny,)
    throttle_classes = (AuthRateThrottle,)
    serializer_class = CustomTokenObtainPairSerializer


@extend_schema(
    tags=['Authentication'],
    summary='Request password reset link',
    description='Generates a signed, time-limited password reset token for the specified email address.',
    request=PasswordResetRequestSerializer,
    responses={
        200: OpenApiResponse(description="Reset link generated / email dispatched"),
        400: OpenApiResponse(description="Invalid request payload")
    }
)
class PasswordResetRequestView(views.APIView):
    permission_classes = (AllowAny,)
    throttle_classes = (AuthRateThrottle,)

    def post(self, request):
        serializer = PasswordResetRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        email = serializer.validated_data['email'].strip().lower()

        user = User.objects.filter(email__iexact=email).first()
        token = None
        if user:
            from django.core.signing import TimestampSigner
            signer = TimestampSigner(salt='password-reset-salt')
            token = signer.sign(f"{user.pk}:{user.password[-16:]}")

        return Response({
            "detail": f"If an account exists for {email}, a reset link has been dispatched.",
            "reset_token": token,
            "reset_url": f"/login?view=reset&token={token}" if token else None,
        }, status=status.HTTP_200_OK)


@extend_schema(
    tags=['Authentication'],
    summary='Confirm password reset with token',
    description='Validates the cryptographic token and updates the user account password.',
    request=PasswordResetConfirmSerializer,
    responses={
        200: OpenApiResponse(description="Password successfully updated"),
        400: OpenApiResponse(description="Invalid or expired token")
    }
)
class PasswordResetConfirmView(views.APIView):
    permission_classes = (AllowAny,)
    throttle_classes = (AuthRateThrottle,)

    def post(self, request):
        serializer = PasswordResetConfirmSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response({
            "detail": "Password has been successfully updated. You may now sign in."
        }, status=status.HTTP_200_OK)



@extend_schema(
    tags=['Authentication'],
    summary='Get current authenticated student profile',
    responses={200: UserSerializer}
)
class CurrentUserView(views.APIView):
    permission_classes = (IsAuthenticated,)

    def get(self, request):
        return Response(UserSerializer(request.user).data)


@extend_schema(
    tags=['AI & System'],
    summary='Get server AI provider status',
    description='Checks if an OpenAI-compatible provider is active or if the server is running in deterministic No-AI Development Mode.',
    responses={200: AIStatusResponseSerializer}
)
class AIStatusView(views.APIView):
    permission_classes = (IsAuthenticated,)

    def get(self, request):
        return Response(get_ai_status())


# --- Helper: Project Ownership Check ---

def get_user_project(user, project_id):
    return get_object_or_404(ReportProject, id=project_id, user=user)


# --- Project CRUD Views ---

@extend_schema_view(
    get=extend_schema(
        tags=['Projects'],
        summary='List student projects',
        description='Returns all SIWES report projects belonging exclusively to the authenticated student.',
        responses={200: ReportProjectSerializer(many=True)}
    ),
    post=extend_schema(
        tags=['Projects'],
        summary='Create new report project',
        description='Initializes a new SIWES report project with student academic, institutional, and placement details.',
        request=ReportProjectSerializer,
        responses={201: ReportProjectSerializer}
    )
)
class ProjectListCreateView(generics.ListCreateAPIView):
    permission_classes = (IsAuthenticated,)
    serializer_class = ReportProjectSerializer

    def get_queryset(self):
        return ReportProject.objects.filter(user=self.request.user)

    def perform_create(self, serializer):
        serializer.save(user=self.request.user)


@extend_schema_view(
    get=extend_schema(
        tags=['Projects'],
        summary='Retrieve project details',
        description='Returns full details of the project including source documents, logbook entries, report, and defence questions.',
        responses={200: ReportProjectDetailSerializer}
    ),
    put=extend_schema(
        tags=['Projects'],
        summary='Update project details',
        request=ReportProjectSerializer,
        responses={200: ReportProjectSerializer}
    ),
    patch=extend_schema(
        tags=['Projects'],
        summary='Partially update project details',
        request=ReportProjectSerializer,
        responses={200: ReportProjectSerializer}
    ),
    delete=extend_schema(
        tags=['Projects'],
        summary='Delete report project',
        description='Permanently deletes the report project and all associated files and records.',
        responses={204: None}
    )
)
class ProjectDetailView(generics.RetrieveUpdateDestroyAPIView):
    permission_classes = (IsAuthenticated,)

    def get_serializer_class(self):
        if self.request.method == 'GET':
            return ReportProjectDetailSerializer
        return ReportProjectSerializer

    def get_queryset(self):
        return ReportProject.objects.filter(user=self.request.user)


# --- Source Documents & Pages Views ---

class DocumentListUploadView(views.APIView):
    permission_classes = (IsAuthenticated,)
    throttle_classes = (UploadRateThrottle,)

    @extend_schema(
        tags=['Source Documents'],
        summary='List uploaded source documents',
        responses={200: SourceDocumentSerializer(many=True)}
    )
    def get(self, request, project_id):
        project = get_user_project(request.user, project_id)
        docs = project.source_documents.all()
        serializer = SourceDocumentSerializer(docs, many=True)
        return Response(serializer.data)

    @extend_schema(
        tags=['Source Documents'],
        summary='Upload document or typed note for extraction',
        description='Uploads a PDF, JPG, PNG, DOCX, or direct typed note, triggers OCR/extraction, and populates logbook entries.',
        request=DocumentUploadRequestSerializer,
        responses={201: SourceDocumentSerializer}
    )
    def post(self, request, project_id):
        project = get_user_project(request.user, project_id)
        
        file_obj = request.FILES.get('file')
        raw_text = request.data.get('text', '').strip()
        doc_type = request.data.get('file_type', '')

        if not file_obj and not raw_text:
            return Response({"error": "Either an upload file or typed text must be provided."}, status=status.HTTP_400_BAD_REQUEST)

        if file_obj:
            try:
                verified_type = validate_file_content(file_obj)
            except ValidationError as ve:
                err_msg = ve.messages[0] if hasattr(ve, 'messages') else str(ve)
                return Response({"error": err_msg}, status=status.HTTP_400_BAD_REQUEST)

            doc = SourceDocument.objects.create(
                project=project,
                file=file_obj,
                original_filename=file_obj.name,
                file_type=verified_type,
                file_size=file_obj.size,
                status='uploaded'
            )
        else:
            doc_type = 'note'
            title = request.data.get('title', 'Manual Log Note')
            doc = SourceDocument.objects.create(
                project=project,
                original_filename=title,
                file_type='note',
                file_size=len(raw_text.encode('utf-8')),
                error_message=raw_text,
                status='uploaded'
            )

        process_source_document(doc.id)
        doc.refresh_from_db()
        return Response(SourceDocumentSerializer(doc).data, status=status.HTTP_201_CREATED)


class DocumentDetailView(views.APIView):
    permission_classes = (IsAuthenticated,)

    @extend_schema(
        tags=['Source Documents'],
        summary='Get source document details',
        responses={200: SourceDocumentSerializer}
    )
    def get(self, request, project_id, doc_id):
        project = get_user_project(request.user, project_id)
        doc = get_object_or_404(SourceDocument, id=doc_id, project=project)
        return Response(SourceDocumentSerializer(doc).data)

    @extend_schema(
        tags=['Source Documents'],
        summary='Delete source document',
        responses={204: None}
    )
    def delete(self, request, project_id, doc_id):
        project = get_user_project(request.user, project_id)
        doc = get_object_or_404(SourceDocument, id=doc_id, project=project)
        doc.delete()
        return Response({"message": "Source document deleted successfully."}, status=status.HTTP_204_NO_CONTENT)


class DocumentDownloadView(views.APIView):
    permission_classes = (IsAuthenticated,)

    @extend_schema(
        tags=['Source Documents'],
        summary='Download original source document safely',
        responses={200: bytes, 404: OpenApiResponse(description="Document not found")}
    )
    def get(self, request, project_id, doc_id):
        project = get_user_project(request.user, project_id)
        doc = get_object_or_404(SourceDocument, id=doc_id, project=project)
        if not doc.file or not os.path.exists(doc.file.path):
            raise Http404("Document file does not exist on disk.")

        resolved_path = os.path.realpath(doc.file.path)
        media_root = os.path.realpath(settings.MEDIA_ROOT)
        if not resolved_path.startswith(media_root):
            raise Http404("Access denied: Invalid file path.")

        return FileResponse(open(resolved_path, 'rb'), as_attachment=True, filename=doc.original_filename)



class DocumentReprocessView(views.APIView):
    permission_classes = (IsAuthenticated,)

    @extend_schema(
        tags=['Source Documents'],
        summary='Reprocess document extraction and OCR',
        request=None,
        responses={200: SourceDocumentSerializer}
    )
    def post(self, request, project_id, doc_id):
        project = get_user_project(request.user, project_id)
        doc = get_object_or_404(SourceDocument, id=doc_id, project=project)
        doc.extracted_pages.all().delete()
        process_source_document(doc.id)
        doc.refresh_from_db()
        return Response(SourceDocumentSerializer(doc).data)


class PageUpdateView(views.APIView):
    permission_classes = (IsAuthenticated,)

    @extend_schema(
        tags=['Source Documents'],
        summary='Update and verify extracted page text',
        description='Allows student to correct handwriting recognition discrepancies or adjust page review status.',
        request=ExtractedPageSerializer,
        responses={200: ExtractedPageSerializer}
    )
    def patch(self, request, project_id, page_id):
        project = get_user_project(request.user, project_id)
        page = get_object_or_404(ExtractedPage, id=page_id, document__project=project)
        serializer = ExtractedPageSerializer(page, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data)


# --- Logbook Entries Views ---

class LogbookEntryListCreateView(views.APIView):
    permission_classes = (IsAuthenticated,)

    @extend_schema(
        tags=['Logbook Entries'],
        summary='List logbook entries',
        parameters=[
            OpenApiParameter(name='week', description='Filter by week number', required=False, type=int),
            OpenApiParameter(name='verified', description='Filter by verification status (true/false)', required=False, type=bool),
        ],
        responses={200: LogbookEntrySerializer(many=True)}
    )
    def get(self, request, project_id):
        project = get_user_project(request.user, project_id)
        qs = project.logbook_entries.all()
        week = request.query_params.get('week')
        if week is not None:
            try:
                qs = qs.filter(week_number=int(week))
            except ValueError:
                pass
        verified = request.query_params.get('verified')
        if verified is not None:
            is_v = verified.lower() in ['true', '1']
            qs = qs.filter(is_verified=is_v)
        entries = qs.order_by('week_number', 'order', 'entry_date', 'id')
        return Response(LogbookEntrySerializer(entries, many=True).data)


    @extend_schema(
        tags=['Logbook Entries'],
        summary='Create manual logbook entry',
        request=LogbookEntrySerializer,
        responses={201: LogbookEntrySerializer}
    )
    def post(self, request, project_id):
        project = get_user_project(request.user, project_id)
        serializer = LogbookEntrySerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        entry = serializer.save(project=project)
        return Response(LogbookEntrySerializer(entry).data, status=status.HTTP_201_CREATED)


class LogbookEntryDetailView(views.APIView):
    permission_classes = (IsAuthenticated,)

    @extend_schema(
        tags=['Logbook Entries'],
        summary='Partially update logbook entry',
        request=LogbookEntrySerializer,
        responses={200: LogbookEntrySerializer}
    )
    def patch(self, request, project_id, entry_id):
        project = get_user_project(request.user, project_id)
        entry = get_object_or_404(LogbookEntry, id=entry_id, project=project)
        serializer = LogbookEntrySerializer(entry, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data)

    @extend_schema(
        tags=['Logbook Entries'],
        summary='Delete logbook entry',
        responses={204: None}
    )
    def delete(self, request, project_id, entry_id):
        project = get_user_project(request.user, project_id)
        entry = get_object_or_404(LogbookEntry, id=entry_id, project=project)
        entry.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class LogbookBulkVerifyView(views.APIView):
    permission_classes = (IsAuthenticated,)

    @extend_schema(
        tags=['Logbook Entries'],
        summary='Mark all or selected logbook entries as verified',
        request=BulkVerifyRequestSerializer,
        responses={200: dict}
    )
    def post(self, request, project_id):
        project = get_user_project(request.user, project_id)
        entry_ids = request.data.get('entry_ids')
        if entry_ids and isinstance(entry_ids, list):
            project.logbook_entries.filter(id__in=entry_ids).update(is_verified=True)
        else:
            project.logbook_entries.all().update(is_verified=True)
        return Response({"message": "Logbook entries verified."})


# --- Report & Sections Views ---

class ReportDetailView(views.APIView):
    permission_classes = (IsAuthenticated,)

    @extend_schema(
        tags=['Report & Sections'],
        summary='Retrieve generated report with all sections',
        responses={200: ReportSerializer}
    )
    def get(self, request, project_id):
        project = get_user_project(request.user, project_id)
        if not hasattr(project, 'report'):
            return Response({"detail": "Report not yet generated."}, status=status.HTTP_404_NOT_FOUND)
        return Response(ReportSerializer(project.report).data)


class ReportGenerateView(views.APIView):
    permission_classes = (IsAuthenticated,)
    throttle_classes = (HeavyGenerationRateThrottle,)

    @extend_schema(
        tags=['Report & Sections'],
        summary='Generate complete 5-chapter SIWES report',
        description='Builds all 5 chapters, front matter, tables, and back matter using verified logbook entries.',
        request=ReportGenerateRequestSerializer,
        responses={200: ReportSerializer}
    )
    def post(self, request, project_id):
        project = get_user_project(request.user, project_id)
        force_all_val = request.data.get('force_all', False)
        force_all = force_all_val is True or str(force_all_val).lower() in ['true', '1']
        report = generate_full_report(project, force_all=force_all)
        return Response(ReportSerializer(report).data)


class SectionUpdateView(views.APIView):
    permission_classes = (IsAuthenticated,)

    @extend_schema(
        tags=['Report & Sections'],
        summary='Save student edits to a section',
        description='Saves updated section HTML/rich-text and flags section as customized by student.',
        request=SectionUpdateRequestSerializer,
        responses={200: ReportSectionSerializer}
    )
    def patch(self, request, project_id, section_id):
        project = get_user_project(request.user, project_id)
        section = get_object_or_404(ReportSection, id=section_id, report__project=project)
        
        content = request.data.get('content')
        if content is not None:
            section.content = sanitize_html(content)
            section.last_edited_by_student = True
        
        title = request.data.get('title')
        if title is not None:
            section.title = title

        section.save()
        return Response(ReportSectionSerializer(section).data)


class SectionRegenerateView(views.APIView):
    permission_classes = (IsAuthenticated,)
    throttle_classes = (HeavyGenerationRateThrottle,)

    @extend_schema(
        tags=['Report & Sections'],
        summary='Regenerate a single section from template',
        request=None,
        responses={200: ReportSectionSerializer}
    )
    def post(self, request, project_id, section_id):
        project = get_user_project(request.user, project_id)
        section = get_object_or_404(ReportSection, id=section_id, report__project=project)
        updated_section = regenerate_single_section(section)
        return Response(ReportSectionSerializer(updated_section).data)


# --- Document Export Views ---

class ExportDocxView(views.APIView):
    permission_classes = (IsAuthenticated,)

    @extend_schema(
        tags=['Document Export'],
        summary='Export report as Microsoft Word (.docx)',
        description='Generates a formatted A4 document with 1.5" left binding margin and Times New Roman 12pt.',
        responses={(200, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'): OpenApiTypes.BINARY}
    )
    def get(self, request, project_id):
        project = get_user_project(request.user, project_id)
        if not hasattr(project, 'report'):
            return Response({"error": "Report not generated yet."}, status=status.HTTP_400_BAD_REQUEST)
        
        docx_path = generate_docx_report(project.report)
        if not os.path.exists(docx_path):
            raise Http404("Document could not be generated.")

        resolved_path = os.path.realpath(docx_path)
        media_root = os.path.realpath(settings.MEDIA_ROOT)
        if not resolved_path.startswith(media_root):
            raise Http404("Access denied: Invalid export path.")

        filename = os.path.basename(resolved_path)
        return FileResponse(
            open(resolved_path, 'rb'),
            as_attachment=True,
            filename=filename,
            content_type='application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        )


class ExportPdfView(views.APIView):
    permission_classes = (IsAuthenticated,)
    throttle_classes = (HeavyGenerationRateThrottle,)

    @extend_schema(
        tags=['Document Export'],
        summary='Export report as printable PDF (.pdf)',
        description='Converts the report DOCX to PDF using headless LibreOffice with validation.',
        responses={(200, 'application/pdf'): OpenApiTypes.BINARY}
    )
    def get(self, request, project_id):
        project = get_user_project(request.user, project_id)
        if not hasattr(project, 'report'):
            return Response({"error": "Report not generated yet."}, status=status.HTTP_400_BAD_REQUEST)

        try:
            export_result = export_report_documents(project.report)
            pdf_path = export_result['pdf_path']
        except Exception as e:
            return Response({"error": f"PDF export failed: {str(e)}"}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

        resolved_path = os.path.realpath(pdf_path)
        media_root = os.path.realpath(settings.MEDIA_ROOT)
        if not resolved_path.startswith(media_root):
            raise Http404("Access denied: Invalid export path.")

        filename = os.path.basename(resolved_path)
        return FileResponse(
            open(resolved_path, 'rb'),
            as_attachment=True,
            filename=filename,
            content_type='application/pdf'
        )



# --- Defence Views ---

class DefenceGenerateView(views.APIView):
    permission_classes = (IsAuthenticated,)
    throttle_classes = (HeavyGenerationRateThrottle,)

    @extend_schema(
        tags=['Defence Preparation'],
        summary='Generate grounded defence question bank',
        description='Generates 15+ oral defence questions and model answers grounded in the student\'s report.',
        request=None,
        responses={200: DefenceQuestionSerializer(many=True)}
    )
    def post(self, request, project_id):
        project = get_user_project(request.user, project_id)
        questions = generate_defence_questions(project)
        return Response(DefenceQuestionSerializer(questions, many=True).data)


class DefenceQuestionListView(views.APIView):
    permission_classes = (IsAuthenticated,)

    @extend_schema(
        tags=['Defence Preparation'],
        summary='List defence questions for project',
        parameters=[
            OpenApiParameter(name='category', description='Filter by question category', required=False, type=str),
            OpenApiParameter(name='mastery', description='Filter by mastery status (unanswered, reviewing, mastered)', required=False, type=str),
        ],
        responses={200: DefenceQuestionSerializer(many=True)}
    )
    def get(self, request, project_id):
        project = get_user_project(request.user, project_id)
        qs = project.defence_questions.all()
        category = request.query_params.get('category')
        if category:
            qs = qs.filter(category=category)
        mastery = request.query_params.get('mastery')
        if mastery:
            qs = qs.filter(mastery_status=mastery)
        questions = qs.order_by('order', 'id')
        return Response(DefenceQuestionSerializer(questions, many=True).data)



class DefenceQuestionDetailView(views.APIView):
    permission_classes = (IsAuthenticated,)

    @extend_schema(
        tags=['Defence Preparation'],
        summary='Update question mastery status or revision flag',
        request=DefenceQuestionUpdateRequestSerializer,
        responses={200: DefenceQuestionSerializer}
    )
    def patch(self, request, project_id, question_id):
        project = get_user_project(request.user, project_id)
        question = get_object_or_404(DefenceQuestion, id=question_id, project=project)
        
        if 'mastery_status' in request.data:
            question.mastery_status = request.data['mastery_status']
        if 'is_flagged_hard' in request.data:
            question.is_flagged_hard = request.data['is_flagged_hard']

        question.save()
        return Response(DefenceQuestionSerializer(question).data)


class DefenceSessionView(views.APIView):
    permission_classes = (IsAuthenticated,)

    @extend_schema(
        tags=['Defence Preparation'],
        summary='Record mock defence examination session progress',
        request=DefenceSessionSerializer,
        responses={201: DefenceSessionSerializer}
    )
    def post(self, request, project_id):
        project = get_user_project(request.user, project_id)
        serializer = DefenceSessionSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        session = serializer.save(project=project)
        return Response(DefenceSessionSerializer(session).data, status=status.HTTP_201_CREATED)
