from django.contrib import admin
from .models import (
    ReportProject, ReportTemplate, SourceDocument, 
    ExtractedPage, LogbookEntry, Report, ReportSection, 
    DefenceQuestion, DefenceSession
)

@admin.register(ReportProject)
class ReportProjectAdmin(admin.ModelAdmin):
    list_display = ('id', 'title', 'user', 'matric_number', 'status', 'updated_at')
    list_filter = ('status', 'university_name', 'department')
    search_fields = ('title', 'full_name', 'matric_number', 'user__username')

@admin.register(SourceDocument)
class SourceDocumentAdmin(admin.ModelAdmin):
    list_display = ('id', 'project', 'original_filename', 'file_type', 'status', 'page_count', 'uploaded_at')
    list_filter = ('file_type', 'status')

@admin.register(ExtractedPage)
class ExtractedPageAdmin(admin.ModelAdmin):
    list_display = ('id', 'document', 'page_number', 'status', 'confidence_score', 'is_reviewed')
    list_filter = ('status', 'is_reviewed')

@admin.register(LogbookEntry)
class LogbookEntryAdmin(admin.ModelAdmin):
    list_display = ('id', 'project', 'week_number', 'entry_date', 'day_of_week', 'is_verified', 'is_flagged')
    list_filter = ('week_number', 'is_verified', 'is_flagged')

@admin.register(Report)
class ReportAdmin(admin.ModelAdmin):
    list_display = ('id', 'project', 'title', 'version', 'updated_at')

@admin.register(ReportSection)
class ReportSectionAdmin(admin.ModelAdmin):
    list_display = ('id', 'report', 'chapter_number', 'section_key', 'title', 'last_edited_by_student')
    list_filter = ('chapter_number', 'last_edited_by_student')

@admin.register(DefenceQuestion)
class DefenceQuestionAdmin(admin.ModelAdmin):
    list_display = ('id', 'project', 'category', 'mastery_status', 'is_flagged_hard')
    list_filter = ('category', 'mastery_status', 'is_flagged_hard')
