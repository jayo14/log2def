import os
import re
import sys
import threading
from html import escape, unescape
from html.parser import HTMLParser
from pathlib import Path
from django.db import transaction
from django.conf import settings
from django.contrib.auth.models import User
from django.shortcuts import get_object_or_404
from django.http import FileResponse, Http404
from rest_framework import generics, status, views, serializers
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
    ExtractedPage, LogbookEntry, Report, ReportSection, ReportVersion,
    DefenceQuestion, DefenceSession, PaymentOrder, Fact, ReportParagraph
)
from django.core.signing import TimestampSigner, BadSignature, SignatureExpired
from .guided_intake import intake_answer_complete
from .serializers import (
    UserRegistrationSerializer, UserSerializer,
    ReportProjectSerializer, ReportProjectDetailSerializer,
    SourceDocumentSerializer, ExtractedPageSerializer,
    LogbookEntrySerializer, FactSerializer, ReportParagraphSerializer, ReportSerializer, ReportSectionSerializer,
    ReportVersionSerializer, ReportVersionCreateRequestSerializer,
    ReportTemplateSerializer,
    PresentationSlidesResponseSerializer, PresentationScriptResponseSerializer,
    DefenceQuestionSerializer, DefenceSessionSerializer,
    DocumentUploadRequestSerializer, DocumentReorderRequestSerializer,
    ReportGenerateRequestSerializer,
    BulkVerifyRequestSerializer, SectionUpdateRequestSerializer,
    ExportStatusRequestSerializer, ExportStatusResponseSerializer,
    DefenceQuestionUpdateRequestSerializer, AIStatusResponseSerializer,
    PasswordResetRequestSerializer, PasswordResetConfirmSerializer,
    PaymentOrderSerializer
)
from .document_processor import process_source_document
from .report_generator import generate_full_report, regenerate_single_section
from .document_exporter import generate_docx_report, export_report_documents
from .defence_generator import (
    generate_defence_questions,
    generate_presentation_slides,
    generate_presentation_script
)
from .ai_provider import get_ai_status
from .feature_flags import get_all_feature_flags, is_feature_enabled, require_feature_flag


# --- Configuration & Feature Flag Views ---

@extend_schema(
    tags=['Configuration'],
    summary='Get all feature flags',
    description='Returns runtime status of all system feature flags.',
    responses={
        200: OpenApiResponse(
            description="Dictionary of feature flags mapping flag name to boolean status",
            response=OpenApiTypes.OBJECT
        )
    }
)
class FeatureFlagsView(views.APIView):
    permission_classes = (AllowAny,)

    def get(self, request):
        return Response(get_all_feature_flags(), status=status.HTTP_200_OK)


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


class GuidelineUploadView(views.APIView):
    permission_classes = (IsAuthenticated,)
    throttle_classes = (UploadRateThrottle,)
    serializer_class = ReportProjectSerializer

    @extend_schema(
        tags=['Projects'],
        summary='Upload or update custom department SIWES guidelines',
        responses={200: ReportProjectSerializer}
    )
    def post(self, request, project_id):
        project = get_user_project(request.user, project_id)
        file_obj = request.FILES.get('file')
        raw_text = request.data.get('guideline_text', '').strip()
        university = request.data.get('university_name', '').strip()

        if university:
            project.university_name = university
            if 'lasustech' in university.lower():
                project.guideline_preset = 'lasustech'
            else:
                project.guideline_preset = 'custom'

        extracted_text = ''
        if file_obj:
            if file_obj.size > settings.MAX_UPLOAD_SIZE_BYTES:
                return Response({"detail": "File size exceeds the 15MB upload limit."}, status=status.HTTP_400_BAD_REQUEST)
            
            project.custom_guideline_file = file_obj
            try:
                from .storage import upload_object
                file_obj.seek(0)
                upload_object(key=f"guidelines/{file_obj.name}", body=file_obj.read(), content_type=getattr(file_obj, 'content_type', None))
                file_obj.seek(0)
            except Exception:
                pass
            ext = os.path.splitext(file_obj.name)[1].lower()

            if ext == '.pdf':
                try:
                    import pymupdf
                    pdf_doc = pymupdf.open(stream=file_obj.read(), filetype='pdf')
                    pages_text = [pdf_doc[i].get_text('text').strip() for i in range(len(pdf_doc))]
                    extracted_text = '\n\n'.join(p for p in pages_text if p)
                except Exception:
                    pass
            elif ext in ('.docx', '.doc'):
                try:
                    from docx import Document as DocxDoc
                    docx_doc = DocxDoc(file_obj)
                    extracted_text = '\n\n'.join(p.text.strip() for p in docx_doc.paragraphs if p.text.strip())
                except Exception:
                    pass
            elif ext in ('.txt', '.md'):
                try:
                    extracted_text = file_obj.read().decode('utf-8', errors='ignore')
                except Exception:
                    pass
        elif raw_text:
            extracted_text = raw_text

        if extracted_text:
            project.custom_guideline_extracted = extracted_text[:20000]
            project.department_requirements = extracted_text[:5000]
            project.guideline_preset = 'custom'
        
        project.save()
        return Response(ReportProjectSerializer(project).data, status=status.HTTP_200_OK)


# --- Source Documents & Pages Views ---

