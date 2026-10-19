from rest_framework import serializers
from django.contrib.auth.models import User
from django.contrib.auth.password_validation import validate_password
from drf_spectacular.utils import extend_schema_field
from .models import (
    ReportProject, ReportTemplate, SourceDocument, 
    ExtractedPage, LogbookEntry, Report, ReportSection, ReportVersion,
    DefenceQuestion, DefenceSession
)


class UserRegistrationSerializer(serializers.ModelSerializer):
    username = serializers.CharField(required=False, allow_blank=True)
    email = serializers.EmailField(required=True)
    full_name = serializers.CharField(required=False, write_only=True, allow_blank=True)
    password = serializers.CharField(write_only=True, required=True, validators=[validate_password])
    password_confirm = serializers.CharField(write_only=True, required=True)

    class Meta:
        model = User
        fields = ('id', 'username', 'email', 'full_name', 'first_name', 'last_name', 'password', 'password_confirm')

    def validate(self, attrs):
        if attrs['password'] != attrs['password_confirm']:
            raise serializers.ValidationError({"password": "Password fields did not match."})

        email = attrs.get('email', '').strip().lower()
        if not email:
            raise serializers.ValidationError({"email": "Email address is required."})
        if User.objects.filter(email__iexact=email).exists():
            raise serializers.ValidationError({"email": "A user with this email address already exists."})
        attrs['email'] = email

        # Handle full_name parsing
        full_name = attrs.pop('full_name', '').strip()
        if full_name and not attrs.get('first_name'):
            parts = full_name.split(maxsplit=1)
            attrs['first_name'] = parts[0]
            attrs['last_name'] = parts[1] if len(parts) > 1 else ''

        # Auto-generate unique username if omitted
        if not attrs.get('username'):
            import re
            base_raw = email.split('@')[0]
            base_cleaned = re.sub(r'[^a-zA-Z0-9_]', '_', base_raw)[:25] or 'student'
            candidate = base_cleaned
            idx = 1
            while User.objects.filter(username=candidate).exists():
                candidate = f"{base_cleaned}_{idx}"
                idx += 1
            attrs['username'] = candidate

        return attrs

    def create(self, validated_data):
        validated_data.pop('password_confirm')
        user = User.objects.create_user(
            username=validated_data['username'],
            email=validated_data.get('email', ''),
            first_name=validated_data.get('first_name', ''),
            last_name=validated_data.get('last_name', ''),
            password=validated_data['password']
        )
        return user


class UserSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = ('id', 'username', 'email', 'first_name', 'last_name')


class ExtractedPageSerializer(serializers.ModelSerializer):
    class Meta:
        model = ExtractedPage
        fields = '__all__'


class SourceDocumentSerializer(serializers.ModelSerializer):
    extracted_pages = ExtractedPageSerializer(many=True, read_only=True)

    class Meta:
        model = SourceDocument
        fields = '__all__'
        read_only_fields = ('file_size', 'page_count', 'status', 'error_message', 'uploaded_at')


class LogbookEntrySerializer(serializers.ModelSerializer):
    class Meta:
        model = LogbookEntry
        fields = '__all__'
        read_only_fields = ('created_at', 'updated_at')


class ReportSectionSerializer(serializers.ModelSerializer):
    class Meta:
        model = ReportSection
        fields = '__all__'
        read_only_fields = ('created_at', 'updated_at')


class ReportVersionSerializer(serializers.ModelSerializer):
    class Meta:
        model = ReportVersion
        fields = '__all__'
        read_only_fields = ('version_number', 'created_at')


class ReportSerializer(serializers.ModelSerializer):
    sections = ReportSectionSerializer(many=True, read_only=True)
    versions = ReportVersionSerializer(many=True, read_only=True)

    class Meta:
        model = Report
        fields = '__all__'
        read_only_fields = ('version', 'created_at', 'updated_at', 'docx_file', 'pdf_file', 'last_exported_at')


class DefenceQuestionSerializer(serializers.ModelSerializer):
    class Meta:
        model = DefenceQuestion
        fields = '__all__'
        read_only_fields = ('created_at', 'updated_at')


class DefenceSessionSerializer(serializers.ModelSerializer):
    class Meta:
        model = DefenceSession
        fields = '__all__'
        read_only_fields = ('created_at', 'project')


class ReportProjectSerializer(serializers.ModelSerializer):
    source_documents_count = serializers.IntegerField(source='source_documents.count', read_only=True)
    logbook_entries_count = serializers.IntegerField(source='logbook_entries.count', read_only=True)
    has_report = serializers.SerializerMethodField()

    class Meta:
        model = ReportProject
        fields = '__all__'
        read_only_fields = ('user', 'created_at', 'updated_at')

    @extend_schema_field(serializers.BooleanField)
    def get_has_report(self, obj):
        return hasattr(obj, 'report')


