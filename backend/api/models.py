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
    college = models.CharField(max_length=255, blank=True)
    degree = models.CharField(max_length=255, blank=True)
    programme = models.CharField(max_length=255, blank=True)
    level = models.CharField(max_length=32, blank=True, default='400')

    # Institution
    university_name = models.CharField(
        max_length=255,
        blank=True,
        default=''
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

    # About your organisation (Part A) — student-provided details
    organisation_what = models.TextField(blank=True, help_text="What does the organisation do? (main products or services)")
    organisation_when_where = models.TextField(blank=True, help_text="When and how did it start? Where is it based?")
    organisation_objectives = models.TextField(blank=True, help_text="What is the organisation's mission, vision or main objectives?")
    organisation_structure = models.TextField(blank=True, help_text="Who heads the organisation (title)? What are the main departments or units? Which one did you work in? Who did you report to?")
    organisation_organogram = models.JSONField(default=dict, blank=True, help_text="Organogram tree or image reference")
    organisation_paste_source = models.CharField(max_length=255, blank=True, help_text="URL or path to pasted organisation text")
    organisation_paste_text = models.TextField(blank=True, help_text="Pasted text from the company's website or profile")

    # Technical Experience & Notes
    tools_used = models.TextField(blank=True)
    projects_undertaken = models.TextField(blank=True)
    tasks_performed = models.TextField(blank=True)
    problems_encountered = models.TextField(blank=True)
    skills_acquired = models.TextField(blank=True)
    guided_intake = models.JSONField(default=dict, blank=True)

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


def report_image_path(instance, filename):
    safe_name = get_safe_upload_filename(filename)
    return f"projects/{instance.project.id}/report-images/{safe_name}"


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


class LogbookPage(models.Model):
    """Reviewed transcript page; transcript text remains on ExtractedPage."""
    PAGE_TYPES = [(v, v.replace('_', ' ').title()) for v in (
        'cover', 'student_details', 'weekly_record', 'supervisor_remarks', 'other', 'blank')]
    extracted_page = models.OneToOneField(ExtractedPage, on_delete=models.CASCADE, related_name='record_page')
    page_index = models.PositiveIntegerField(db_index=True)
    page_type = models.CharField(max_length=32, choices=PAGE_TYPES, default='other')
    quality_score = models.FloatField(null=True, blank=True)
    signature_present = models.BooleanField(null=True, blank=True)
    stamp_present = models.BooleanField(null=True, blank=True)

    class Meta:
        ordering = ['page_index', 'id']

    @property
    def reviewed_text(self):
        return self.extracted_page.extracted_text


class WeekRecord(models.Model):
    project = models.ForeignKey(ReportProject, on_delete=models.CASCADE, related_name='week_records')
    week_number = models.PositiveIntegerField()
    start_date = models.DateField(null=True, blank=True)
    end_date = models.DateField(null=True, blank=True)
    sequence_warnings = models.JSONField(default=list, blank=True)
    source_pages = models.ManyToManyField(LogbookPage, related_name='week_records', blank=True)

    class Meta:
        ordering = ['week_number', 'id']
        constraints = [models.UniqueConstraint(fields=['project', 'week_number'], name='unique_project_week_record')]


class DayEntry(models.Model):
    week_record = models.ForeignKey(WeekRecord, on_delete=models.CASCADE, related_name='day_entries')
    date = models.DateField(null=True, blank=True)
    weekday = models.CharField(max_length=16, blank=True)
    text = models.TextField()
    source_page = models.ForeignKey(LogbookPage, on_delete=models.PROTECT, related_name='day_entries')
    source_span = models.JSONField(default=dict, blank=True)
    confidence = models.FloatField(null=True, blank=True)


class Fact(models.Model):
    KIND_CHOICES = [(v, v.replace('_', ' ').title()) for v in (
        'activity', 'tool', 'equipment', 'quantity', 'skill', 'duty', 'project', 'challenge',
        'solution', 'person', 'organisation_detail', 'recommendation', 'personal_statement')]
    PROVENANCE_CHOICES = [(v, v) for v in ('LOGBOOK', 'INFERRED', 'STUDENT_PROVIDED')]
    STATUS_CHOICES = [(v, v.title()) for v in ('proposed', 'confirmed', 'rejected')]
    project = models.ForeignKey(ReportProject, on_delete=models.CASCADE, related_name='facts')
    kind = models.CharField(max_length=32, choices=KIND_CHOICES)
    text = models.TextField()
    provenance = models.CharField(max_length=24, choices=PROVENANCE_CHOICES)
    source_entry_ids = models.ManyToManyField(DayEntry, related_name='facts', blank=True)
    evidence_quote = models.TextField(blank=True)
    inference_reason = models.TextField(blank=True)
    source_field = models.CharField(max_length=64, blank=True, db_index=True)
    status = models.CharField(max_length=16, choices=STATUS_CHOICES, default='proposed')
    validation_error = models.CharField(max_length=255, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)


class Report(models.Model):
    project = models.OneToOneField(ReportProject, on_delete=models.CASCADE, related_name='report')
    template = models.ForeignKey(ReportTemplate, on_delete=models.SET_NULL, null=True, blank=True)
    template_version = models.CharField(max_length=64, default='lasustech-standard:1.0.0')
    template_snapshot = models.JSONField(default=dict, blank=True)
    template_options = models.JSONField(default=dict, blank=True)
    document_model = models.JSONField(default=dict, blank=True)
    estimated_pages = models.IntegerField(default=1)
    page_estimate_breakdown = models.JSONField(default=dict, blank=True)
    actual_page_count = models.IntegerField(null=True, blank=True)
    page_range_status = models.CharField(
        max_length=20, blank=True, default='',
        help_text='within_range / over_limit / under_limit / not_rendered',
    )
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

    def clean(self):
        super().clean()
        if self.source_links and self.report and hasattr(self.report, "project_id"):
            from django.core.exceptions import ValidationError
            proj_id = self.report.project_id
            other_facts = Fact.objects.filter(id__in=self.source_links).exclude(project_id=proj_id)
            if other_facts.exists():
                raise ValidationError("ReportSection cannot cite facts from another project.")

    def save(self, *args, **kwargs):
        update_fields = kwargs.get("update_fields")
        if (update_fields is None or "source_links" in update_fields) and self.source_links and self.report and hasattr(self.report, "project_id"):
            proj_id = self.report.project_id
            other_facts = Fact.objects.filter(id__in=self.source_links).exclude(project_id=proj_id)
            if other_facts.exists():
                from django.core.exceptions import ValidationError
                raise ValidationError("ReportSection cannot cite facts from another project.")
            valid_ids = set(Fact.objects.filter(project_id=proj_id, id__in=self.source_links).values_list("id", flat=True))
            self.source_links = [fid for fid in self.source_links if fid in valid_ids]
        super().save(*args, **kwargs)

    class Meta:
        ordering = ['chapter_number', 'order', 'id']

    def __str__(self):
        return f"[{self.chapter_number}] {self.title}"


class ReportParagraph(models.Model):
    ORIGIN_CHOICES = [
        ("GUIDED_INTAKE", "Guided intake"),
        ("AI_GENERATED", "AI generated from confirmed facts"),
        ("STUDENT_EDITED", "Student edited"),
    ]
    report = models.ForeignKey(Report, on_delete=models.CASCADE, related_name='provenance_paragraphs')
    section_key = models.CharField(max_length=64)
    order = models.PositiveIntegerField(default=0)
    text = models.TextField()
    student_confirmed = models.BooleanField(default=False)
    origin = models.CharField(max_length=24, choices=ORIGIN_CHOICES, default="STUDENT_EDITED")
    facts = models.ManyToManyField(Fact, related_name='report_paragraphs', blank=True)


class ReportImage(models.Model):
    PLACEMENT_CHOICES = (
        ('organisation', 'Organisation section'),
        ('week', 'Weekly activity'),
        ('tools', 'Equipment and tools'),
        ('projects', 'Projects'),
        ('challenges', 'Challenges and solutions'),
    )

    project = models.ForeignKey(ReportProject, on_delete=models.CASCADE, related_name='report_images')
    original_file = models.FileField(upload_to=report_image_path)
    processed_file = models.FileField(upload_to=report_image_path)
    original_filename = models.CharField(max_length=255)
    caption = models.CharField(max_length=255)
    placement = models.CharField(max_length=32, choices=PLACEMENT_CHOICES, default='week')
    week_number = models.PositiveIntegerField(null=True, blank=True)
    order = models.PositiveIntegerField(default=0)
    width = models.PositiveIntegerField(default=0)
    height = models.PositiveIntegerField(default=0)
    low_resolution_warning = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['placement', 'week_number', 'order', 'id']

    def delete(self, *args, **kwargs):
        for field in (self.original_file, self.processed_file):
            if field and field.name:
                try:
                    field.delete(save=False)
                except OSError:
                    pass
        super().delete(*args, **kwargs)


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
    ]
    STATUS_CHOICES = [
        ('pending', 'Pending'),
        ('paid', 'Paid'),
        ('failed', 'Failed'),
        ('refunded', 'Refunded'),
        ('review_required', 'Review Required'),
    ]
    FULFILMENT_STATUS_CHOICES = [
        ('pending', 'Pending'),
        ('processing', 'Processing'),
        ('ready', 'Ready'),
        ('dispatched', 'Dispatched'),
        ('delivered', 'Delivered'),
        ('cancelled', 'Cancelled'),
    ]

    project = models.ForeignKey(ReportProject, on_delete=models.CASCADE, related_name='payment_orders')
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='payment_orders')
    order_type = models.CharField(max_length=20, choices=ORDER_TYPES)
    amount = models.DecimalField(max_digits=10, decimal_places=2, default=2000.00)
    amount_kobo = models.PositiveIntegerField(default=0)
    currency = models.CharField(max_length=3, default='NGN')
    payment_method = models.CharField(max_length=20, choices=PAYMENT_METHODS, default='card')
    transaction_reference = models.CharField(max_length=64, unique=True)
    squad_transaction_reference = models.CharField(max_length=128, blank=True, default='')
    order_reference = models.CharField(max_length=64, unique=True, blank=True, default='')
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='pending')
    fulfilment_status = models.CharField(max_length=20, choices=FULFILMENT_STATUS_CHOICES, default='pending')
    digital_files_unlocked = models.BooleanField(default=False)
    download_count = models.PositiveIntegerField(default=0)

    # Squad metadata (stores the full metadata dict passed to Squad)
    squad_metadata = models.JSONField(default=dict, blank=True)

    # Webhook tracking
    webhook_received_at = models.DateTimeField(null=True, blank=True)
    paid_at = models.DateTimeField(null=True, blank=True)

    # Callback URL for Squad redirect
    callback_url = models.URLField(blank=True, default='')

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

    def save(self, *args, **kwargs):
        if not self.transaction_reference:
            import uuid
            self.transaction_reference = f"L2D_TXN_{uuid.uuid4().hex[:12]}"
        if self.amount and not self.amount_kobo:
            self.amount_kobo = int(self.amount * 100)
        super().save(*args, **kwargs)
        # Generate stable order_reference now that id is known
        if not self.order_reference:
            self.order_reference = f"L2D-ORD-{self.pk:06d}"
            super().save(update_fields=['order_reference'])


