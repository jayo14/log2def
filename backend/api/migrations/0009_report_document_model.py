from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("api", "0008_paymentorder")]
    operations = [
        migrations.AddField(
            model_name="report",
            name="document_model",
            field=models.JSONField(blank=True, default=dict),
        ),
    ]
