import os
from django.shortcuts import get_object_or_404
from django.http import FileResponse, Http404
from rest_framework import generics, status, views
from rest_framework.response import Response
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework_simplejwt.tokens import RefreshToken
from rest_framework_simplejwt.views import TokenObtainPairView
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer

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
    DefenceQuestionSerializer, DefenceSessionSerializer
)
from .document_processor import process_source_document
from .report_generator import generate_full_report, regenerate_single_section
from .document_exporter import generate_docx_report, export_report_documents
from .defence_generator import generate_defence_questions
from .ai_provider import get_ai_status


# --- Auth Views ---

class RegisterView(generics.CreateAPIView):
    permission_classes = (AllowAny,)
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
        data = super().validate(attrs)
        data['user'] = UserSerializer(self.user).data
        return data


class LoginView(TokenObtainPairView):
    permission_classes = (AllowAny,)
    serializer_class = CustomTokenObtainPairSerializer


class CurrentUserView(views.APIView):
    permission_classes = (IsAuthenticated,)

    def get(self, request):
        return Response(UserSerializer(request.user).data)


class AIStatusView(views.APIView):
    permission_classes = (IsAuthenticated,)

    def get(self, request):
        return Response(get_ai_status())


# --- Helper: Project Ownership Check ---

def get_user_project(user, project_id):
    return get_object_or_404(ReportProject, id=project_id, user=user)


# --- Project CRUD Views ---

class ProjectListCreateView(generics.ListCreateAPIView):
    permission_classes = (IsAuthenticated,)
    serializer_class = ReportProjectSerializer

    def get_queryset(self):
        return ReportProject.objects.filter(user=self.request.user)

    def perform_create(self, serializer):
        serializer.save(user=self.request.user)


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

    def get(self, request, project_id):
        project = get_user_project(request.user, project_id)
        docs = project.source_documents.all()
        serializer = SourceDocumentSerializer(docs, many=True)
        return Response(serializer.data)

    def post(self, request, project_id):
        project = get_user_project(request.user, project_id)
        
        file_obj = request.FILES.get('file')
        raw_text = request.data.get('text', '').strip()
        doc_type = request.data.get('file_type', '')

        if not file_obj and not raw_text:
            return Response({"error": "Either an upload file or typed text must be provided."}, status=status.HTTP_400_BAD_REQUEST)

        # File validation if file is provided
        if file_obj:
            if file_obj.size > 15 * 1024 * 1024:
                return Response({"error": "File size exceeds the 15MB limit."}, status=status.HTTP_400_BAD_REQUEST)
            
            ext = os.path.splitext(file_obj.name)[1].lower()
            if not doc_type:
                if ext == '.pdf':
                    doc_type = 'pdf'
                elif ext in ['.jpg', '.jpeg', '.png']:
                    doc_type = 'image'
                elif ext in ['.docx']:
                    doc_type = 'docx'
                else:
                    return Response({"error": f"Unsupported file extension: {ext}. Allowed: PDF, JPG, PNG, DOCX."}, status=status.HTTP_400_BAD_REQUEST)

            doc = SourceDocument.objects.create(
                project=project,
                file=file_obj,
                original_filename=file_obj.name,
                file_type=doc_type,
                file_size=file_obj.size,
                status='uploaded'
            )
        else:
            # Typed or pasted note
            doc_type = 'note'
            title = request.data.get('title', 'Manual Log Note')
            doc = SourceDocument.objects.create(
                project=project,
                original_filename=title,
                file_type='note',
                file_size=len(raw_text.encode('utf-8')),
                error_message=raw_text, # Passed to document processor
                status='uploaded'
            )

        # Process document
        process_source_document(doc.id)
        doc.refresh_from_db()
        return Response(SourceDocumentSerializer(doc).data, status=status.HTTP_201_CREATED)


class DocumentDetailView(views.APIView):
    permission_classes = (IsAuthenticated,)

    def delete(self, request, project_id, doc_id):
        project = get_user_project(request.user, project_id)
        doc = get_object_or_404(SourceDocument, id=doc_id, project=project)
        doc.delete()
        return Response({"message": "Source document deleted successfully."}, status=status.HTTP_204_NO_CONTENT)


class DocumentReprocessView(views.APIView):
    permission_classes = (IsAuthenticated,)

    def post(self, request, project_id, doc_id):
        project = get_user_project(request.user, project_id)
        doc = get_object_or_404(SourceDocument, id=doc_id, project=project)
        # Delete old extracted pages before reprocess
        doc.extracted_pages.all().delete()
        success = process_source_document(doc.id)
        doc.refresh_from_db()
        return Response(SourceDocumentSerializer(doc).data)