@require_feature_flag('logbook_bulk_upload')
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
        description='Uploads a PDF, JPG, PNG, WEBP, DOCX, or direct typed note, triggers OCR/extraction, and populates logbook entries. Supports idempotency via client_upload_id.',
        request=DocumentUploadRequestSerializer,
        responses={201: SourceDocumentSerializer, 200: SourceDocumentSerializer}
    )
    def post(self, request, project_id):
        project = get_user_project(request.user, project_id)
        
        file_list = request.FILES.getlist('files') or request.FILES.getlist('file')
        raw_text = request.data.get('text', '').strip()
        doc_type = request.data.get('file_type', '')
        client_upload_id = request.data.get('client_upload_id') or request.headers.get('X-Client-Upload-Id', '')
        client_upload_id = str(client_upload_id).strip()

        # Idempotency check: if client_upload_id was already uploaded for this project, return the existing doc
        if client_upload_id:
            existing_doc = project.source_documents.filter(client_upload_id=client_upload_id).first()
            if existing_doc:
                return Response(SourceDocumentSerializer(existing_doc).data, status=status.HTTP_200_OK)

        raw_page_index = request.data.get('page_index') or request.headers.get('X-Page-Index')
        try:
            start_page_index = int(raw_page_index) if raw_page_index is not None else project.source_documents.count()
        except (ValueError, TypeError):
            start_page_index = project.source_documents.count()

        is_async = request.data.get('async', 'false').lower() in ('1', 'true') or request.headers.get('X-Async-Processing', '').lower() in ('1', 'true')
        is_testing = 'test' in sys.argv or getattr(settings, 'IS_TESTING', False)

        if not file_list and not raw_text:
            return Response({"error": "Either an upload file or typed text must be provided."}, status=status.HTTP_400_BAD_REQUEST)

        if len(file_list) > 30:
            return Response({"error": "Maximum of 30 files can be uploaded per batch."}, status=status.HTTP_400_BAD_REQUEST)

        created_docs = []
        if file_list:
            for idx, file_obj in enumerate(file_list):
                try:
                    verified_type = validate_file_content(file_obj)
                except ValidationError as ve:
                    err_msg = ve.messages[0] if hasattr(ve, 'messages') else str(ve)
                    return Response({"error": err_msg}, status=status.HTTP_400_BAD_REQUEST)

                item_upload_id = client_upload_id if len(file_list) == 1 else (f"{client_upload_id}_{idx}" if client_upload_id else "")
                doc = SourceDocument.objects.create(
                    project=project,
                    file=file_obj,
                    original_filename=file_obj.name,
                    file_type=verified_type,
                    file_size=file_obj.size,
                    page_index=start_page_index + idx,
                    client_upload_id=item_upload_id,
                    status='uploaded'
                )
                try:
                    from .storage import upload_object
                    if doc.file and os.path.exists(doc.file.path):
                        with open(doc.file.path, 'rb') as f:
                            upload_object(key=doc.file.name, body=f.read())
                except Exception:
                    pass

                if is_async and not is_testing:
                    t = threading.Thread(target=process_source_document, args=(doc.id,), daemon=True)
                    t.start()
                else:
                    try:
                        process_source_document(doc.id)
                        doc.refresh_from_db()
                    except Exception as pe:
                        logger.warning(f"Error during document extraction for doc {doc.id}: {pe}")
                        doc.status = 'error'
                        doc.error_message = str(pe)
                        doc.save(update_fields=['status', 'error_message'])

                created_docs.append(doc)

            if len(created_docs) == 1:
                return Response(SourceDocumentSerializer(created_docs[0]).data, status=status.HTTP_201_CREATED)
            return Response(SourceDocumentSerializer(created_docs, many=True).data, status=status.HTTP_201_CREATED)
        else:
            title = request.data.get('title', 'Manual Log Note')
            doc = SourceDocument.objects.create(
                project=project,
                original_filename=title,
                file_type='note',
                file_size=len(raw_text.encode('utf-8')),
                page_index=start_page_index,
                client_upload_id=client_upload_id,
                error_message=raw_text,
                status='uploaded'
            )
            if is_async and not is_testing:
                t = threading.Thread(target=process_source_document, args=(doc.id,), daemon=True)
                t.start()
            else:
                process_source_document(doc.id)
                doc.refresh_from_db()
            return Response(SourceDocumentSerializer(doc).data, status=status.HTTP_201_CREATED)


@require_feature_flag('logbook_bulk_upload')
class DocumentReorderView(views.APIView):
    permission_classes = (IsAuthenticated,)

    @extend_schema(
        tags=['Source Documents'],
        summary='Reorder source documents',
        description='Updates explicit page_index ordering for source documents in a project.',
        request=DocumentReorderRequestSerializer,
        responses={200: SourceDocumentSerializer(many=True), 400: OpenApiResponse(description="Invalid request")}
    )
    def patch(self, request, project_id):
        project = get_user_project(request.user, project_id)
        serializer = DocumentReorderRequestSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        order_items = serializer.validated_data.get('order', [])
        doc_ids = [item['id'] for item in order_items]

        docs = {doc.id: doc for doc in project.source_documents.filter(id__in=doc_ids)}
        if len(docs) != len(doc_ids):
            return Response(
                {"error": "One or more document IDs do not exist or do not belong to this project."},
                status=status.HTTP_400_BAD_REQUEST
            )

        with transaction.atomic():
            for item in order_items:
                doc = docs[item['id']]
                doc.page_index = item['page_index']
                doc.save(update_fields=['page_index'])

        ordered_docs = project.source_documents.all().order_by('page_index', 'uploaded_at')
        return Response(SourceDocumentSerializer(ordered_docs, many=True).data, status=status.HTTP_200_OK)


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
        LogbookEntry.objects.filter(source_page__document=doc).delete()
        doc.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


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
        LogbookEntry.objects.filter(source_page__document=doc).delete()
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
        if page.is_reviewed:
            from .extraction import parse_reviewed_page
            from .models import LogbookPage
            record_page, _ = LogbookPage.objects.get_or_create(
                extracted_page=page,
                defaults={"page_index": page.page_index, "quality_score": page.confidence_score},
            )
            record_page.page_index = page.page_index
            record_page.quality_score = page.confidence_score
            record_page.save(update_fields=["page_index", "quality_score"])
            record_page.day_entries.all().delete()
            parse_reviewed_page(record_page)
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


class FactListView(views.APIView):
    permission_classes = (IsAuthenticated,)

    @extend_schema(responses=FactSerializer(many=True))
    def get(self, request, project_id):
        project = get_user_project(request.user, project_id)
        facts = project.facts.prefetch_related("source_entry_ids").order_by("status", "id")
        return Response(FactSerializer(facts, many=True).data)


