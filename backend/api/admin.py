from django.contrib import admin
from django.contrib.auth.models import User
from django.contrib.auth.admin import UserAdmin as BaseUserAdmin
from django.utils.html import format_html
from .enums import UserTier
from .models import (
    StudentProfile, ReportProject, ReportTemplate, SourceDocument, 
    ExtractedPage, LogbookEntry, Report, ReportSection, 
    DefenceQuestion, DefenceSession
)


class StudentProfileInline(admin.StackedInline):
    model = StudentProfile
    can_delete = False
    verbose_name_plural = 'Student Profile (Tier & Preferences)'
    fields = ('tier', 'preferred_university')


# Re-register UserAdmin with inline and tier actions
admin.site.unregister(User)

@admin.register(User)
class CustomUserAdmin(BaseUserAdmin):
    inlines = (StudentProfileInline,)
    list_display = ('username', 'email', 'first_name', 'last_name', 'get_tier_badge', 'is_staff')
    list_filter = ('student_profile__tier', 'is_staff', 'is_superuser', 'is_active')
    actions = ['set_to_pro_tier', 'set_to_basic_tier']

    @admin.display(description='Tier', ordering='student_profile__tier')
    def get_tier_badge(self, obj):
        profile = getattr(obj, 'student_profile', None)
        tier = profile.tier if profile else UserTier.BASIC
        if tier == UserTier.PRO:
            return format_html('<span style="color: #15803d; font-weight: 700; background: #dcfce7; padding: 2px 8px; border-radius: 4px;">PRO</span>')
        return format_html('<span style="color: #475569; font-weight: 600; background: #f1f5f9; padding: 2px 8px; border-radius: 4px;">BASIC</span>')

    @admin.action(description='Switch selected users to PRO tier')
    def set_to_pro_tier(self, request, queryset):
        for user in queryset:
            profile, _ = StudentProfile.objects.get_or_create(user=user)
            profile.tier = UserTier.PRO
            profile.save(update_fields=['tier'])
            # Also update the user's active projects to pro
            user.projects.all().update(tier=UserTier.PRO)
        self.message_user(request, f"Updated {queryset.count()} user(s) to PRO tier.")

    @admin.action(description='Switch selected users to BASIC tier')
    def set_to_basic_tier(self, request, queryset):
        for user in queryset:
            profile, _ = StudentProfile.objects.get_or_create(user=user)
            profile.tier = UserTier.BASIC
            profile.save(update_fields=['tier'])
            # Also update user's projects to basic
            user.projects.all().update(tier=UserTier.BASIC)
        self.message_user(request, f"Updated {queryset.count()} user(s) to BASIC tier.")


@admin.register(StudentProfile)
class StudentProfileAdmin(admin.ModelAdmin):
    list_display = ('id', 'user', 'tier', 'preferred_university', 'created_at', 'updated_at')
    list_filter = ('tier',)
    search_fields = ('user__username', 'user__email', 'preferred_university')
    list_editable = ('tier',)
    actions = ['set_to_pro_tier', 'set_to_basic_tier']

    @admin.action(description='Switch selected profiles to PRO tier')
    def set_to_pro_tier(self, request, queryset):
        count = queryset.update(tier=UserTier.PRO)
        self.message_user(request, f"Updated {count} profile(s) to PRO tier.")

    @admin.action(description='Switch selected profiles to BASIC tier')
    def set_to_basic_tier(self, request, queryset):
        count = queryset.update(tier=UserTier.BASIC)
        self.message_user(request, f"Updated {count} profile(s) to BASIC tier.")


@admin.register(ReportProject)
class ReportProjectAdmin(admin.ModelAdmin):
    list_display = ('id', 'title', 'user', 'tier', 'status', 'matric_number', 'updated_at')
    list_filter = ('tier', 'status', 'university_name', 'department')
    search_fields = ('title', 'full_name', 'matric_number', 'user__username')
    list_editable = ('tier',)
    actions = ['set_to_pro_tier', 'set_to_basic_tier']

    @admin.action(description='Switch selected projects to PRO tier')
    def set_to_pro_tier(self, request, queryset):
        count = queryset.update(tier=UserTier.PRO)
        self.message_user(request, f"Updated {count} project(s) to PRO tier.")

    @admin.action(description='Switch selected projects to BASIC tier')
    def set_to_basic_tier(self, request, queryset):
        count = queryset.update(tier=UserTier.BASIC)
        self.message_user(request, f"Updated {count} project(s) to BASIC tier.")


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
