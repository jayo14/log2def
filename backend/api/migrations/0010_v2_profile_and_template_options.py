from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("api", "0009_report_document_model")]
    operations = [
        migrations.AddField("reportproject", "college", models.CharField(blank=True, max_length=255)),
        migrations.AddField("reportproject", "degree", models.CharField(blank=True, max_length=255)),
        migrations.AddField("report", "template_options", models.JSONField(blank=True, default=dict)),
        migrations.AlterField(
            model_name="reportproject",
            name="university_name",
            field=models.CharField(blank=True, default="", max_length=255),
        ),
    ]
