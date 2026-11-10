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
    if section_key == "table_of_contents":
        return "GENERATED_FROM_MODEL"
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
            self.nodes: list[DocumentNode] = []
            self.stack: list[DocumentNode] = []

        def _append(self, node: DocumentNode):
            (self.stack[-1].children if self.stack else self.nodes).append(node)

        def handle_starttag(self, tag, attrs):
            attributes = dict(attrs)
            if tag == "div":
                node = DocumentNode(type="container", text="", provenance={}, attrs=attributes)
                self._append(node)
                self.stack.append(node)
            elif tag in {"p", "h1", "h2", "h3", "h4", "h5", "h6"}:
                node_type = "heading" if tag.startswith("h") else "paragraph"
                node = DocumentNode(type=node_type, text="", provenance={}, attrs={"level": tag[1:]} if tag.startswith("h") else {})
                self._append(node)
                self.stack.append(node)
            elif tag in {"ul", "ol", "table", "tr", "td", "th", "li"}:
                node_type = {"ul": "list", "ol": "list", "table": "table", "tr": "row", "td": "cell", "th": "cell", "li": "list_item"}[tag]
                node = DocumentNode(type=node_type, text="", provenance={}, attrs={"ordered": tag == "ol"} if tag in {"ul", "ol"} else {})
                self._append(node)
                self.stack.append(node)
            elif tag == "img":
                self._append(DocumentNode(type="figure", text="", provenance={}, attrs={"src": attributes.get("src", ""), "caption": attributes.get("alt", "")}))
            elif tag == "br" and self.stack:
                self.stack[-1].text += "\n"

        def handle_endtag(self, tag):
            closers = {"p", "div", "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "table", "tr", "td", "th", "li"}
            if tag in closers and self.stack:
                self.stack.pop()

        def handle_data(self, data):
            if self.stack:
                if self.stack[-1].type == "container":
                    stripped = data.strip()
                    if stripped:
                        self.stack[-1].text = f"{self.stack[-1].text} {stripped}".strip() if self.stack[-1].text else stripped
                else:
                    self.stack[-1].text += data
            elif data.strip():
                self.nodes.append(DocumentNode(type="paragraph", text=data.strip(), provenance={}))

    sections = []
    for item in report.sections.all().order_by("chapter_number", "order", "id"):
        definition = definitions.get(item.section_key, {})
        extractor = TextExtractor()
        extractor.feed(item.content or "")
        source_type = definition.get("source")
        if source_type not in {"FIXED_BOILERPLATE", "LOGBOOK", "INFERRED", "STUDENT_PROVIDED", "GENERATED_FROM_MODEL"}:
            source_type = section_source(item.section_key, item.chapter_number)
        nodes = extractor.nodes
        def set_provenance(node):
            node.provenance = {"source_type": source_type, "source_ids": item.source_links or []}
            for child in node.children:
                set_provenance(child)
        for node in nodes:
            set_provenance(node)
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