class FactReviewView(views.APIView):
    permission_classes = (IsAuthenticated,)

    @extend_schema(request=OpenApiTypes.OBJECT, responses=FactSerializer)
    def patch(self, request, project_id, fact_id):
        project = get_user_project(request.user, project_id)
        fact = get_object_or_404(Fact, id=fact_id, project=project)
        if set(request.data) != {"status"} or request.data.get("status") not in {"confirmed", "rejected"}:
            return Response({"error": "Provide status as confirmed or rejected."}, status=status.HTTP_400_BAD_REQUEST)
        fact.status = request.data["status"]
        fact.save(update_fields=["status"])
        return Response(FactSerializer(fact).data)


class ReportParagraphView(views.APIView):
    permission_classes = (IsAuthenticated,)

    @extend_schema(responses=ReportParagraphSerializer(many=True))
    def get(self, request, project_id):
        project = get_user_project(request.user, project_id)
        report = get_object_or_404(Report, project=project)
        paragraphs = report.provenance_paragraphs.prefetch_related("facts").order_by("section_key", "order")
        return Response(ReportParagraphSerializer(paragraphs, many=True).data)

    @extend_schema(request=OpenApiTypes.OBJECT, responses=ReportParagraphSerializer)
    def post(self, request, project_id):
        project = get_user_project(request.user, project_id)
        report = get_object_or_404(Report, project=project)
        section_key = request.data.get("section_key")
        text_value = request.data.get("text")
        fact_ids = request.data.get("fact_ids")
        if not isinstance(text_value, str) or not text_value.strip():
            return Response({"error": "A non-empty normalized paragraph is required."}, status=status.HTTP_400_BAD_REQUEST)
        from .grounded_writer import validate_student_edited_text
        if not validate_student_edited_text(text_value):
            return Response({"error": "End the paragraph with punctuation and remove placeholders or second-person instructions."}, status=status.HTTP_400_BAD_REQUEST)
        if request.data.get("student_confirmed") is not True:
            return Response({"error": "Student confirmation of this wording is required."}, status=status.HTTP_400_BAD_REQUEST)
        if not isinstance(fact_ids, list) or not fact_ids:
            return Response({"error": "At least one supporting Fact ID is required."}, status=status.HTTP_400_BAD_REQUEST)
        from .templates import get_section_requirements
        sections = {section["key"]: section for section in get_section_requirements()["sections"]}
        if section_key not in sections or sections[section_key]["source"] not in {
            "LOGBOOK", "INFERRED", "CONFIRMED_CONTENT", "STUDENT_PROVIDED"
        }:
            return Response({"error": "Paragraph section is not a student-derived template section."}, status=status.HTTP_400_BAD_REQUEST)
        facts = list(Fact.objects.filter(project=project, id__in=fact_ids, status="confirmed"))
        if len(facts) != len(set(fact_ids)):
            return Response({"error": "Every supporting Fact must belong to this project and be confirmed."}, status=status.HTTP_400_BAD_REQUEST)
        section = get_object_or_404(ReportSection, report=report, section_key=section_key)
        paragraph = ReportParagraph.objects.create(
            report=report, section_key=section_key,
            order=report.provenance_paragraphs.filter(section_key=section_key).count(),
            text=text_value.strip(), student_confirmed=True,
        )
        paragraph.facts.set(facts)
        confirmed_paragraphs = report.provenance_paragraphs.filter(
            section_key=section_key, student_confirmed=True
        ).prefetch_related("facts").order_by("order", "id")
        section.content = "".join(f"<p>{escape(item.text)}</p>" for item in confirmed_paragraphs)
        section.source_links = sorted({fact_id for item in confirmed_paragraphs for fact_id in item.facts.values_list("id", flat=True)})
        section.last_edited_by_student = True
        section.save(update_fields=["content", "source_links", "last_edited_by_student", "updated_at"])
        from .document_model import model_from_sections
        report.document_model = model_from_sections(report, report.template_snapshot or {}).to_dict()
        report.save(update_fields=["document_model", "updated_at"])
        return Response(ReportParagraphSerializer(paragraph).data, status=status.HTTP_201_CREATED)


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


class TemplateListView(views.APIView):
    permission_classes = (IsAuthenticated,)

    @extend_schema(
        tags=['Templates'],
        summary='List versioned report templates',
        description='Returns available institutional report templates with formatting specs and required fields.',
        responses={200: ReportTemplateSerializer(many=True)}
    )
    def get(self, request):
        from .templates import ensure_default_template_in_db, ensure_v2_template_in_db
        ensure_default_template_in_db()
        ensure_v2_template_in_db()
        templates = ReportTemplate.objects.all().order_by('code', '-version')
        return Response(ReportTemplateSerializer(templates, many=True).data)


class InstitutionLogoView(views.APIView):
    """
    Serves the institution-level logo asset for report covers.

    The logo path is resolved from template ``institution_asset.logo`` config with
    safe fallbacks so another institution's logo can be added without code changes.
    Students cannot replace or remove it.
    """
    permission_classes = (AllowAny,)

    def get(self, request, institution_code="lasustech"):
        from .templates import get_template_spec, resolve_institution_logo_path
        spec = get_template_spec(code=institution_code, version="1.0.0")
        project_root = Path(settings.BASE_DIR).parent
        abs_path = resolve_institution_logo_path(spec, project_root)
        if abs_path is None or not abs_path.exists():
            raise Http404("Logo asset not found on disk.")
        content_type = "image/svg+xml" if abs_path.suffix.lower() == ".svg" else "image/png"
        return FileResponse(abs_path.open("rb"), content_type=content_type)


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


@extend_schema(
    tags=['Report & Sections'],
    summary='Get page range status and count for report',
    responses={200: OpenApiTypes.OBJECT}
)
class ReportPageStatusView(views.APIView):
    permission_classes = (IsAuthenticated,)

    def get(self, request, project_id):
        project = get_user_project(request.user, project_id)
        if not hasattr(project, 'report'):
            return Response({"detail": "Report not yet generated."}, status=status.HTTP_404_NOT_FOUND)
        report = project.report
        return Response({
            "actual_page_count": report.actual_page_count,
            "page_range_status": report.page_range_status,
            "estimated_pages": report.estimated_pages,
            "page_estimate_breakdown": report.page_estimate_breakdown,
            "min_pages": 12,
            "max_pages": 15,
            "target_pages": 13,
        })