class SquadWebhookEvent(models.Model):
    """Tracks processed Squad webhook events for idempotency."""
    event_id = models.CharField(max_length=128, unique=True)
    transaction_reference = models.CharField(max_length=128, blank=True, default='')
    event_type = models.CharField(max_length=64, blank=True, default='')
    payload = models.JSONField(default=dict, blank=True)
    processed_at = models.DateTimeField(auto_now_add=True)
    success = models.BooleanField(default=False)
    error_message = models.TextField(blank=True, default='')

    class Meta:
        ordering = ['-processed_at']

    def __str__(self):
        return f"{self.event_id} - {self.event_type} - {'ok' if self.success else 'failed'}"


class TelegramNotificationLog(models.Model):
    """Tracks Telegram payment notifications for deduplication and retries.

    One row per order_reference. status='sent' means a notification was
    successfully delivered; duplicate sends for the same order are skipped.
    """

    STATUS_CHOICES = [
        ('sent', 'Sent'),
        ('failed', 'Failed'),
    ]

    order_reference = models.CharField(max_length=64, unique=True, db_index=True)
    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default='failed')
    attempt_count = models.PositiveIntegerField(default=0)
    last_error = models.TextField(blank=True, default='')
    sent_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-updated_at']

    def __str__(self):
        return f"{self.order_reference} - {self.status} (attempts: {self.attempt_count})"