class ReportProjectDetailSerializer(serializers.ModelSerializer):
    source_documents = SourceDocumentSerializer(many=True, read_only=True)
    logbook_entries = LogbookEntrySerializer(many=True, read_only=True)
    report = ReportSerializer(read_only=True)
    defence_questions = DefenceQuestionSerializer(many=True, read_only=True)

    class Meta:
        model = ReportProject
        fields = '__all__'
        read_only_fields = ('user', 'created_at', 'updated_at')


# --- Documentation & Request Helper Serializers ---

class DocumentUploadRequestSerializer(serializers.Serializer):
    file = serializers.FileField(required=False, help_text="Upload scanned or digital file (PDF, JPG, PNG, DOCX)")
    text = serializers.CharField(required=False, help_text="Direct typed or pasted logbook notes")
    title = serializers.CharField(required=False, default="Manual Log Note", help_text="Title for typed note")
    file_type = serializers.ChoiceField(
        choices=['pdf', 'image', 'docx', 'note'], 
        required=False, 
        help_text="Optional explicit document type override"
    )


class ReportGenerateRequestSerializer(serializers.Serializer):
    force_all = serializers.BooleanField(
        required=False, 
        default=False, 
        help_text="Set to true to force regenerate all sections and overwrite student edits"
    )


class BulkVerifyRequestSerializer(serializers.Serializer):
    entry_ids = serializers.ListField(
        child=serializers.IntegerField(), 
        required=False, 
        help_text="Optional list of specific entry IDs to verify. If omitted, all entries are verified."
    )


class SectionUpdateRequestSerializer(serializers.Serializer):
    content = serializers.CharField(required=False, help_text="Updated HTML / rich-text content for the section")
    title = serializers.CharField(required=False, help_text="Updated title for the section")


class DefenceQuestionUpdateRequestSerializer(serializers.Serializer):
    mastery_status = serializers.ChoiceField(
        choices=['unanswered', 'needs_practice', 'confident'], 
        required=False, 
        help_text="Mastery self-assessment rating"
    )
    is_flagged_hard = serializers.BooleanField(
        required=False, 
        help_text="Flag question for prioritized revision"
    )


class ReportVersionCreateRequestSerializer(serializers.Serializer):
    summary = serializers.CharField(
        required=False, 
        default="Manual revision snapshot", 
        help_text="Description or summary of this report revision"
    )


class PresentationSlideSerializer(serializers.Serializer):
    slide_number = serializers.IntegerField()
    title = serializers.CharField()
    subtitle = serializers.CharField(required=False, allow_blank=True)
    bullets = serializers.ListField(child=serializers.CharField(), required=False)
    speaker_notes = serializers.CharField(required=False, allow_blank=True)
    layout = serializers.CharField(required=False, default="bullets")


class PresentationSlidesResponseSerializer(serializers.Serializer):
    slides = serializers.ListField(child=serializers.DictField())
    total_slides = serializers.IntegerField()
    project_title = serializers.CharField()


class PresentationScriptResponseSerializer(serializers.Serializer):
    script = serializers.CharField()
    estimated_duration_minutes = serializers.IntegerField(default=7)
    project_title = serializers.CharField()


class AIStatusResponseSerializer(serializers.Serializer):
    available = serializers.BooleanField()
    provider = serializers.CharField()
    model = serializers.CharField()
    mode = serializers.CharField()
    message = serializers.CharField()


class PasswordResetRequestSerializer(serializers.Serializer):
    email = serializers.EmailField(required=True, help_text="Registered student email address")


class PasswordResetConfirmSerializer(serializers.Serializer):
    token = serializers.CharField(required=True, help_text="Cryptographic reset token from email")
    password = serializers.CharField(write_only=True, required=True, validators=[validate_password])
    password_confirm = serializers.CharField(write_only=True, required=True)

    def validate(self, attrs):
        from django.core.signing import TimestampSigner, BadSignature, SignatureExpired
        if attrs['password'] != attrs['password_confirm']:
            raise serializers.ValidationError({"password": "Password fields did not match."})

        token = attrs.get('token', '').strip()
        signer = TimestampSigner(salt='password-reset-salt')
        try:
            raw_data = signer.unsign(token, max_age=86400)
            user_id, pw_prefix = raw_data.split(':', 1)
            user = User.objects.get(pk=user_id)
            if user.password[-16:] != pw_prefix:
                raise serializers.ValidationError({"token": "This reset link has already been used."})
            self.user = user
        except SignatureExpired:
            raise serializers.ValidationError({"token": "Password reset link has expired. Please request a new one."})
        except (BadSignature, ValueError, User.DoesNotExist):
            raise serializers.ValidationError({"token": "Invalid or tampered password reset token."})

        return attrs

    def save(self):
        user = self.user
        user.set_password(self.validated_data['password'])
        user.save()
        return user
