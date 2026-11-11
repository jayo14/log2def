from django.test import TestCase
from django.contrib.auth.models import User
from datetime import date
from api.models import ReportProject, SourceDocument, ExtractedPage, LogbookEntry
from api.document_processor import (
    normalize_entries_to_standard_workweek,
    extract_logbook_entries_from_text,
    STANDARD_WORKDAYS,
)


class LogbookWeeklyPartitioningTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(username='test_ocr_user', password='password123')
        self.project = ReportProject.objects.create(
            user=self.user,
            title='SIWES Partitioning Test',
            training_start_date=date(2024, 6, 3),  # A Monday
            training_end_date=date(2024, 8, 30),
        )
        self.doc = SourceDocument.objects.create(
            project=self.project,
            original_filename='page_1.png',
            file_type='image',
            page_index=0,
        )
        self.page = ExtractedPage.objects.create(
            document=self.doc,
            page_number=1,
            page_index=0,
            extracted_text='Monday: Configured router. Tuesday: Tested cables.',
            confidence_score=0.90,
            status='completed',
        )

    def test_normalize_entries_creates_exactly_five_weekdays(self):
        raw_entries = [
            {'day_of_week': 'Monday', 'activity_summary': 'Configured Cisco router', 'raw_text': 'Configured Cisco router'},
            {'day_of_week': 'Tuesday', 'activity_summary': 'Terminated Cat6 Ethernet', 'raw_text': 'Terminated Cat6 Ethernet'},
        ]
        entries = normalize_entries_to_standard_workweek(
            entries_data=raw_entries,
            default_week=1,
            project=self.project,
            page_instance=self.page,
            source_text='Monday: router. Tuesday: cables.'
        )
        self.assertEqual(len(entries), 5)
        day_names = [e.day_of_week for e in entries]
        self.assertEqual(day_names, STANDARD_WORKDAYS)
        self.assertEqual(entries[0].week_number, 1)
        self.assertEqual(entries[0].day_of_week, 'Monday')
        self.assertIn('Cisco router', entries[0].activity_summary)
        self.assertEqual(entries[1].day_of_week, 'Tuesday')
        self.assertIn('Cat6', entries[1].activity_summary)
        # Missing Wednesday, Thursday, Friday are created
        self.assertEqual(entries[2].day_of_week, 'Wednesday')
        self.assertTrue(entries[2].is_flagged)
        self.assertEqual(entries[3].day_of_week, 'Thursday')
        self.assertEqual(entries[4].day_of_week, 'Friday')

    def test_normalize_entries_folds_saturday_and_deduplicates(self):
        raw_entries = [
            {'day_of_week': 'Monday', 'activity_summary': 'Morning meeting', 'raw_text': 'Morning meeting'},
            {'day_of_week': 'Monday', 'activity_summary': 'Detailed router and firewall security audit configuration', 'raw_text': 'Detailed router and firewall security audit configuration'},
            {'day_of_week': 'Tuesday', 'activity_summary': 'VLAN segmenting', 'raw_text': 'VLAN segmenting'},
            {'day_of_week': 'Wednesday', 'activity_summary': 'Server racking', 'raw_text': 'Server racking'},
            {'day_of_week': 'Thursday', 'activity_summary': 'Network monitoring', 'raw_text': 'Network monitoring'},
            {'day_of_week': 'Friday', 'activity_summary': 'Weekly backup', 'raw_text': 'Weekly backup'},
            {'day_of_week': 'Saturday', 'activity_summary': 'Emergency power maintenance', 'raw_text': 'Emergency power maintenance'},
        ]
        entries = normalize_entries_to_standard_workweek(
            entries_data=raw_entries,
            default_week=2,
            project=self.project,
            page_instance=self.page,
            source_text='Detailed log with saturday'
        )
        self.assertEqual(len(entries), 5, "Must never exceed 5 entries per week")
        day_names = [e.day_of_week for e in entries]
        self.assertEqual(day_names, STANDARD_WORKDAYS)
        # Deduplicated Monday takes the richest entry
        mon = next(e for e in entries if e.day_of_week == 'Monday')
        self.assertIn('firewall', mon.activity_summary)
        # All 5 entries have week_number == 2
        for e in entries:
            self.assertEqual(e.week_number, 2)

    def test_extract_logbook_entries_from_narrative_text(self):
        narrative = (
            "Week 3 activities.\n"
            "Mon: Setup development environment with Python and Django.\n"
            "Tue: Designed PostgreSQL schema and ran initial migrations.\n"
            "Wed: Implemented JWT authentication and authorization middlewares.\n"
            "Thu: Built REST API endpoints and swagger documentation.\n"
            "Fri: Deployed backend services on Docker container cluster."
        )
        entries = extract_logbook_entries_from_text(
            project=self.project,
            page_instance=self.page,
            text=narrative,
            fallback_week=1
        )
        self.assertEqual(len(entries), 5)
        self.assertEqual(entries[0].week_number, 3, "Extracted week from text should take priority")
        self.assertEqual([e.day_of_week for e in entries], STANDARD_WORKDAYS)

    def test_extract_logbook_entries_from_empty_text_creates_placeholders(self):
        entries = extract_logbook_entries_from_text(
            project=self.project,
            page_instance=self.page,
            text='',
            fallback_week=4
        )
        self.assertEqual(len(entries), 5)
        for e in entries:
            self.assertEqual(e.week_number, 4)
            self.assertTrue(e.is_flagged)
