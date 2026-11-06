from django.db import migrations, models
import backend.api.models


class Migration(migrations.Migration):
    dependencies = [
        ("api", "0022_report_actual_page_count"),
    ]

    operations = [
        migrations.CreateModel(
            name="ReportImage",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("original_file", models.FileField(upload_to=backend.api.models.report_image_path)),
                ("processed_file", models.FileField(upload_to=backend.api.models.report_image_path)),
                ("original_filename", models.CharField(max_length=255)),
                ("caption", models.CharField(max_length=255)),
                ("placement", models.CharField(choices=[("organisation", "Organisation section"), ("week", "Weekly activity"), ("tools", "Equipment and tools"), ("projects", "Projects"), ("challenges", "Challenges and solutions")], default="week", max_length=32)),
                ("week_number", models.PositiveIntegerField(blank=True, null=True)),
                ("order", models.PositiveIntegerField(default=0)),
                ("width", models.PositiveIntegerField(default=0)),
                ("height", models.PositiveIntegerField(default=0)),
                ("low_resolution_warning", models.BooleanField(default=False)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("project", models.ForeignKey(on_delete=models.deletion.CASCADE, related_name="report_images", to="api.reportproject")),
            ],
            options={"ordering": ["placement", "week_number", "order", "id"]},
        ),
    ]
