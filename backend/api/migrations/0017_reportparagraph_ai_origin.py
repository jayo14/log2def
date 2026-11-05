from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("api", "0016_reportparagraph_origin")]

    operations = [
        migrations.AlterField(
            model_name="reportparagraph",
            name="origin",
            field=models.CharField(
                choices=[
                    ("GUIDED_INTAKE", "Guided intake"),
                    ("AI_GENERATED", "AI generated from confirmed facts"),
                    ("STUDENT_EDITED", "Student edited"),
                ],
                default="STUDENT_EDITED",
                max_length=24,
            ),
        ),
    ]
