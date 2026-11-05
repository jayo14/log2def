import json
from pathlib import Path
from django.test import SimpleTestCase

from api.templates import LASUSTECH_CS_V2, LASUSTECH_STANDARD_V1, get_section_requirements


class TemplateV2ContractTests(SimpleTestCase):
    def test_v2_matches_coordinator_section_order(self):
        sections = LASUSTECH_CS_V2["sections"]
        self.assertEqual(
            [section["title"] for section in sections if section["chapter"] in range(1, 5)],
            [
                "1.1 Background of SIWES", "1.2 Objectives of SIWES", "1.3 Importance of SIWES",
                "1.4 Scope of the Training", "1.5 Duration of the Training",
                "2.1 Brief History of the Organisation", "2.2 Objectives of the Organisation",
                "2.3 Organisational Structure", "2.4 Organogram of the Organisation",
                "3.1 Duties and Responsibilities", "3.2 Activities Performed", "3.3 Skills Acquired",
                "3.4 Equipment/Tools Used", "3.5 Challenges Encountered", "3.6 Solutions to the Challenges",
                "4.1 Summary", "4.2 Conclusion", "4.3 Recommendations",
            ],
        )

    def test_v2_manifest_and_no_shipped_values_for_confirmation_fields(self):
        manifest = get_section_requirements()
        self.assertEqual(manifest["version"], "2.0.0")
        fields = manifest["required_fields"]
        self.assertEqual(fields["college"]["status"], "NEEDS_CONFIRMATION")
        self.assertFalse(fields["abstract_enabled"]["default"])
        self.assertTrue(fields["toc_enabled"]["default"])

    def test_v1_snapshot_definition_remains_unchanged(self):
        original = json.loads((Path(__file__).parents[1] / "templates" / "lasustech_standard_v1.json").read_text())
        self.assertEqual(LASUSTECH_STANDARD_V1, original)