@require_feature_flag('report_generation')
class ReportGenerateView(views.APIView):
    permission_classes = (IsAuthenticated,)
    throttle_classes = (HeavyGenerationRateThrottle,)

    @extend_schema(
        tags=['Report & Sections'],
        summary='Generate complete 5-chapter SIWES report',
        description='Builds all 5 chapters, front matter, tables, and back matter using verified logbook entries. Blocks generation if required fields are missing.',
        request=ReportGenerateRequestSerializer,
        responses={200: ReportSerializer, 400: OpenApiResponse(description="Missing required fields or invalid dates")}
    )
    def post(self, request, project_id):
        project = get_user_project(request.user, project_id)
        
        # Block generation while essential required information is missing or dates invalid
        from .completeness import check_project_completeness
        completeness = check_project_completeness(project)
        if not completeness['can_generate']:
            missing_labels = [
                completeness['fields'][k]['label'] 
                for k in completeness['missing_required_fields'] 
                if k in completeness['fields']
            ]
            return Response({
                "error": "Cannot generate report: essential required information is missing or training dates are invalid.",
                "missing_required_fields": completeness['missing_required_fields'],
                "missing_labels": missing_labels,
                "date_validation": completeness['date_validation'],
                "completeness": completeness,
            }, status=status.HTTP_400_BAD_REQUEST)

        force_all_val = False
        if hasattr(request, 'data') and isinstance(request.data, dict):
            force_all_val = request.data.get('force_all', False)
        force_all = force_all_val is True or str(force_all_val).lower() in ['true', '1']

        try:
            report = generate_full_report(project, force_all=force_all)
            return Response(ReportSerializer(report).data)
        except Exception as e:
            logger.exception(f"Error generating report for project {project_id}: {e}")
            return Response(
                {"error": f"Report generation failed: {str(e)}"},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )


class ProjectCompletenessView(views.APIView):
    permission_classes = (IsAuthenticated,)

    @extend_schema(
        tags=['Projects'],
        summary='Get project completeness status and missing information checklist',
        description='Evaluates project against institutional report template requirements and returns Found/Missing/Uncertain per field.',
        responses={200: OpenApiResponse(response=OpenApiTypes.OBJECT)}
    )
    def get(self, request, project_id):
        project = get_user_project(request.user, project_id)
        from .completeness import check_project_completeness
        return Response(check_project_completeness(project), status=status.HTTP_200_OK)


class GuidedIntakeView(views.APIView):
    permission_classes = (IsAuthenticated,)

    @extend_schema(responses=OpenApiTypes.OBJECT)
    def get(self, request, project_id):
        project = get_user_project(request.user, project_id)
        from .templates import get_section_requirements
        from .completeness import check_project_completeness
        steps = get_section_requirements()["guided_intake"]["steps"]
        answers = project.guided_intake or {}
        required_steps = [step for step in steps if step.get("required") and not intake_answer_complete(step, answers)]
        optional_steps = [step for step in steps if not step.get("required")]
        prefill = "\n".join(
            (entry.verified_text or entry.activity_summary or "").strip()
            for entry in project.logbook_entries.filter(is_verified=True).order_by("week_number", "order", "id")
            if (entry.verified_text or entry.activity_summary or "").strip()
        )
        completeness = check_project_completeness(project)
        return Response({
            "answers": answers,
            "required_steps": required_steps,
            "optional_steps": optional_steps,
            "logbook_prefill": {"duties": prefill, "label": "From your logbook — confirm before using"} if prefill else None,
            "intake_complete": not required_steps,
            "can_generate": completeness["can_generate"],
            "completeness": completeness,
        })

    @extend_schema(request=OpenApiTypes.OBJECT, responses=OpenApiTypes.OBJECT)
    def patch(self, request, project_id):
        project = get_user_project(request.user, project_id)
        if set(request.data) != {"key", "answer"}:
            return Response({"error": "Provide only the interview key and its answer."}, status=status.HTTP_400_BAD_REQUEST)
        key, answer = request.data.get("key"), request.data.get("answer")
        from .templates import get_section_requirements
        steps = {step["key"]: step for step in get_section_requirements()["guided_intake"]["steps"]}
        if key not in steps:
            return Response({"error": "This interview question is not in the active template."}, status=status.HTTP_400_BAD_REQUEST)
        step = steps[key]
        error = validate_intake_answer(key, answer, required=step.get("required", False))
        if error:
            return Response({"error": error}, status=status.HTTP_400_BAD_REQUEST)
        answers = dict(project.guided_intake or {})
        answers[key] = answer
        project.guided_intake = answers
        if key == "industry_supervisor_name":
            project.industry_supervisor_name = str(answer).strip()
            project.save(update_fields=["guided_intake", "industry_supervisor_name", "updated_at"])
        else:
            project.save(update_fields=["guided_intake", "updated_at"])
        save_intake_facts(project, key, answer)
        from .completeness import check_project_completeness
        return Response({"answers": answers, "completeness": check_project_completeness(project)})


def validate_intake_answer(key, answer, required=False):
    if key == "challenge_pairs":
        if not isinstance(answer, dict):
            return "Choose ‘I had none’ or provide two or three challenge and solution pairs."
        if answer.get("none") is True:
            return ""
        pairs = answer.get("pairs")
        if not isinstance(pairs, list) or len(pairs) not in (2, 3):
            return "Provide two or three real challenge and solution pairs, or select ‘I had none’."
        if any(not str(pair.get("challenge", "")).strip() or not str(pair.get("solution", "")).strip() for pair in pairs):
            return "Each challenge needs its own solution. Complete both fields in every pair."
        return ""
    if key == "acknowledgement_people":
        if not isinstance(answer, dict):
            return "Provide acknowledgement choices in the requested format."
        people = answer.get("people", [])
        if answer.get("include") and (not isinstance(people, list) or any(not str(p.get("name", "")).strip() for p in people)):
            return "Enter a name for each person you choose to acknowledge."
        return ""
    if key == "organogram_tree" and answer:
        lines = [line for line in str(answer).splitlines() if line.strip()]
        previous_depth = 0
        for index, line in enumerate(lines):
            indent = len(line) - len(line.lstrip(" "))
            depth = indent // 2
            if "\t" in line or indent % 2 or (index == 0 and depth != 0) or depth > previous_depth + 1:
                return "Use a root line, then indent each child by two spaces under its parent."
            previous_depth = depth
    if key in {"include_dedication", "thank_god", "thank_family"}:
        return "" if isinstance(answer, bool) else "Choose yes or no."
    if key not in {"challenge_pairs", "acknowledgement_people"} and not isinstance(answer, str):
        return "Enter a text answer for this question."
    if answer is None or not str(answer).strip():
        return "Please enter an answer." if required else ""
    return ""


