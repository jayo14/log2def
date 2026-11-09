import os
import json
from pathlib import Path
from django.core.management.base import BaseCommand
from django.core import serializers
from django.apps import apps


DEFAULT_MODELS = [
    'api.ReportTemplate',
    'api.ReportProject',
    'api.StudentProfile',
    'api.SourceDocument',
    'api.LogbookPage',
    'api.WeekRecord',
    'api.ExtractedPage',
    'api.LogbookEntry',
    'api.Fact',
    'api.DayEntry',
    'api.Report',
    'api.ReportSection',
    'api.ReportParagraph',
    'api.ReportVersion',
    'api.ReportImage',
    'api.DefenceSession',
    'api.DefenceQuestion',
    'api.PaymentOrder',
    'api.SquadWebhookEvent',
    'api.TelegramNotificationLog',
    'api.UserAnalyticsEvent',
]


class Command(BaseCommand):
    help = "Exports database records into portable JSON fixture files for disaster recovery and safe migration."

    def add_arguments(self, parser):
        parser.add_argument(
            '--output-dir',
            default='fixtures_export',
            help='Directory path where fixture JSON files will be saved (default: fixtures_export)',
        )
        parser.add_argument(
            '--project-id',
            type=int,
            help='Export only records related to a specific project ID.',
        )

    def handle(self, *args, **options):
        out_dir = Path(options['output_dir'])
        out_dir.mkdir(parents=True, exist_ok=True)
        project_id = options.get('project_id')

        self.stdout.write(self.style.MIGRATE_HEADING(f"Exporting database fixtures to '{out_dir}'..."))

        total_records = 0
        for model_label in DEFAULT_MODELS:
            try:
                model_cls = apps.get_model(model_label)
                qs = model_cls.objects.all()

                if project_id:
                    # Filter if model has project or report relation
                    if hasattr(model_cls, 'project'):
                        qs = qs.filter(project_id=project_id)
                    elif hasattr(model_cls, 'report') and hasattr(apps.get_model('api.Report'), 'project'):
                        qs = qs.filter(report__project_id=project_id)
                    elif model_label == 'api.ReportProject':
                        qs = qs.filter(id=project_id)

                count = qs.count()
                if count > 0:
                    data = serializers.serialize('json', qs, indent=2)
                    filename = f"{model_label.replace('.', '_')}.json"
                    file_path = out_dir / filename
                    with open(file_path, 'w', encoding='utf-8') as f:
                        f.write(data)
                    self.stdout.write(self.style.SUCCESS(f"  Exported {count} record(s) -> {filename}"))
                    total_records += count
                else:
                    self.stdout.write(f"  {model_label}: 0 records (skipped)")

            except Exception as exc:
                self.stdout.write(self.style.WARNING(f"  Could not export {model_label}: {exc}"))

        self.stdout.write(self.style.SUCCESS(f"\nFinished fixture export! Total records: {total_records}"))