class PageUpdateView(views.APIView):
    permission_classes = (IsAuthenticated,)

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

    def get(self, request, project_id):
        project = get_user_project(request.user, project_id)
        entries = project.logbook_entries.all().order_by('week_number', 'order', 'entry_date', 'id')
        return Response(LogbookEntrySerializer(entries, many=True).data)

    def post(self, request, project_id):
        project = get_user_project(request.user, project_id)
        serializer = LogbookEntrySerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        entry = serializer.save(project=project)
        return Response(LogbookEntrySerializer(entry).data, status=status.HTTP_201_CREATED)


class LogbookEntryDetailView(views.APIView):
    permission_classes = (IsAuthenticated,)

    def patch(self, request, project_id, entry_id):
        project = get_user_project(request.user, project_id)
        entry = get_object_or_404(LogbookEntry, id=entry_id, project=project)
        serializer = LogbookEntrySerializer(entry, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data)

    def delete(self, request, project_id, entry_id):
        project = get_user_project(request.user, project_id)
        entry = get_object_or_404(LogbookEntry, id=entry_id, project=project)
        entry.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class LogbookBulkVerifyView(views.APIView):
    permission_classes = (IsAuthenticated,)

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

    def get(self, request, project_id):
        project = get_user_project(request.user, project_id)
        if not hasattr(project, 'report'):
            # Return empty response or initial skeleton
            return Response({"detail": "Report not yet generated."}, status=status.HTTP_404_NOT_FOUND)
        return Response(ReportSerializer(project.report).data)


class ReportGenerateView(views.APIView):
    permission_classes = (IsAuthenticated,)

    def post(self, request, project_id):
        project = get_user_project(request.user, project_id)
        force_all_val = request.data.get('force_all', False)
        force_all = force_all_val is True or str(force_all_val).lower() in ['true', '1']
        report = generate_full_report(project, force_all=force_all)
        return Response(ReportSerializer(report).data)


class SectionUpdateView(views.APIView):
    permission_classes = (IsAuthenticated,)

    def patch(self, request, project_id, section_id):
        project = get_user_project(request.user, project_id)
        section = get_object_or_404(ReportSection, id=section_id, report__project=project)
        
        content = request.data.get('content')
        if content is not None:
            section.content = content
            section.last_edited_by_student = True
        
        title = request.data.get('title')
        if title is not None:
            section.title = title

        section.save()
        return Response(ReportSectionSerializer(section).data)


class SectionRegenerateView(views.APIView):
    permission_classes = (IsAuthenticated,)

    def post(self, request, project_id, section_id):
        project = get_user_project(request.user, project_id)
        section = get_object_or_404(ReportSection, id=section_id, report__project=project)
        updated_section = regenerate_single_section(section)
        return Response(ReportSectionSerializer(updated_section).data)


# --- Document Export Views ---

class ExportDocxView(views.APIView):
    permission_classes = (IsAuthenticated,)

    def get(self, request, project_id):
        project = get_user_project(request.user, project_id)
        if not hasattr(project, 'report'):
            return Response({"error": "Report not generated yet."}, status=status.HTTP_400_BAD_REQUEST)
        
        docx_path = generate_docx_report(project.report)
        if not os.path.exists(docx_path):
            raise Http404("Document could not be generated.")

        filename = os.path.basename(docx_path)
        return FileResponse(
            open(docx_path, 'rb'),
            as_attachment=True,
            filename=filename,
            content_type='application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        )


class ExportPdfView(views.APIView):
    permission_classes = (IsAuthenticated,)

    def get(self, request, project_id):
        project = get_user_project(request.user, project_id)
        if not hasattr(project, 'report'):
            return Response({"error": "Report not generated yet."}, status=status.HTTP_400_BAD_REQUEST)

        try:
            export_result = export_report_documents(project.report)
            pdf_path = export_result['pdf_path']
        except Exception as e:
            return Response({"error": f"PDF export failed: {str(e)}"}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

        filename = os.path.basename(pdf_path)
        return FileResponse(
            open(pdf_path, 'rb'),
            as_attachment=True,
            filename=filename,
            content_type='application/pdf'
        )


# --- Defence Views ---

class DefenceGenerateView(views.APIView):
    permission_classes = (IsAuthenticated,)

    def post(self, request, project_id):
        project = get_user_project(request.user, project_id)
        questions = generate_defence_questions(project)
        return Response(DefenceQuestionSerializer(questions, many=True).data)


class DefenceQuestionListView(views.APIView):
    permission_classes = (IsAuthenticated,)

    def get(self, request, project_id):
        project = get_user_project(request.user, project_id)
        questions = project.defence_questions.all().order_by('order', 'id')
        return Response(DefenceQuestionSerializer(questions, many=True).data)


class DefenceQuestionDetailView(views.APIView):
    permission_classes = (IsAuthenticated,)

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

    def post(self, request, project_id):
        project = get_user_project(request.user, project_id)
        serializer = DefenceSessionSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        session = serializer.save(project=project)
        return Response(DefenceSessionSerializer(session).data, status=status.HTTP_201_CREATED)