def save_intake_facts(project, key, answer):
    """Replace the editable answer's Fact rows with student-confirmed evidence."""
    from .models import Fact
    Fact.objects.filter(project=project, source_field__startswith=f"{key}:", provenance="STUDENT_PROVIDED").delete()
    Fact.objects.filter(project=project, source_field=key, provenance="STUDENT_PROVIDED").delete()
    rows = []
    if key == "challenge_pairs":
        if answer.get("none") is True:
            rows.append(("challenge", "I had none", "no_challenges"))
        else:
            for index, pair in enumerate(answer["pairs"], start=1):
                rows.extend([
                    ("challenge", pair["challenge"].strip(), f"challenge_{index}"),
                    ("solution", pair["solution"].strip(), f"solution_{index}"),
                ])
    elif key == "acknowledgement_people":
        if answer.get("include"):
            for index, person in enumerate(answer.get("people", []), start=1):
                title = person.get("title", "").strip()
                name = person["name"].strip()
                rows.append(("person", f"{title} | {name}" if title else name, f"person_{index}"))
            if answer.get("thank_god"):
                rows.append(("personal_statement", "Thank God", "thank_god"))
            if answer.get("thank_family"):
                rows.append(("personal_statement", "My family", "thank_family"))
    elif key == "dedication":
        if str(answer).strip():
            rows.append(("personal_statement", str(answer).strip(), "dedication"))
    else:
        kinds = {
            "organisation_what": "organisation_detail", "organisation_history": "organisation_detail",
            "organisation_objectives": "organisation_detail", "organisation_structure": "organisation_detail",
            "organogram_tree": "organisation_detail", "student_unit": "organisation_detail",
            "supervisor_title": "person", "duties": "duty", "recommendations": "recommendation",
            "industry_supervisor_name": "person",
        }
        if key in kinds and str(answer).strip():
            if key == "duties":
                for index, line in enumerate(str(answer).splitlines(), start=1):
                    if line.strip():
                        rows.append(("duty", line.strip(), f"duty_{index}"))
            else:
                rows.append((kinds[key], str(answer).strip(), key))
    for kind, text_value, suffix in rows:
        source_field = key if suffix == key else f"{key}:{suffix}"
        Fact.objects.create(
            project=project, kind=kind, text=text_value, provenance="STUDENT_PROVIDED",
            evidence_quote=text_value, status="confirmed", source_field=source_field,
        )


class MissingInfoUpdateView(views.APIView):
    permission_classes = (IsAuthenticated,)

    @extend_schema(
        tags=['Projects'],
        summary='Update missing information targeted fields',
        description='Updates specific missing required fields (e.g. company address, training dates, department unit) without sending a full profile form.',
        request=OpenApiTypes.OBJECT,
        responses={200: OpenApiResponse(response=OpenApiTypes.OBJECT), 400: OpenApiResponse(description="Validation error")}
    )
    def patch(self, request, project_id):
        project = get_user_project(request.user, project_id)
        data = request.data
        
        field_mapping = {
            'full_name': 'full_name',
            'matric_number': 'matric_number',
            'university_name': 'university_name',
            'institution': 'university_name',
            'faculty': 'faculty_school',
            'college': 'college',
            'department': 'department',
            'degree': 'degree',
            'programme': 'programme',
            'organization_name': 'organization_name',
            'company_name': 'organization_name',
            'organization_address': 'organization_address',
            'company_address': 'organization_address',
            'training_start_date': 'training_start_date',
            'start_date': 'training_start_date',
            'training_end_date': 'training_end_date',
            'end_date': 'training_end_date',
            'placement_department': 'placement_department',
            'department_unit': 'placement_department',
            'industry_supervisor_name': 'industry_supervisor_name',
            'industry_supervisor': 'industry_supervisor_name',
            'academic_supervisor_name': 'academic_supervisor_name',
            'institution_supervisor': 'academic_supervisor_name',
        }

        from datetime import date
        for key, val in data.items():
            if key in field_mapping:
                target_field = field_mapping[key]
                if target_field in ['training_start_date', 'training_end_date'] and val:
                    try:
                        val = date.fromisoformat(str(val))
                    except ValueError:
                        return Response({"error": f"Invalid date format for '{key}'. Use YYYY-MM-DD."}, status=status.HTTP_400_BAD_REQUEST)
                setattr(project, target_field, val)

        project.save()
        from .completeness import check_project_completeness
        return Response(check_project_completeness(project), status=status.HTTP_200_OK)