class UserAnalyticsEvent(models.Model):
    """Tracks wizard step completion, screen views, and drop-offs."""
    project = models.ForeignKey(ReportProject, on_delete=models.CASCADE, null=True, blank=True, related_name='analytics_events')
    user = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True, related_name='analytics_events')
    step_name = models.CharField(max_length=64, db_index=True)
    screen_id = models.CharField(max_length=64, blank=True, default='')
    event_type = models.CharField(max_length=64, db_index=True)  # e.g. screen_viewed, step_completed, step_skipped, drop_off
    metadata = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f"{self.step_name}:{self.screen_id} - {self.event_type} ({self.created_at})"


from django.db.models.signals import m2m_changed
from django.dispatch import receiver


@receiver(m2m_changed, sender=ReportParagraph.facts.through)
def validate_report_paragraph_facts_isolation(sender, instance, action, pk_set, **kwargs):
    """Enforce strict multi-tenant isolation: a ReportParagraph cannot cite Facts from another project."""
    if action == "pre_add" and pk_set and instance and hasattr(instance, "report"):
        from django.core.exceptions import ValidationError
        proj_id = instance.report.project_id
        foreign_facts = Fact.objects.filter(id__in=pk_set).exclude(project_id=proj_id)
        if foreign_facts.exists():
            foreign_ids = list(foreign_facts.values_list("id", flat=True))
            raise ValidationError(f"ReportParagraph cannot cite Facts belonging to another project or user. Foreign Fact IDs: {foreign_ids}")

