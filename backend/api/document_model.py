"""Typed, provenance carrying report document tree shared by renderers."""
from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any, Literal

SourceType = Literal["FIXED_BOILERPLATE", "LOGBOOK", "INFERRED", "STUDENT_PROVIDED"]


@dataclass
class DocumentNode:
    type: str
    provenance: dict[str, Any]
    text: str = ""
    children: list["DocumentNode"] = field(default_factory=list)
    attrs: dict[str, Any] = field(default_factory=dict)


@dataclass
class DocumentSection:
    key: str
    title: str
    chapter: int
    order: int
    source_type: SourceType
    nodes: list[DocumentNode] = field(default_factory=list)
    chapter_title: str = ""
    optional: bool = False


@dataclass
class ReportDocument:
    template_version: str
    sections: list[DocumentSection]
    formatting: dict[str, Any]

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def section_source(section_key: str, chapter: int) -> SourceType:
    if chapter == 1 and section_key in {"ch1_background", "ch1_objectives", "ch1_importance"}:
        return "FIXED_BOILERPLATE"
    if section_key.startswith("ch3_"):
        return "LOGBOOK"
    return "STUDENT_PROVIDED"


def model_from_sections(report, spec: dict[str, Any]) -> ReportDocument:
    """Snapshot editable report sections into typed paragraphs with source links."""
    from html.parser import HTMLParser

    definitions = {item["key"]: item for item in spec.get("sections", [])}

    class TextExtractor(HTMLParser):
        def __init__(self):
            super().__init__()
            self.parts: list[str] = []

        def handle_data(self, data):
            text = data.strip()
            if text:
                self.parts.append(text)

    sections = []
    for item in report.sections.all().order_by("chapter_number", "order", "id"):
        definition = definitions.get(item.section_key, {})
        extractor = TextExtractor()
        extractor.feed(item.content or "")
        source_type = definition.get("source")
        if source_type not in {"FIXED_BOILERPLATE", "LOGBOOK", "INFERRED", "STUDENT_PROVIDED"}:
            source_type = section_source(item.section_key, item.chapter_number)
        nodes = [
            DocumentNode(
                type="paragraph",
                text=text,
                provenance={"source_type": source_type, "source_ids": item.source_links or []},
            )
            for text in extractor.parts
        ]
        sections.append(DocumentSection(
            key=item.section_key,
            title=item.title,
            chapter=item.chapter_number,
            order=item.order,
            source_type=source_type,
            nodes=nodes,
            chapter_title=definition.get("chapter_title", ""),
            optional=not item.is_required,
        ))
    return ReportDocument(
        template_version=report.template_version,
        sections=sections,
        formatting=spec.get("formatting_spec", {}),
    )