@require_feature_flag('report_editor')
class SectionUpdateView(views.APIView):
    permission_classes = (IsAuthenticated,)

    @extend_schema(
        tags=['Report & Sections'],
        summary='Save student edits to a section',
        description='Saves updated section HTML/rich-text and flags section as customized by student with optimistic concurrency control.',
        request=SectionUpdateRequestSerializer,
        responses={200: ReportSectionSerializer, 409: OpenApiResponse(description="Concurrent edit conflict")}
    )
    def patch(self, request, project_id, section_id):
        project = get_user_project(request.user, project_id)
        section = get_object_or_404(ReportSection, id=section_id, report__project=project)
        
        expected_updated_at = request.data.get('expected_updated_at')
        force_overwrite = request.data.get('force_overwrite', False)
        if isinstance(force_overwrite, str):
            force_overwrite = force_overwrite.lower() in ('true', '1')

        if expected_updated_at and not force_overwrite and section.updated_at:
            try:
                import datetime
                cleaned_ts = str(expected_updated_at).replace('Z', '+00:00')
                client_dt = datetime.datetime.fromisoformat(cleaned_ts)
                diff = abs((section.updated_at - client_dt).total_seconds())
                if diff > 1.5:
                    return Response({
                        "error": "Conflict detected: This section was modified on another device or session.",
                        "conflict": True,
                        "current_content": section.content,
                        "current_title": section.title,
                        "current_updated_at": section.updated_at.isoformat(),
                    }, status=status.HTTP_409_CONFLICT)
            except Exception:
                pass

        content = request.data.get('content')
        if content is not None:
            section.content = sanitize_html(content)
            section.last_edited_by_student = True
        
        title = request.data.get('title')
        if title is not None:
            section.title = title

        section.save()
        report = section.report
        if content is not None and report.template_version == "lasustech_cs:2.0.0":
            class ParagraphTextParser(HTMLParser):
                def __init__(self):
                    super().__init__()
                    self.parts = []
                    self.current = ""

                def handle_starttag(self, tag, attrs):
                    if tag == "p" and self.current.strip():
                        self.parts.append(self.current.strip())
                        self.current = ""

                def handle_endtag(self, tag):
                    if tag == "p":
                        if self.current.strip():
                            self.parts.append(self.current.strip())
                        self.current = ""

                def handle_data(self, data):
                    self.current += data

            parser = ParagraphTextParser()
            parser.feed(section.content or "")
            if parser.current.strip():
                parser.parts.append(parser.current.strip())
            report.provenance_paragraphs.filter(section_key=section.section_key).delete()
            for order, paragraph_text in enumerate(parser.parts):
                ReportParagraph.objects.create(
                    report=report, section_key=section.section_key, order=order,
                    text=unescape(paragraph_text), student_confirmed=True, origin="STUDENT_EDITED",
                )
        from .document_model import model_from_sections
        report.document_model = model_from_sections(report, report.template_snapshot or {}).to_dict()
        report.save(update_fields=['document_model', 'updated_at'])
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


# --- Document Export Views & Async Job Pipeline ---

EXPORT_JOBS = {}  # In-memory job registry for async export polling: (project_id, fmt) -> dict


def _quality_gate_failure(report):
    from .document_quality import evaluate_report_quality
    quality = evaluate_report_quality(report)
    if quality["passed"]:
        return None
    return Response({
        "error": "This report is blocked from export. Fix the issues below, then try again.",
        "quality_gate": quality,
    }, status=422)


def _export_is_current(path, report):
    return path.exists() and path.stat().st_mtime >= report.updated_at.timestamp()


def run_export_background(project_id: int, fmt: str):
    """
    Background worker thread for asynchronous PDF/DOCX generation.
    """
    key = (project_id, fmt)
    EXPORT_JOBS[key] = {'status': 'processing', 'progress_percent': 35, 'error': None}
    try:
        from .models import ReportProject
        project = ReportProject.objects.filter(id=project_id).first()
        if not project or not hasattr(project, 'report'):
            EXPORT_JOBS[key] = {'status': 'failed', 'progress_percent': 0, 'error': 'Report not generated'}
            return

        if fmt == 'docx':
            path = generate_docx_report(project.report)
            EXPORT_JOBS[key] = {'status': 'ready', 'progress_percent': 100, 'error': None, 'path': path}
        else:
            res = export_report_documents(project.report)
            EXPORT_JOBS[key] = {'status': 'ready', 'progress_percent': 100, 'error': None, 'path': res['pdf_path']}
    except Exception as exc:
        from .document_quality import QualityGateError
        EXPORT_JOBS[key] = {
            'status': 'failed', 'progress_percent': 0, 'error': str(exc),
            'quality_gate': exc.result if isinstance(exc, QualityGateError) else None,
        }


class ExportStatusView(views.APIView):
    permission_classes = (IsAuthenticated,)

    def perform_content_negotiation(self, request, force=False):
        # Override to prevent DRF treating query parameter ?format=docx/pdf as media renderer
        renderers = self.get_renderers()
        return (renderers[0], renderers[0].media_type)

    @extend_schema(
        tags=['Document Export'],
        summary='Check asynchronous export status and generate signed download link',
        description='Polls asynchronous export progress for DOCX or PDF and returns signed download link.',
        request=ExportStatusRequestSerializer,
        responses={200: ExportStatusResponseSerializer}
    )
    def get(self, request, project_id):
        project = get_user_project(request.user, project_id)
        if not hasattr(project, 'report'):
            return Response({"error": "Report not generated yet."}, status=status.HTTP_400_BAD_REQUEST)

        blocked = _quality_gate_failure(project.report)
        if blocked:
            return blocked

        fmt = request.query_params.get('format', 'pdf').lower()
        if fmt not in ['pdf', 'docx']:
            return Response({"error": "Invalid format. Supported: pdf, docx."}, status=status.HTTP_400_BAD_REQUEST)

        # Check feature flags
        if fmt == 'pdf' and not is_feature_enabled('report_pdf_export'):
            return Response({"detail": "PDF export is currently disabled."}, status=status.HTTP_404_NOT_FOUND)
        if fmt == 'docx' and not is_feature_enabled('report_docx_export'):
            return Response({"detail": "DOCX export is currently disabled."}, status=status.HTTP_404_NOT_FOUND)

        trigger = request.query_params.get('trigger', 'false').lower() in ('true', '1')
        key = (project.id, fmt)

        clean_title = re.sub(r'[^a-zA-Z0-9_\-]', '_', project.title or "SIWES_Report")
        expected_filename = f"{clean_title}_v{project.report.version}.{fmt}"
        export_dir = Path(settings.MEDIA_ROOT) / "projects" / str(project.id) / "exports"
        file_path = export_dir / expected_filename

        job = EXPORT_JOBS.get(key)

        if _export_is_current(file_path, project.report) and (not trigger or (job and job.get('status') == 'ready')):
            signer = TimestampSigner(salt='report-export-download')
            token = signer.sign(f"{project.id}:{request.user.id}:{fmt}")
            download_url = f"/api/projects/{project.id}/export/download/?format={fmt}&token={token}"
            return Response({
                "project_id": project.id,
                "format": fmt,
                "status": "ready",
                "progress_percent": 100,
                "download_url": download_url,
                "filename": expected_filename,
                "error": None
            })

        if trigger and (not job or job.get('status') in ['failed', 'ready', 'idle']):
            t = threading.Thread(target=run_export_background, args=(project.id, fmt), daemon=True)
            t.start()
            return Response({
                "project_id": project.id,
                "format": fmt,
                "status": "processing",
                "progress_percent": 30,
                "download_url": None,
                "filename": expected_filename,
                "error": None
            })

        if job:
            status_val = job.get('status', 'processing')
            signer = TimestampSigner(salt='report-export-download')
            token = signer.sign(f"{project.id}:{request.user.id}:{fmt}")
            dl = f"/api/projects/{project.id}/export/download/?format={fmt}&token={token}" if status_val == 'ready' else None
            return Response({
                "project_id": project.id,
                "format": fmt,
                "status": status_val,
                "progress_percent": job.get('progress_percent', 50),
                "download_url": dl,
                "filename": expected_filename,
                "error": job.get('error'),
                "quality_gate": job.get('quality_gate'),
            })

        return Response({
            "project_id": project.id,
            "format": fmt,
            "status": "idle",
            "progress_percent": 0,
            "download_url": None,
            "filename": expected_filename,
            "error": None
        })


