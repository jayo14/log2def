from rest_framework import serializers
from django.contrib.auth.models import User
from django.contrib.auth.password_validation import validate_password
from .models import (
    ReportProject, ReportTemplate, SourceDocument, 
    ExtractedPage, LogbookEntry, Report, ReportSection, 
    DefenceQuestion, DefenceSession
)


class UserRegistrationSerializer(serializers.ModelSerializer):
    password = serializers.CharField(write_only=True, required=True, validators=[validate_password])
    password_confirm = serializers.CharField(write_only=True, required=True)

    class Meta:
        model = User
        fields = ('id', 'username', 'email', 'first_name', 'last_name', 'password', 'password_confirm')

    def validate(self, attrs):
        if attrs['password'] != attrs['password_confirm']:
            raise serializers.ValidationError({"password": "Password fields did not match."})
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


class ReportSerializer(serializers.ModelSerializer):
    sections = ReportSectionSerializer(many=True, read_only=True)

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
