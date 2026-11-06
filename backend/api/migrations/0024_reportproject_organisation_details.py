from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("api", "0023_reportimage"),
    ]

    operations = [
        migrations.AddField(
            model_name="reportproject",
            name="organisation_what",
            field=models.TextField(blank=True, help_text="What does the organisation do? (main products or services)"),
        ),
        migrations.AddField(
            model_name="reportproject",
            name="organisation_when_where",
            field=models.TextField(blank=True, help_text="When and how did it start? Where is it based?"),
        ),
        migrations.AddField(
            model_name="reportproject",
            name="organisation_objectives",
            field=models.TextField(blank=True, help_text="What is the organisation's mission, vision or main objectives?"),
        ),
        migrations.AddField(
            model_name="reportproject",
            name="organisation_structure",
            field=models.TextField(blank=True, help_text="Who heads the organisation (title)? What are the main departments or units? Which one did you work in? Who did you report to?"),
        ),
        migrations.AddField(
            model_name="reportproject",
            name="organisation_organogram",
            field=models.JSONField(blank=True, default=dict, help_text="Organogram tree or image reference"),
        ),
        migrations.AddField(
            model_name="reportproject",
            name="organisation_paste_source",
            field=models.CharField(blank=True, help_text="URL or path to pasted organisation text", max_length=255),
        ),
        migrations.AddField(
            model_name="reportproject",
            name="organisation_paste_text",
            field=models.TextField(blank=True, help_text="Pasted text from the company's website or profile"),
        ),
    ]