class ExportDownloadView(views.APIView):
    permission_classes = ()  # Allows token-based authorized access without Authorization header

    def perform_content_negotiation(self, request, force=False):
        # Override to prevent DRF treating query parameter ?format=docx/pdf as media renderer
        renderers = self.get_renderers()
        return (renderers[0], renderers[0].media_type)

    @extend_schema(
        tags=['Document Export'],
        summary='Download exported report file via authorized session or signed URL token',
        responses={(200, 'application/octet-stream'): OpenApiTypes.BINARY}
    )
    def get(self, request, project_id):
        token = request.query_params.get('token')
        fmt = request.query_params.get('format', 'pdf').lower()
        if fmt not in ['pdf', 'docx']:
            return Response({"error": "Invalid format. Supported: pdf, docx."}, status=status.HTTP_400_BAD_REQUEST)

        user = None
        if token:
            signer = TimestampSigner(salt='report-export-download')
            try:
                unsigned = signer.unsign(token, max_age=3600)
                tok_project_id, tok_user_id, tok_fmt = unsigned.split(':')
                if int(tok_project_id) != int(project_id) or tok_fmt != fmt:
                    return Response({"error": "Invalid export download token."}, status=status.HTTP_403_FORBIDDEN)
                from django.contrib.auth.models import User
                user = User.objects.filter(id=int(tok_user_id)).first()
                if not user:
                    return Response({"error": "User no longer exists."}, status=status.HTTP_403_FORBIDDEN)
            except (SignatureExpired, BadSignature, ValueError):
                return Response({"error": "Expired or invalid download link."}, status=status.HTTP_403_FORBIDDEN)
        else:
            if not request.user or not request.user.is_authenticated:
                return Response({"detail": "Authentication credentials were not provided."}, status=status.HTTP_401_UNAUTHORIZED)
            user = request.user

        project = get_user_project(user, project_id)
        if not hasattr(project, 'report'):
            raise Http404("Report not found.")
        blocked = _quality_gate_failure(project.report)
        if blocked:
            return blocked

        if fmt == 'pdf' and not is_feature_enabled('report_pdf_export'):
            return Response({"detail": "PDF export is currently disabled."}, status=status.HTTP_404_NOT_FOUND)
        if fmt == 'docx' and not is_feature_enabled('report_docx_export'):
            return Response({"detail": "DOCX export is currently disabled."}, status=status.HTTP_404_NOT_FOUND)

        clean_title = re.sub(r'[^a-zA-Z0-9_\-]', '_', project.title or "SIWES_Report")
        expected_filename = f"{clean_title}_v{project.report.version}.{fmt}"
        export_dir = Path(settings.MEDIA_ROOT) / "projects" / str(project.id) / "exports"
        file_path = export_dir / expected_filename

        if not _export_is_current(file_path, project.report):
            try:
                if fmt == 'docx':
                    generate_docx_report(project.report)
                else:
                    export_report_documents(project.report)
            except Exception as exc:
                from .document_quality import QualityGateError
                if isinstance(exc, QualityGateError):
                    return Response({"error": str(exc), "quality_gate": exc.result}, status=422)
                raise

        if not file_path.exists():
            raise Http404(f"Exported file {expected_filename} not found.")

        resolved_path = os.path.realpath(str(file_path))
        media_root = os.path.realpath(settings.MEDIA_ROOT)
        if not resolved_path.startswith(media_root):
            raise Http404("Access denied: Invalid export path.")

        content_type = 'application/pdf' if fmt == 'pdf' else 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        return FileResponse(
            open(resolved_path, 'rb'),
            as_attachment=True,
            filename=expected_filename,
            content_type=content_type
        )


@require_feature_flag('report_docx_export')
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
        blocked = _quality_gate_failure(project.report)
        if blocked:
            return blocked
        try:
            docx_path = generate_docx_report(project.report)
        except Exception as exc:
            from .document_quality import QualityGateError
            if isinstance(exc, QualityGateError):
                return Response({"error": str(exc), "quality_gate": exc.result}, status=422)
            raise
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


@require_feature_flag('report_pdf_export')
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
        blocked = _quality_gate_failure(project.report)
        if blocked:
            return blocked

        try:
            export_result = export_report_documents(project.report)
            pdf_path = export_result['pdf_path']
        except Exception as e:
            from .document_quality import QualityGateError
            if isinstance(e, QualityGateError):
                return Response({"error": str(e), "quality_gate": e.result}, status=422)
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

@require_feature_flag('defence_preparation')
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


@require_feature_flag('defence_preparation')
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



@require_feature_flag('defence_preparation')
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


@require_feature_flag('defence_preparation')
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


