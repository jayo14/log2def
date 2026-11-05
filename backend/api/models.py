from django.db import models
from django.contrib.auth.models import User
from django.conf import settings
from pathlib import Path
import os
import shutil
from .security import get_safe_upload_filename


class StudentProfile(models.Model):
    """Extra student attributes that do not fit the stock Django User model."""

    user = models.OneToOneField(User, on_delete=models.CASCADE, related_name='student_profile')
    preferred_university = models.CharField(max_length=255, blank=True, default='')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"Profile for {self.user.username}"

class ReportProject(models.Model):
    STATUS_CHOICES = (
        ('draft', 'Draft'),
        ('uploading', 'Uploading Sources'),
        ('reviewing_sources', 'Reviewing Sources'),
        ('generating', 'Generating Report'),
        ('editing_report', 'Editing Report'),
        ('ready_for_review', 'Ready for Review'),
        ('exported', 'Exported'),
    )

    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='projects')
    title = models.CharField(max_length=255, default='SIWES Technical Report')
    status = models.CharField(max_length=32, choices=STATUS_CHOICES, default='draft')

    # Student Information
    full_name = models.CharField(max_length=255, blank=True)
    matric_number = models.CharField(max_length=64, blank=True)
    department = models.CharField(max_length=255, blank=True)
    programme = models.CharField(max_length=255, blank=True)
    level = models.CharField(max_length=32, blank=True, default='400')

    # Institution
    university_name = models.CharField(
        max_length=255, 
        default='Lagos State University of Science and Technology (LASUSTECH)'
    )
    faculty_school = models.CharField(max_length=255, blank=True)
    department_requirements = models.TextField(blank=True)
    guideline_preset = models.CharField(max_length=64, default='lasustech', blank=True)
    custom_guideline_file = models.FileField(upload_to='guidelines/', null=True, blank=True)
    custom_guideline_extracted = models.TextField(blank=True)

    # Industrial Placement
    organization_name = models.CharField(max_length=255, blank=True)
    organization_address = models.TextField(blank=True)
    placement_department = models.CharField(max_length=255, blank=True)
    industry_supervisor_name = models.CharField(max_length=255, blank=True)
    industry_supervisor_title = models.CharField(max_length=255, blank=True)
    academic_supervisor_name = models.CharField(max_length=255, blank=True)
    training_start_date = models.DateField(null=True, blank=True)
    training_end_date = models.DateField(null=True, blank=True)
    organization_activities = models.TextField(blank=True)

    # Technical Experience & Notes
    tools_used = models.TextField(blank=True)
    projects_undertaken = models.TextField(blank=True)
    tasks_performed = models.TextField(blank=True)
    problems_encountered = models.TextField(blank=True)
    skills_acquired = models.TextField(blank=True)

    # Defence Presentation Assets
    presentation_slides = models.JSONField(default=list, blank=True)
    presentation_script = models.TextField(blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-updated_at']

    def __str__(self):
        return f"{self.title} - {self.full_name or self.user.username}"

    def delete(self, *args, **kwargs):
        # Cascade cleanup: delete all project files and directories from disk
        project_dir = Path(settings.MEDIA_ROOT) / "projects" / str(self.id)
        if project_dir.exists():
            shutil.rmtree(str(project_dir), ignore_errors=True)
        super().delete(*args, **kwargs)


class ReportTemplate(models.Model):
    name = models.CharField(max_length=255)
    code = models.CharField(max_length=64)
    version = models.CharField(max_length=32, default='1.0.0')
    description = models.TextField(blank=True)
    is_default = models.BooleanField(default=False)
    required_fields = models.JSONField(default=list, blank=True)
    section_order = models.JSONField(default=list, blank=True)
    formatting_spec = models.JSONField(default=dict, blank=True)
    structure = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ('code', 'version')

    def __str__(self):
        return f"{self.name} (v{self.version})"


def source_doc_path(instance, filename):
    safe_name = get_safe_upload_filename(filename)
    return f"projects/{instance.project.id}/sources/{safe_name}"


class SourceDocument(models.Model):
    TYPE_CHOICES = (
        ('pdf', 'PDF Document'),
        ('image', 'Scanned / Photo Image'),
        ('docx', 'Word Document'),
        ('note', 'Typed / Pasted Note'),
    )
    STATUS_CHOICES = (
        ('uploaded', 'Uploaded'),
        ('processing', 'Processing'),
        ('completed', 'Completed'),
        ('error', 'Error'),
    )

    project = models.ForeignKey(ReportProject, on_delete=models.CASCADE, related_name='source_documents')
    file = models.FileField(upload_to=source_doc_path, null=True, blank=True)
    original_filename = models.CharField(max_length=255)
    file_type = models.CharField(max_length=32, choices=TYPE_CHOICES)
    file_size = models.IntegerField(default=0)
    page_count = models.IntegerField(default=1)
    page_index = models.IntegerField(default=0, db_index=True)
    client_upload_id = models.CharField(max_length=128, blank=True, db_index=True)
    status = models.CharField(max_length=32, choices=STATUS_CHOICES, default='uploaded')
    error_message = models.TextField(blank=True)
    uploaded_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['page_index', 'uploaded_at']

    def __str__(self):
        return f"{self.original_filename} ({self.file_type}) - Project {self.project_id}"

    def delete(self, *args, **kwargs):
        if self.file and os.path.isfile(self.file.path):
            try:
                os.remove(self.file.path)
            except OSError:
                pass
        super().delete(*args, **kwargs)


class ExtractedPage(models.Model):
    STATUS_CHOICES = (
        ('pending', 'Pending Review'),
        ('ocr_in_progress', 'OCR In Progress'),
        ('structuring', 'Structuring Logbook Data'),
        ('processed', 'Processed'),
        ('completed', 'Completed'),
        ('flagged_illegible', 'Flagged Illegible'),
        ('manual_correction_needed', 'Manual Correction Needed'),
        ('error', 'Processing Error'),
    )

    document = models.ForeignKey(SourceDocument, on_delete=models.CASCADE, related_name='extracted_pages')
    page_number = models.IntegerField(default=1)
    page_index = models.IntegerField(default=0, db_index=True)
    extracted_text = models.TextField(blank=True)
    confidence_score = models.FloatField(default=1.0)
    status = models.CharField(max_length=32, choices=STATUS_CHOICES, default='processed')
    is_reviewed = models.BooleanField(default=False)
    notes = models.TextField(blank=True)
    retry_count = models.IntegerField(default=0)
    error_reason = models.TextField(blank=True)
    low_confidence_segments = models.JSONField(default=list, blank=True)
    supervisor_signature_detected = models.BooleanField(default=False)
    supervisor_signature_confidence = models.FloatField(default=0.0)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['document', 'page_number']

    def __str__(self):
        return f"Page {self.page_number} of {self.document.original_filename}"


class LogbookEntry(models.Model):
    PROVENANCE_RECORDED = 'RECORDED'
    PROVENANCE_INFERRED = 'INFERRED'
    PROVENANCE_MISSING = 'MISSING'

    project = models.ForeignKey(ReportProject, on_delete=models.CASCADE, related_name='logbook_entries')
    source_page = models.ForeignKey(
        ExtractedPage, 
        on_delete=models.SET_NULL, 
        null=True, 
        blank=True, 
        related_name='logbook_entries'
    )
    week_number = models.IntegerField(default=1)
    entry_date = models.DateField(null=True, blank=True)
    day_of_week = models.CharField(max_length=32, blank=True)
    department_unit = models.CharField(max_length=255, blank=True)
    raw_text = models.TextField(blank=True)
    verified_text = models.TextField(blank=True)
    activity_summary = models.CharField(max_length=500, blank=True)
    tools_used = models.CharField(max_length=500, blank=True)
    equipment_used = models.CharField(max_length=500, blank=True)
    technical_area = models.CharField(max_length=255, blank=True)
    has_supervisor_signature = models.BooleanField(default=False)
    confidence_scores = models.JSONField(default=dict, blank=True)
    field_provenance = models.JSONField(default=dict, blank=True)
    is_verified = models.BooleanField(default=False)
    is_flagged = models.BooleanField(default=False)
    order = models.IntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['week_number', 'order', 'entry_date', 'id']

    def __str__(self):
        return f"Week {self.week_number} ({self.day_of_week or 'Entry'}): {self.activity_summary[:40]}"


class Report(models.Model):
    project = models.OneToOneField(ReportProject, on_delete=models.CASCADE, related_name='report')
    template = models.ForeignKey(ReportTemplate, on_delete=models.SET_NULL, null=True, blank=True)
    template_version = models.CharField(max_length=64, default='lasustech-standard:1.0.0')
    template_snapshot = models.JSONField(default=dict, blank=True)
    document_model = models.JSONField(default=dict, blank=True)
    estimated_pages = models.IntegerField(default=1)
    page_estimate_breakdown = models.JSONField(default=dict, blank=True)
    readiness_feedback = models.JSONField(default=list, blank=True)
    title = models.CharField(max_length=255, default='SIWES Technical Report')
    version = models.IntegerField(default=1)
    docx_file = models.FileField(upload_to=f'projects/exports/docx/', null=True, blank=True)
    pdf_file = models.FileField(upload_to=f'projects/exports/pdf/', null=True, blank=True)
    last_exported_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"Report for {self.project.title}"


class ReportSection(models.Model):
    report = models.ForeignKey(Report, on_delete=models.CASCADE, related_name='sections')
    section_key = models.CharField(max_length=64)
    chapter_number = models.IntegerField(default=0)  # 0=Front matter, 1-5=Chapters, 6=Appendices/Refs
    title = models.CharField(max_length=255)
    content = models.TextField(blank=True)
    order = models.IntegerField(default=0)
    is_required = models.BooleanField(default=True)
    warnings = models.JSONField(default=list, blank=True)
    source_links = models.JSONField(default=list, blank=True)
    last_edited_by_student = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['chapter_number', 'order', 'id']

    def __str__(self):
        return f"[{self.chapter_number}] {self.title}"


class ReportVersion(models.Model):
    report = models.ForeignKey(Report, on_delete=models.CASCADE, related_name='versions')
    version_number = models.IntegerField(default=1)
    title = models.CharField(max_length=255, default='SIWES Technical Report')
    sections_snapshot = models.JSONField(default=list)
    change_summary = models.CharField(max_length=255, default='Snapshot')
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-version_number', '-created_at']

    def __str__(self):
        return f"v{self.version_number} - {self.change_summary} ({self.created_at.strftime('%Y-%m-%d %H:%M')})"


class DefenceQuestion(models.Model):
    CATEGORY_CHOICES = (
        ('organization', 'Organization & Objectives'),
        ('training_objectives', 'Training Objectives'),
        ('tasks_and_projects', 'Tasks & Projects Undertaken'),
        ('technical_tools', 'Tools & Technologies'),
        ('challenges_troubleshooting', 'Challenges & Solutions'),
        ('examiner_followup', 'Examiner Cross-Examination & Understanding'),
    )

    MASTERY_CHOICES = (
        ('unanswered', 'Unanswered'),
        ('needs_practice', 'Needs Practice'),
        ('confident', 'Confident'),
    )

    project = models.ForeignKey(ReportProject, on_delete=models.CASCADE, related_name='defence_questions')
    category = models.CharField(max_length=64, choices=CATEGORY_CHOICES, default='tasks_and_projects')
    question = models.TextField()
    suggested_answer = models.TextField()
    grounded_context = models.TextField(blank=True)
    is_flagged_hard = models.BooleanField(default=False)
    mastery_status = models.CharField(max_length=32, choices=MASTERY_CHOICES, default='unanswered')
    order = models.IntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['category', 'order', 'id']

    def __str__(self):
        return f"{self.category}: {self.question[:50]}"


class DefenceSession(models.Model):
    project = models.ForeignKey(ReportProject, on_delete=models.CASCADE, related_name='defence_sessions')
    questions_attempted = models.IntegerField(default=0)
    confident_count = models.IntegerField(default=0)
    needs_practice_count = models.IntegerField(default=0)
    notes = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']


class PaymentOrder(models.Model):
    ORDER_TYPES = [
        ('digital', 'Digital Report Download (NGN 2,000)'),
        ('delivery', 'Physical Print & Spiral Binding Delivery (NGN 4,000)'),
    ]
    PAYMENT_METHODS = [
        ('card', 'Debit / Credit Card'),
        ('transfer', 'Bank Transfer'),
        ('ussd', 'USSD'),
    ]
    STATUS_CHOICES = [
        ('pending', 'Pending'),
        ('paid', 'Paid'),
        ('failed', 'Failed'),
    ]

    project = models.ForeignKey(ReportProject, on_delete=models.CASCADE, related_name='payment_orders')
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='payment_orders')
    order_type = models.CharField(max_length=20, choices=ORDER_TYPES)
    amount = models.DecimalField(max_digits=10, decimal_places=2, default=2000.00)
    payment_method = models.CharField(max_length=20, choices=PAYMENT_METHODS, default='card')
    transaction_reference = models.CharField(max_length=64, unique=True)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='paid')

    # Delivery details (for order_type == 'delivery')
    recipient_name = models.CharField(max_length=255, blank=True, default='')
    phone_number = models.CharField(max_length=32, blank=True, default='')
    campus_location = models.CharField(max_length=255, blank=True, default='')
    custom_address = models.TextField(blank=True, default='')
    delivery_date = models.CharField(max_length=32, blank=True, default='')
    notes = models.TextField(blank=True, default='')

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f"{self.project_id} - {self.order_type} - {self.transaction_reference} ({self.status})"