class ReportVersionListView(views.APIView):
    permission_classes = (IsAuthenticated,)

    @extend_schema(
        tags=['Report Versions'],
        summary='List report version snapshots',
        description='Returns the version history of the generated SIWES technical report with snapshot summaries.',
        responses={200: ReportVersionSerializer(many=True)}
    )
    def get(self, request, project_id):
        project = get_user_project(request.user, project_id)
        if not hasattr(project, 'report'):
            return Response([])
        versions = project.report.versions.all().order_by('-version_number', '-created_at')
        return Response(ReportVersionSerializer(versions, many=True).data)

    @extend_schema(
        tags=['Report Versions'],
        summary='Create manual report version snapshot',
        description='Takes a snapshot of current report sections and registers a new revision in version history.',
        request=ReportVersionCreateRequestSerializer,
        responses={201: ReportVersionSerializer}
    )
    def post(self, request, project_id):
        project = get_user_project(request.user, project_id)
        if not hasattr(project, 'report'):
            return Response({"error": "Report not generated yet."}, status=status.HTTP_400_BAD_REQUEST)

        report = project.report
        report.version += 1
        report.save(update_fields=['version'])

        summary = request.data.get('summary', f"Revision snapshot v{report.version}")
        snapshot = [
            {
                "id": s.id,
                "chapter_number": s.chapter_number,
                "section_key": s.section_key,
                "title": s.title,
                "content": s.content,
                "order": s.order,
            }
            for s in report.sections.all().order_by('chapter_number', 'order')
        ]
        version = ReportVersion.objects.create(
            report=report,
            version_number=report.version,
            title=report.title,
            sections_snapshot=snapshot,
            change_summary=summary
        )
        return Response(ReportVersionSerializer(version).data, status=status.HTTP_201_CREATED)


class ReportVersionRevertView(views.APIView):
    permission_classes = (IsAuthenticated,)

    @extend_schema(
        tags=['Report Versions'],
        summary='Revert report sections to a specific version snapshot',
        description='Restores report sections from a previously saved snapshot and increments version history.',
        request=None,
        responses={200: ReportSerializer}
    )
    def post(self, request, project_id, version_id):
        project = get_user_project(request.user, project_id)
        if not hasattr(project, 'report'):
            return Response({"error": "Report not found."}, status=status.HTTP_400_BAD_REQUEST)

        report = project.report
        version = get_object_or_404(ReportVersion, id=version_id, report=report)

        for sec_data in version.sections_snapshot:
            sec_key = sec_data.get('section_key')
            if not sec_key:
                continue
            section = report.sections.filter(section_key=sec_key).first()
            if section:
                section.content = sec_data.get('content', '')
                section.title = sec_data.get('title', section.title)
                section.last_edited_by_student = True
                section.save(update_fields=['content', 'title', 'last_edited_by_student'])

        report.version += 1
        report.save(update_fields=['version'])

        revert_snapshot = [
            {
                "id": s.id,
                "chapter_number": s.chapter_number,
                "section_key": s.section_key,
                "title": s.title,
                "content": s.content,
                "order": s.order,
            }
            for s in report.sections.all().order_by('chapter_number', 'order')
        ]
        ReportVersion.objects.create(
            report=report,
            version_number=report.version,
            title=report.title,
            sections_snapshot=revert_snapshot,
            change_summary=f"Reverted to v{version.version_number} ({version.change_summary})"
        )

        return Response(ReportSerializer(report).data)


@require_feature_flag('slide_generation')
class DefenceSlidesView(views.APIView):
    permission_classes = (IsAuthenticated,)

    @extend_schema(
        tags=['Defence Preparation'],
        summary='Get presentation slides',
        description='Returns structured presentation slides for oral defence and projection display.',
        responses={200: PresentationSlidesResponseSerializer}
    )
    def get(self, request, project_id):
        project = get_user_project(request.user, project_id)
        slides = project.presentation_slides
        if not slides:
            slides = generate_presentation_slides(project)
        return Response({
            "slides": slides,
            "total_slides": len(slides),
            "project_title": project.title
        })

    @extend_schema(
        tags=['Defence Preparation'],
        summary='Regenerate presentation slides',
        description='Regenerates the presentation slides based on latest verified logbook entries.',
        request=None,
        responses={200: PresentationSlidesResponseSerializer}
    )
    def post(self, request, project_id):
        project = get_user_project(request.user, project_id)
        slides = generate_presentation_slides(project)
        return Response({
            "slides": slides,
            "total_slides": len(slides),
            "project_title": project.title
        })


@require_feature_flag('defence_preparation')
class DefenceScriptView(views.APIView):
    permission_classes = (IsAuthenticated,)

    @extend_schema(
        tags=['Defence Preparation'],
        summary='Get timed oral presentation script',
        description='Returns a 5-7 minute timed oral defence presentation script tailored to the student.',
        responses={200: PresentationScriptResponseSerializer}
    )
    def get(self, request, project_id):
        project = get_user_project(request.user, project_id)
        script = project.presentation_script
        if not script:
            script = generate_presentation_script(project)
        return Response({
            "script": script,
            "estimated_duration_minutes": 7,
            "project_title": project.title
        })

    @extend_schema(
        tags=['Defence Preparation'],
        summary='Regenerate timed oral presentation script',
        request=None,
        responses={200: PresentationScriptResponseSerializer}
    )
    def post(self, request, project_id):
        project = get_user_project(request.user, project_id)
        script = generate_presentation_script(project)
        return Response({
            "script": script,
            "estimated_duration_minutes": 7,
            "project_title": project.title
        })


class PaymentOrderListCreateView(views.APIView):
    permission_classes = (IsAuthenticated,)

    @extend_schema(
        tags=['Payment & Delivery'],
        summary='List payment orders for this project',
        responses={200: PaymentOrderSerializer(many=True)}
    )
    def get(self, request, project_id):
        project = get_user_project(request.user, project_id)
        orders = project.payment_orders.all()
        return Response(PaymentOrderSerializer(orders, many=True).data)

    @extend_schema(
        tags=['Payment & Delivery'],
        summary='Record a payment or delivery order in database',
        request=PaymentOrderSerializer,
        responses={201: PaymentOrderSerializer}
    )
    def post(self, request, project_id):
        project = get_user_project(request.user, project_id)
        serializer = PaymentOrderSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        order = serializer.save(user=request.user, project=project)
        return Response(PaymentOrderSerializer(order).data, status=status.HTTP_201_CREATED)

