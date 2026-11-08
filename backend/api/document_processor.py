import os
import re
import json
import shutil
import subprocess
from datetime import datetime
from PIL import Image, ImageEnhance, ImageFilter
import pymupdf
from docx import Document as DocxDocument
from django.conf import settings
from .models import SourceDocument, ExtractedPage, LogbookEntry
from .ai_provider import is_ai_available, generate_vision_completion, AIProviderUnavailableError
from .page_classifier import classify_page
from .privacy_guard import sanitize_privacy_identifiers


def detect_low_confidence_segments(text: str, base_confidence: float = 0.90) -> list:
    """
    Identifies uncertain words or low-confidence spans in OCR text for UI review highlighting.
    """
    segments = []
    if not text:
        return segments

    for match in re.finditer(r'(\[\?\]|\[unclear\]|\?\?\?|\([^\)]*\?\))', text, re.IGNORECASE):
        segments.append({
            "text": match.group(0),
            "start": match.start(),
            "end": match.end(),
            "confidence": 0.30,
            "suggestion": "Unclear handwritten word"
        })

    if base_confidence < 0.75:
        segments.append({
            "text": text[:60] + "..." if len(text) > 60 else text,
            "start": 0,
            "end": min(60, len(text)),
            "confidence": round(base_confidence, 2),
            "suggestion": "Low OCR recognition confidence across page"
        })

    return segments


def validate_structured_entry_anti_fabrication(
    source_text: str,
    entry_data: dict,
    page_id: int = None,
    page_num: int = 1
) -> dict:
    """
    Strict Anti-Fabrication Post-Check & Provenance Tagging:
    1. Forbids AI from inventing tools, technologies, equipment, or activities not in OCR text.
    2. Drops hallucinated tools/equipment that have zero lexical support in source text.
    3. Tags every field with explicit provenance:
       - RECORDED: directly present in source text with exact source page excerpt.
       - INFERRED: derived logically from recorded tasks with explanation reasoning.
       - MISSING: not mentioned or unavailable.
    4. Attaches per-field confidence scores.
    """
    source_text_lower = (source_text or "").lower()
    source_tokens = set(re.findall(r'[a-zA-Z0-9]+', source_text_lower))

    activity_summary = str(entry_data.get('activity_summary') or entry_data.get('summary') or '').strip()
    raw_tools = str(entry_data.get('tools_used') or entry_data.get('tools') or '').strip()
    raw_equipment = str(entry_data.get('equipment_used') or entry_data.get('equipment') or '').strip()
    technical_area = str(entry_data.get('technical_area') or '').strip()
    day_of_week = str(entry_data.get('day_of_week') or '').strip()
    entry_date = entry_data.get('entry_date')
    week_number = entry_data.get('week_number', 1)
    has_sig = bool(
        entry_data.get('has_supervisor_signature') or
        entry_data.get('supervisor_signed') or
        entry_data.get('supervisor_signature_detected') or
        re.search(r'\b(signed|signature|stamp)\b', source_text_lower)
    )

    is_flagged = False
    flag_notes = []

    # --- 1. Tools Anti-Fabrication Filter ---
    valid_tools = []
    if raw_tools:
        candidate_tools = [t.strip() for t in re.split(r'[,;\n/]+', raw_tools) if t.strip()]
        for tool in candidate_tools:
            tool_tokens = re.findall(r'[a-zA-Z0-9]+', tool.lower())
            # A tool is valid if any of its significant tokens appears in the source text
            has_support = any(
                tok in source_tokens or tok in source_text_lower
                for tok in tool_tokens if len(tok) >= 2
            )
            if has_support:
                valid_tools.append(tool)
            else:
                is_flagged = True
                flag_notes.append(f"Discarded fabricated tool '{tool}' with no support in logbook OCR")

    final_tools_used = ", ".join(valid_tools)
    tools_prov = {
        "status": "RECORDED" if final_tools_used else "MISSING",
        "source_page_id": page_id if final_tools_used else None,
        "source_page_number": page_num if final_tools_used else None,
        "source_text_excerpt": final_tools_used if final_tools_used else None,
        "reasoning": None if final_tools_used else "No tools explicitly recorded in page text",
    }

    # --- 2. Equipment Anti-Fabrication Filter ---
    valid_equipment = []
    if raw_equipment:
        candidate_eq = [e.strip() for e in re.split(r'[,;\n/]+', raw_equipment) if e.strip()]
        for eq in candidate_eq:
            eq_tokens = re.findall(r'[a-zA-Z0-9]+', eq.lower())
            has_support = any(
                tok in source_tokens or tok in source_text_lower
                for tok in eq_tokens if len(tok) >= 2
            )
            if has_support:
                valid_equipment.append(eq)
            else:
                is_flagged = True
                flag_notes.append(f"Discarded fabricated equipment '{eq}' with no support in logbook OCR")

    final_equipment_used = ", ".join(valid_equipment)
    eq_prov = {
        "status": "RECORDED" if final_equipment_used else "MISSING",
        "source_page_id": page_id if final_equipment_used else None,
        "source_page_number": page_num if final_equipment_used else None,
        "source_text_excerpt": final_equipment_used if final_equipment_used else None,
        "reasoning": None if final_equipment_used else "No equipment recorded in page text",
    }

    # --- 3. Activity Summary Support Check ---
    activity_tokens = [tok for tok in re.findall(r'[a-zA-Z0-9]+', activity_summary.lower()) if len(tok) > 3]
    activity_supported = len(activity_tokens) == 0 or any(tok in source_tokens for tok in activity_tokens)

    if not activity_supported and len(source_text_lower.strip()) > 0:
        is_flagged = True
        flag_notes.append("Activity summary has zero lexical support in source OCR text")
        act_prov = {
            "status": "MISSING",
            "source_page_id": page_id,
            "source_page_number": page_num,
            "source_text_excerpt": None,
            "reasoning": "Output terms have no matching words in source logbook",
        }
    else:
        act_prov = {
            "status": "RECORDED" if activity_summary else "MISSING",
            "source_page_id": page_id if activity_summary else None,
            "source_page_number": page_num if activity_summary else None,
            "source_text_excerpt": activity_summary[:120] if activity_summary else None,
            "reasoning": None if activity_summary else "No daily activity recorded",
        }

    # --- 4. Technical Area Provenance ---
    if technical_area:
        tech_prov = {
            "status": "INFERRED",
            "source_page_id": page_id,
            "source_page_number": page_num,
            "source_text_excerpt": activity_summary[:80] if activity_summary else None,
            "reasoning": f"Inferred '{technical_area}' from recorded tasks: {activity_summary[:60]}",
        }
    else:
        tech_prov = {
            "status": "MISSING",
            "source_page_id": None,
            "source_page_number": None,
            "source_text_excerpt": None,
            "reasoning": "Technical area not determined",
        }

    # --- 5. Supervisor Signature Provenance ---
    sig_prov = {
        "status": "RECORDED" if has_sig else "MISSING",
        "source_page_id": page_id if has_sig else None,
        "source_page_number": page_num if has_sig else None,
        "source_text_excerpt": "Supervisor signature/stamp detected" if has_sig else None,
        "reasoning": None if has_sig else "No supervisor endorsement detected on page",
    }

    confidence_scores = {
        "activity_summary": 0.94 if act_prov["status"] == "RECORDED" else 0.40,
        "tools_used": 0.92 if tools_prov["status"] == "RECORDED" else 0.0,
        "equipment_used": 0.92 if eq_prov["status"] == "RECORDED" else 0.0,
        "technical_area": 0.85 if tech_prov["status"] == "INFERRED" else 0.0,
        "supervisor_signature": 0.88 if has_sig else 0.0,
    }

    return {
        "week_number": week_number,
        "day_of_week": day_of_week,
        "entry_date": entry_date,
        "raw_text": entry_data.get('raw_text', '') or activity_summary,
        "verified_text": entry_data.get('verified_text', '') or activity_summary,
        "activity_summary": activity_summary,
        "tools_used": final_tools_used,
        "equipment_used": final_equipment_used,
        "technical_area": technical_area,
        "has_supervisor_signature": has_sig,
        "confidence_scores": confidence_scores,
        "field_provenance": {
            "activity_summary": act_prov,
            "tools_used": tools_prov,
            "equipment_used": eq_prov,
            "technical_area": tech_prov,
            "supervisor_signature": sig_prov,
        },
        "is_flagged": is_flagged,
        "flag_notes": flag_notes,
    }


def extract_week_from_string(text: str) -> int | None:
    """Extracts week number from string like 'Week 3', 'Week_04', 'wk2', 'w5'."""
    if not text:
        return None
    match = re.search(r'(?i)(?:^|[\W_])(?:week|wk|w)[\s_#-]*0*([1-9]\d?)(?=$|[\W_])', text)
    if match:
        try:
            return int(match.group(1))
        except ValueError:
            return None
    return None


def apply_cover_details_to_project(project, cover_details: dict):
    """
    Auto-populates project attributes (student details, company, dates)
    when a cover or student particulars page is read via OCR/vision.
    """
    if not isinstance(cover_details, dict):
        return

    updated_fields = []
    
    # Student identity
    name = str(cover_details.get('student_name') or '').strip()
    if name and (not project.full_name or project.full_name in ['[Student Full Name]', 'Student Name', 'John Samuel']):
        project.full_name = name
        updated_fields.append('full_name')

    matric = str(cover_details.get('matric_number') or '').strip()
    if matric and (not project.matric_number or project.matric_number in ['[Matriculation Number]', 'MATRIC', '240303010036']):
        project.matric_number = matric
        updated_fields.append('matric_number')

    dept = str(cover_details.get('department') or '').strip()
    if dept and (not project.department or project.department == '[Department Name]'):
        project.department = dept
        updated_fields.append('department')

    faculty = str(cover_details.get('faculty') or '').strip()
    if faculty and not project.faculty_school:
        project.faculty_school = faculty
        updated_fields.append('faculty_school')

    inst = str(cover_details.get('institution') or '').strip()
    if inst and (not project.university_name or 'Lagos State University' in project.university_name):
        project.university_name = inst
        updated_fields.append('university_name')

    # Host organization
    org = str(cover_details.get('organization_name') or '').strip()
    if org and (not project.organization_name or project.organization_name in ['[Host Organization Name]', 'Company Name']):
        project.organization_name = org
        updated_fields.append('organization_name')

    addr = str(cover_details.get('organization_address') or '').strip()
    if addr and not project.organization_address:
        project.organization_address = addr
        updated_fields.append('organization_address')

    supervisor = str(cover_details.get('industry_supervisor') or '').strip()
    if supervisor and not project.industry_supervisor_name:
        project.industry_supervisor_name = supervisor
        updated_fields.append('industry_supervisor_name')

    # Dates
    start_str = str(cover_details.get('start_date') or '').strip()
    if start_str and not project.training_start_date:
        for fmt in ('%Y-%m-%d', '%d/%m/%Y', '%m/%d/%Y', '%d-%m-%Y', '%B %d, %Y', '%b %d, %Y'):
            try:
                project.training_start_date = datetime.strptime(start_str, fmt).date()
                updated_fields.append('training_start_date')
                break
            except Exception:
                pass

    end_str = str(cover_details.get('end_date') or '').strip()
    if end_str and not project.training_end_date:
        for fmt in ('%Y-%m-%d', '%d/%m/%Y', '%m/%d/%Y', '%d-%m-%Y', '%B %d, %Y', '%b %d, %Y'):
            try:
                project.training_end_date = datetime.strptime(end_str, fmt).date()
                updated_fields.append('training_end_date')
                break
            except Exception:
                pass

    if updated_fields:
        project.save(update_fields=updated_fields)


def run_multimodal_vision_analysis(image_path: str, filename_hint: str = "") -> tuple[str, float, dict]:
    """
    Analyzes handwritten and scanned logbook pages using Google Gemini Flash Multimodal Vision.
    Extracts transcribed text, week number, daily entries, tools used, and technical observations.
    Returns (transcribed_text, confidence_score, structured_dict).
    Falls back to ("", 0.0, {}) if AI is unavailable or call fails.
    """
    if not is_ai_available() or not os.path.exists(image_path):
        return "", 0.0, {}

    try:
        with open(image_path, "rb") as f:
            image_bytes = f.read()

        ext = os.path.splitext(image_path)[1].lower()
        mime_map = {
            ".png": "image/png",
            ".jpg": "image/jpeg",
            ".jpeg": "image/jpeg",
            ".webp": "image/webp",
        }
        mime_type = mime_map.get(ext, "image/jpeg")

        hint_clause = f"Document filename: {filename_hint}\n" if filename_hint else ""

        prompt = (
            "You are an expert academic OCR and SIWES technical logbook analyzer. "
            "Examine this handwritten or printed SIWES industrial training logbook page.\n"
            f"{hint_clause}"
            "\n"
            "CRITICAL ANTI-FABRICATION RULE:\n"
            "- You must NEVER invent, extrapolate, or hallucinate activities, projects, tools, software, equipment, or accomplishments not stated in the image.\n"
            "- If tools or equipment are not mentioned in the source logbook, set them to empty string \"\". DO NOT assume standard tools.\n"
            "- Derive 'technical_area' only if directly indicated by recorded tasks (e.g. 'Network Cabling' -> 'Computer Networking').\n\n"
            "If this image is a COVER PAGE or STUDENT PARTICULARS PAGE, extract the cover metadata fields.\n"
            "If this image is a WEEKLY LOGBOOK ENTRY page, extract the weekly/daily entries.\n\n"
            "Respond ONLY with a valid JSON object matching this schema:\n"
            "{\n"
            '  "is_cover_page": false,\n'
            '  "cover_details": {\n'
            '    "student_name": "",\n'
            '    "matric_number": "",\n'
            '    "department": "",\n'
            '    "faculty": "",\n'
            '    "institution": "",\n'
            '    "organization_name": "",\n'
            '    "organization_address": "",\n'
            '    "industry_supervisor": "",\n'
            '    "start_date": "",\n'
            '    "end_date": ""\n'
            '  },\n'
            '  "transcribed_text": "Full verbatim transcription of all text on this page",\n'
            '  "confidence": 0.94,\n'
            '  "week_number": 1,\n'
            '  "dates_covered": "e.g. June 10 - June 14, 2024",\n'
            '  "supervisor_signature_detected": true,\n'
            '  "supervisor_signature_confidence": 0.85,\n'
            '  "entries": [\n'
            '    {\n'
            '      "day_of_week": "Monday",\n'
            '      "activity_summary": "Verbatim or faithful summary of task described in the logbook",\n'
            '      "tools_used": "Comma-separated tools mentioned in text or empty string",\n'
            '      "equipment_used": "Comma-separated hardware/equipment mentioned or empty string",\n'
            '      "technical_area": "Technical discipline derived directly from task",\n'
            '      "hours_spent": 8\n'
            '    }\n'
            '  ]\n'
            "}"
        )

        response_text = generate_vision_completion(
            prompt=prompt,
            image_bytes=image_bytes,
            mime_type=mime_type,
            response_json=True
        )

        clean_json = response_text.strip()
        if clean_json.startswith("```json"):
            clean_json = clean_json[7:]
        if clean_json.startswith("```"):
            clean_json = clean_json[3:]
        if clean_json.endswith("```"):
            clean_json = clean_json[:-3]
        clean_json = clean_json.strip()

        # Regex match outermost JSON object or array
        match = re.search(r'(\{[\s\S]*\}|\[[\s\S]*\])', clean_json)
        if match:
            clean_json = match.group(1).strip()

        parsed = json.loads(clean_json)
        if isinstance(parsed, list):
            entries = [e for e in parsed if isinstance(e, dict)]
            transcribed_text = "\n".join(
                str(e.get("activity_summary") or e.get("raw_text") or e.get("task") or "")
                for e in entries
            ).strip()
            data = {
                "transcribed_text": transcribed_text,
                "confidence": 0.90,
                "entries": entries,
                "week_number": 1,
            }
        elif isinstance(parsed, dict):
            data = parsed
        else:
            data = {}

        transcribed_text = str(data.get("transcribed_text", "")).strip()
        confidence = float(data.get("confidence", 0.92))
        return transcribed_text, confidence, data
    except Exception:
        return "", 0.0, {}


def run_ocr_on_image(image_path: str, trace_page_dir=None) -> tuple[str, float]:
    """
    Attempts to run OCR on an image file using tesseract CLI if installed.
    Returns (extracted_text, confidence_score).
    If OCR is not available, returns empty string and 0.0 confidence.
    """
    tesseract_bin = getattr(settings, 'TESSERACT_CMD', 'tesseract')
    resolved_tesseract = (tesseract_bin if os.path.isabs(tesseract_bin) and os.path.exists(tesseract_bin) else None) or shutil.which(tesseract_bin) or shutil.which('tesseract')
    if not resolved_tesseract:
        return "", 0.0
    tesseract_bin = resolved_tesseract

    try:
        # Preprocess image for OCR using Pillow
        with Image.open(image_path) as img:
            # Convert to grayscale
            gray = img.convert('L')
            # Enhance contrast
            enhancer = ImageEnhance.Contrast(gray)
            enhanced = enhancer.enhance(1.8)
            # Filter noise
            filtered = enhanced.filter(ImageFilter.MedianFilter())
            
            temp_preprocessed = f"{image_path}_preprocessed.png"
            filtered.save(temp_preprocessed)
            if trace_page_dir is not None:
                from .ocr_trace import save_tesseract_tsv
                filtered.save(trace_page_dir / "preprocessed.png")
                trace_result = subprocess.run(
                    [tesseract_bin, temp_preprocessed, "stdout", "--oem", "1", "-l", "eng", "tsv"],
                    capture_output=True, text=True, timeout=30,
                )
                save_tesseract_tsv(trace_result.stdout if trace_result.returncode == 0 else "", trace_page_dir)

        # Run tesseract CLI
        result = subprocess.run(
            [tesseract_bin, temp_preprocessed, "stdout", "--oem", "1", "-l", "eng"],
            capture_output=True,
            text=True,
            timeout=30
        )
        
        if os.path.exists(temp_preprocessed):
            try:
                os.remove(temp_preprocessed)
            except OSError:
                pass

        if result.returncode == 0:
            text = result.stdout.strip()
            confidence = 0.82 if len(text) > 30 else 0.50
            return text, confidence
        return "", 0.0
    except Exception:
        return "", 0.0


def extract_logbook_entries_from_text(project, page_instance, text: str, fallback_week: int = 1):
    """
    Heuristically parses daily or weekly entries from extracted text,
    validates with anti-fabrication post-checks, and creates LogbookEntry records
    with full provenance (RECORDED/INFERRED/MISSING) and per-field confidence.
    """
    if not text or len(text.strip()) < 10:
        return

    lines = [line.strip() for line in text.split('\n') if line.strip()]
    current_week = fallback_week
    
    # Check if a week header exists
    detected_week = extract_week_from_string(text)
    if detected_week:
        current_week = detected_week
    elif parsed_date and project.training_start_date:
        current_week = max(1, ((parsed_date - project.training_start_date).days // 7) + 1)
    else:
        current_week = fallback_week

    # Extract date if mentioned e.g. 2024-06-10 or 10/06/2024 or June 10, 2024
    parsed_date = None
    date_match = re.search(r'\b(\d{4}[-/]\d{1,2}[-/]\d{1,2})\b', text)
    if date_match:
        try:
            parsed_date = datetime.strptime(date_match.group(1).replace('/', '-'), '%Y-%m-%d').date()
        except Exception:
            parsed_date = None

    # Check for detectable tools explicitly in text
    tool_keywords = [
        'python', 'javascript', 'html', 'css', 'react', 'sql', 'cisco',
        'cli', 'router', 'switch', 'vlan', 'wireshark', 'linux', 'bash',
        'multimeter', 'soldering iron', 'cat6', 'ethernet', 'cable tester',
        'oscilloscope', 'power supply', 'vs code', 'git', 'github', 'autocad',
        'matlab', 'excel', 'word', 'packet tracer'
    ]
    detected_tools = [kw for kw in tool_keywords if re.search(rf'\b{re.escape(kw)}\b', text, re.IGNORECASE)]

    # Look for days of week
    day_patterns = [
        ('Monday', r'\b(?:mon|monday)\b'),
        ('Tuesday', r'\b(?:tue|tues|tuesday)\b'),
        ('Wednesday', r'\b(?:wed|wednesday)\b'),
        ('Thursday', r'\b(?:thu|thur|thurs|thursday)\b'),
        ('Friday', r'\b(?:fri|friday)\b'),
        ('Saturday', r'\b(?:sat|saturday)\b'),
    ]

    day_indices = []
    for day_name, pattern in day_patterns:
        for m in re.finditer(pattern, text, re.IGNORECASE):
            day_indices.append((m.start(), day_name))

    day_indices.sort(key=lambda x: x[0])

    if day_indices:
        for i, (start_idx, day_name) in enumerate(day_indices):
            end_idx = day_indices[i + 1][0] if i + 1 < len(day_indices) else len(text)
            chunk = text[start_idx:end_idx].strip()
            clean_chunk = re.sub(r'^(?:mon|monday|tue|tues|tuesday|wed|wednesday|thu|thur|thurs|thursday|fri|friday|sat|saturday)[\s:\-–—]+', '', chunk, flags=re.IGNORECASE).strip()
            summary = clean_chunk[:80].replace('\n', ' ') if clean_chunk else f"{day_name} Activities"
            
            chunk_tools = [t for t in detected_tools if re.search(rf'\b{re.escape(t)}\b', chunk, re.IGNORECASE)]
            
            raw_entry = {
                'week_number': current_week,
                'day_of_week': day_name,
                'entry_date': parsed_date,
                'activity_summary': summary,
                'tools_used': ", ".join(chunk_tools),
                'equipment_used': "",
                'raw_text': clean_chunk or chunk,
                'verified_text': clean_chunk or chunk,
            }
            
            validated = validate_structured_entry_anti_fabrication(
                source_text=chunk or text,
                entry_data=raw_entry,
                page_id=page_instance.id,
                page_num=page_instance.page_number
            )

            entry_date = validated.get('entry_date')
            is_flagged = validated.get('is_flagged', False)
            if entry_date and project.training_start_date and project.training_end_date:
                if entry_date < project.training_start_date or entry_date > project.training_end_date:
                    is_flagged = True

            LogbookEntry.objects.create(
                project=project,
                source_page=page_instance,
                week_number=current_week,
                entry_date=entry_date,
                day_of_week=validated['day_of_week'],
                raw_text=sanitize_privacy_identifiers(validated['raw_text']),
                verified_text=sanitize_privacy_identifiers(validated['verified_text']),
                activity_summary=sanitize_privacy_identifiers(validated['activity_summary']),
                tools_used=sanitize_privacy_identifiers(validated['tools_used']),
                equipment_used=sanitize_privacy_identifiers(validated['equipment_used']),
                technical_area=validated['technical_area'],
                has_supervisor_signature=validated['has_supervisor_signature'],
                confidence_scores=validated['confidence_scores'],
                field_provenance=validated['field_provenance'],
                is_flagged=is_flagged,
                is_verified=False,
                order=i
            )
    else:
        summary = lines[0][:80] if lines else f"Page {page_instance.page_number} Activity"
        raw_entry = {
            'week_number': current_week,
            'day_of_week': "",
            'entry_date': parsed_date,
            'activity_summary': summary,
            'tools_used': ", ".join(detected_tools),
            'equipment_used': "",
            'raw_text': text,
            'verified_text': text,
        }
        validated = validate_structured_entry_anti_fabrication(
            source_text=text,
            entry_data=raw_entry,
            page_id=page_instance.id,
            page_num=page_instance.page_number
        )
        entry_date = validated.get('entry_date')
        is_flagged = validated.get('is_flagged', False)
        if entry_date and project.training_start_date and project.training_end_date:
            if entry_date < project.training_start_date or entry_date > project.training_end_date:
                is_flagged = True

        LogbookEntry.objects.create(
            project=project,
            source_page=page_instance,
            week_number=current_week,
            entry_date=entry_date,
            day_of_week="",
            raw_text=sanitize_privacy_identifiers(validated['raw_text']),
            verified_text=sanitize_privacy_identifiers(validated['verified_text']),
            activity_summary=sanitize_privacy_identifiers(validated['activity_summary']),
            tools_used=sanitize_privacy_identifiers(validated['tools_used']),
            equipment_used=sanitize_privacy_identifiers(validated['equipment_used']),
            technical_area=validated['technical_area'],
            has_supervisor_signature=validated['has_supervisor_signature'],
            confidence_scores=validated['confidence_scores'],
            field_provenance=validated['field_provenance'],
            is_flagged=is_flagged,
            is_verified=False,
            order=LogbookEntry.objects.filter(project=project, week_number=current_week).count()
        )


def process_source_document(doc_id: int):
    """
    Staged asynchronous processing pipeline for an uploaded document:
    1. Upload / Ingestion
    2. Page Job Dispatch
    3. OCR & Multimodal Vision
    4. Anti-Fabrication Structuring & Provenance Tagging
    5. Completeness Check
    Persists per-page status, retries, error reasons, and user-visible progress.
    """
    try:
        doc = SourceDocument.objects.get(id=doc_id)
    except SourceDocument.DoesNotExist:
        return False

    doc.status = 'processing'
    doc.save(update_fields=['status'])

    file_path = doc.file.path if doc.file else None
    
    try:
        from .completeness import check_project_completeness

        filename_week = extract_week_from_string(doc.original_filename or "")

        if doc.file_type == 'pdf' and file_path and os.path.exists(file_path):
            pdf = pymupdf.open(file_path)
            doc.page_count = len(pdf)
            doc.save(update_fields=['page_count'])

            for page_index in range(len(pdf)):
                page_num = page_index + 1
                page = pdf[page_index]
                from .ocr_trace import page_trace_dir, save_page_trace, engine_version
                trace_dir = page_trace_dir(doc.id, page_num)
                native_pdf_words = [
                    {"text": word[4], "box": {"x0": word[0], "y0": word[1], "x1": word[2], "y1": word[3]}, "confidence": None}
                    for word in page.get_text("words")
                ]
                if trace_dir is not None:
                    page.get_pixmap(dpi=150).save(str(trace_dir / "original.png"))

                # Step 1: Create ExtractedPage in ocr_in_progress status
                extracted_page = ExtractedPage.objects.create(
                    document=doc,
                    page_number=page_num,
                    page_index=page_index,
                    extracted_text="",
                    confidence_score=0.95,
                    status='ocr_in_progress',
                    notes='',
                    is_reviewed=False
                )

                text = page.get_text("text").strip()
                confidence = 0.95
                notes = ''
                sig_detected = False
                sig_conf = 0.0
                vision_entries = []
                vision_data = {}
                trace_ocr_captured = False
                page_fallback_week = filename_week or 1

                # If text is too short or doesn't have structure, rasterize and run multimodal vision
                if len(text) < 50:
                    pix = page.get_pixmap(dpi=150)
                    temp_img_path = f"{file_path}_p{page_num}.png"
                    if trace_dir is not None:
                        temp_img_path = str(trace_dir / "original.png")
                    else:
                        pix.save(temp_img_path)
                    
                    v_text, v_conf, v_data = run_multimodal_vision_analysis(
                        temp_img_path,
                        filename_hint=f"{doc.original_filename or 'Document'} Page {page_num}"
                    )
                    vision_data = v_data
                    if v_text:
                        text = v_text
                        confidence = v_conf
                        notes = 'Analyzed with Gemini Flash Multimodal Vision'
                        sig_detected = bool(v_data.get('supervisor_signature_detected') or v_data.get('supervisor_signed'))
                        sig_conf = float(v_data.get('supervisor_signature_confidence', 0.85 if sig_detected else 0.0))
                        vision_entries = v_data.get('entries', [])

                        if v_data.get('cover_details'):
                            apply_cover_details_to_project(doc.project, v_data.get('cover_details'))
                    else:
                        ocr_text, ocr_conf = run_ocr_on_image(temp_img_path, trace_page_dir=trace_dir)
                        trace_ocr_captured = trace_dir is not None
                        if ocr_text:
                            text = ocr_text
                            confidence = ocr_conf
                        else:
                            confidence = 0.20
                            notes = 'Page appears to be scanned or handwritten. Please review and input or verify the text.'

                    if trace_dir is None and os.path.exists(temp_img_path):
                        try:
                            os.remove(temp_img_path)
                        except OSError:
                            pass

                if trace_dir is not None and not trace_ocr_captured and len(page.get_text("text").strip()) < 50:
                    run_ocr_on_image(str(trace_dir / "original.png"), trace_page_dir=trace_dir)

                # Step 2: Record OCR results and switch to structuring status
                low_conf_segs = detect_low_confidence_segments(text, confidence)
                extracted_page.extracted_text = text
                extracted_page.confidence_score = confidence
                extracted_page.low_confidence_segments = low_conf_segs
                extracted_page.supervisor_signature_detected = sig_detected
                extracted_page.supervisor_signature_confidence = sig_conf
                extracted_page.status = 'structuring'
                extracted_page.notes = notes
                extracted_page.save(update_fields=[
                    'extracted_text', 'confidence_score', 'low_confidence_segments',
                    'supervisor_signature_detected', 'supervisor_signature_confidence',
                    'status', 'notes'
                ])

                # Step 2.5: Classify page (logbook vs cover vs CV/certificate/other)
                classification = classify_page(text, vision_data)
                page_type = classification.get("page_type")
                page_label = classification.get("detected_label", "Page")
                extracted_page.notes = f"{notes} ({page_label})" if notes else page_label

                if page_type == "other":
                    extracted_page.status = 'completed'
                    extracted_page.save(update_fields=['status', 'notes'])
                    continue
                elif page_type == "cover_or_details":
                    if vision_data.get('cover_details'):
                        apply_cover_details_to_project(doc.project, vision_data.get('cover_details'))
                    extracted_page.status = 'completed'
                    extracted_page.save(update_fields=['status', 'notes'])
                    continue

                # Step 3: Structuring with anti-fabrication
                if vision_entries:
                    for idx, raw_entry in enumerate(vision_entries):
                        validated = validate_structured_entry_anti_fabrication(
                            source_text=text,
                            entry_data=raw_entry,
                            page_id=extracted_page.id,
                            page_num=page_num
                        )
                        entry_date = validated.get('entry_date')
                        entry_week = raw_entry.get('week_number')
                        if not entry_week and entry_date and doc.project.training_start_date:
                            entry_week = max(1, ((entry_date - doc.project.training_start_date).days // 7) + 1)
                        if not entry_week:
                            entry_week = page_fallback_week

                        is_flagged = validated.get('is_flagged', False)
                        start_d = doc.project.training_start_date
                        end_d = doc.project.training_end_date
                        if entry_date and start_d and end_d:
                            if entry_date < start_d or entry_date > end_d:
                                is_flagged = True

                        LogbookEntry.objects.create(
                            project=doc.project,
                            source_page=extracted_page,
                            week_number=entry_week,
                            entry_date=entry_date,
                            day_of_week=validated.get('day_of_week', f'Day {idx+1}'),
                            raw_text=sanitize_privacy_identifiers(validated.get('raw_text', '')),
                            verified_text=sanitize_privacy_identifiers(validated.get('verified_text', '')),
                            activity_summary=sanitize_privacy_identifiers(validated.get('activity_summary', ''))[:500],
                            tools_used=sanitize_privacy_identifiers(validated.get('tools_used', ''))[:500],
                            equipment_used=sanitize_privacy_identifiers(validated.get('equipment_used', ''))[:500],
                            technical_area=validated.get('technical_area', '')[:255],
                            has_supervisor_signature=validated.get('has_supervisor_signature', False),
                            confidence_scores=validated.get('confidence_scores', {}),
                            field_provenance=validated.get('field_provenance', {}),
                            is_flagged=is_flagged,
                            order=idx + 1,
                            is_verified=True
                        )
                elif text:
                    extract_logbook_entries_from_text(doc.project, extracted_page, text, fallback_week=page_fallback_week)
                else:
                    LogbookEntry.objects.create(
                        project=doc.project,
                        source_page=extracted_page,
                        week_number=page_fallback_week,
                        entry_date=None,
                        day_of_week="Weekly Log",
                        raw_text="",
                        verified_text="",
                        activity_summary=f"Week {page_fallback_week} Log (Transcribe from uploaded page)",
                        tools_used="",
                        equipment_used="",
                        technical_area="Practical Training",
                        has_supervisor_signature=False,
                        confidence_scores={'overall': 0.25},
                        field_provenance={'status': 'MISSING', 'reasoning': 'Page requires manual review or transcription'},
                        is_flagged=True,
                        is_verified=False,
                        order=LogbookEntry.objects.filter(project=doc.project, week_number=page_fallback_week).count() + 1
                    )

                # Step 4: Finalize page status
                if confidence < 0.35:
                    extracted_page.status = 'flagged_illegible'
                elif confidence < 0.65 or len(text.strip()) < 15:
                    extracted_page.status = 'manual_correction_needed'
                else:
                    extracted_page.status = 'completed'
                extracted_page.save(update_fields=['status'])

                if trace_dir is not None:
                    structured = list(doc.project.logbook_entries.filter(source_page=extracted_page).values(
                        "week_number", "entry_date", "day_of_week", "raw_text", "verified_text",
                        "activity_summary", "tools_used", "equipment_used", "technical_area",
                        "confidence_scores", "field_provenance", "is_flagged", "is_verified",
                    ))
                    save_page_trace(
                        trace_dir, page_number=page_num, final_text=text,
                        engine=("gemini_vision" if "Gemini" in notes else "tesseract" if "local OCR" in notes else "pymupdf_native" if len(page.get_text("text").strip()) >= 50 else "none"),
                        engine_version=engine_version("gemini_vision" if "Gemini" in notes else "tesseract" if "local OCR" in notes else "pymupdf_native" if len(page.get_text("text").strip()) >= 50 else "none"),
                        engine_data={"vision": vision_data, "confidence": confidence, "notes": notes},
                        structured_output=structured, native_pdf_words=native_pdf_words,
                    )

            pdf.close()

        elif doc.file_type == 'image' and file_path and os.path.exists(file_path):
            from .ocr_trace import page_trace_dir, copy_original_image, save_page_trace, engine_version
            trace_dir = page_trace_dir(doc.id, 1)
            if trace_dir is not None:
                copy_original_image(file_path, trace_dir)
            doc.page_count = 1
            doc.save(update_fields=['page_count'])
            
            # Step 1: Create ExtractedPage in ocr_in_progress status
            extracted_page = ExtractedPage.objects.create(
                document=doc,
                page_number=1,
                page_index=doc.page_index,
                extracted_text="",
                confidence_score=0.90,
                status='ocr_in_progress',
                notes='',
                is_reviewed=False
            )

            fallback_week = filename_week or 1

            vision_text, vision_conf, vision_data = run_multimodal_vision_analysis(
                file_path,
                filename_hint=doc.original_filename or ""
            )
            sig_detected = False
            sig_conf = 0.0
            notes = ''
            
            if vision_text:
                confidence = vision_conf
                text = vision_text
                notes = 'Analyzed with Gemini Flash Multimodal Vision'
                sig_detected = bool(vision_data.get('supervisor_signature_detected') or vision_data.get('supervisor_signed'))
                sig_conf = float(vision_data.get('supervisor_signature_confidence', 0.85 if sig_detected else 0.0))

                if vision_data.get('cover_details'):
                    apply_cover_details_to_project(doc.project, vision_data.get('cover_details'))
                if trace_dir is not None:
                    run_ocr_on_image(file_path, trace_page_dir=trace_dir)
            else:
                ocr_text, ocr_conf = run_ocr_on_image(file_path, trace_page_dir=trace_dir)
                if ocr_text:
                    confidence = ocr_conf
                    text = ocr_text
                    notes = 'Analyzed with local OCR engine'
                else:
                    confidence = 0.25
                    text = ''
                    notes = 'Scanned / handwritten image uploaded. Please verify and transcribe handwritten text.'

            # Step 2: Record OCR results and switch to structuring status
            low_conf_segs = detect_low_confidence_segments(text, confidence)
            extracted_page.extracted_text = text
            extracted_page.confidence_score = confidence
            extracted_page.low_confidence_segments = low_conf_segs
            extracted_page.supervisor_signature_detected = sig_detected
            extracted_page.supervisor_signature_confidence = sig_conf
            extracted_page.status = 'structuring'
            extracted_page.notes = notes
            extracted_page.save(update_fields=[
                'extracted_text', 'confidence_score', 'low_confidence_segments',
                'supervisor_signature_detected', 'supervisor_signature_confidence',
                'status', 'notes'
            ])

            # Step 2.5: Classify page (logbook vs cover vs CV/certificate/other)
            classification = classify_page(text, vision_data)
            page_type = classification.get("page_type")
            page_label = classification.get("detected_label", "Page")
            extracted_page.notes = f"{notes} ({page_label})" if notes else page_label

            if page_type == "other":
                extracted_page.status = 'completed'
                extracted_page.save(update_fields=['status', 'notes'])
            elif page_type == "cover_or_details":
                if vision_data.get('cover_details'):
                    apply_cover_details_to_project(doc.project, vision_data.get('cover_details'))
                extracted_page.status = 'completed'
                extracted_page.save(update_fields=['status', 'notes'])
            else:
                # Step 3: Structuring with anti-fabrication
                if vision_data and vision_data.get('entries'):
                    detected_week = vision_data.get('week_number')
                    week_num = detected_week if (detected_week and isinstance(detected_week, int) and detected_week > 0) else fallback_week
                    for idx, entry in enumerate(vision_data.get('entries', [])):
                        validated = validate_structured_entry_anti_fabrication(
                            source_text=text,
                            entry_data=entry,
                            page_id=extracted_page.id,
                            page_num=1
                        )
                        entry_date = validated.get('entry_date')
                        entry_week = entry.get('week_number')
                        if not entry_week and entry_date and doc.project.training_start_date:
                            entry_week = max(1, ((entry_date - doc.project.training_start_date).days // 7) + 1)
                        if not entry_week:
                            entry_week = week_num

                        is_flagged = validated.get('is_flagged', False)
                        start_d = doc.project.training_start_date
                        end_d = doc.project.training_end_date
                        if entry_date and start_d and end_d:
                            if entry_date < start_d or entry_date > end_d:
                                is_flagged = True

                        LogbookEntry.objects.create(
                            project=doc.project,
                            source_page=extracted_page,
                            week_number=entry_week,
                            entry_date=entry_date,
                            day_of_week=validated.get('day_of_week', f'Day {idx+1}'),
                            raw_text=sanitize_privacy_identifiers(validated.get('raw_text', '')),
                            verified_text=sanitize_privacy_identifiers(validated.get('verified_text', '')),
                            activity_summary=sanitize_privacy_identifiers(validated.get('activity_summary', ''))[:500],
                            tools_used=sanitize_privacy_identifiers(validated.get('tools_used', ''))[:500],
                            equipment_used=sanitize_privacy_identifiers(validated.get('equipment_used', ''))[:500],
                            technical_area=validated.get('technical_area', '')[:255],
                            has_supervisor_signature=validated.get('has_supervisor_signature', False),
                            confidence_scores=validated.get('confidence_scores', {}),
                            field_provenance=validated.get('field_provenance', {}),
                            is_flagged=is_flagged,
                            order=idx + 1,
                            is_verified=True
                        )
                elif text:
                    extract_logbook_entries_from_text(doc.project, extracted_page, text, fallback_week=fallback_week)
            else:
                LogbookEntry.objects.create(
                    project=doc.project,
                    source_page=extracted_page,
                    week_number=fallback_week,
                    entry_date=None,
                    day_of_week="Weekly Log",
                    raw_text="",
                    verified_text="",
                    activity_summary=f"Week {fallback_week} Log (Transcribe from uploaded page)",
                    tools_used="",
                    equipment_used="",
                    technical_area="Practical Training",
                    has_supervisor_signature=False,
                    confidence_scores={'overall': 0.25},
                    field_provenance={'status': 'MISSING', 'reasoning': 'Handwriting requires manual review or transcription'},
                    is_flagged=True,
                    is_verified=False,
                    order=LogbookEntry.objects.filter(project=doc.project, week_number=fallback_week).count() + 1
                )

            # Step 4: Finalize page status
            if confidence < 0.35:
                extracted_page.status = 'flagged_illegible'
            elif confidence < 0.65 or len(text.strip()) < 15:
                extracted_page.status = 'manual_correction_needed'
            else:
                extracted_page.status = 'completed'
            extracted_page.save(update_fields=['status'])

            if trace_dir is not None:
                structured = list(doc.project.logbook_entries.filter(source_page=extracted_page).values(
                    "week_number", "entry_date", "day_of_week", "raw_text", "verified_text",
                    "activity_summary", "tools_used", "equipment_used", "technical_area",
                    "confidence_scores", "field_provenance", "is_flagged", "is_verified",
                ))
                save_page_trace(
                    trace_dir, page_number=1, final_text=text,
                    engine="gemini_vision" if "Gemini" in notes else "tesseract" if "local OCR" in notes else "none",
                    engine_version=engine_version("gemini_vision" if "Gemini" in notes else "tesseract" if "local OCR" in notes else "none"),
                    engine_data={"vision": vision_data, "confidence": confidence, "notes": notes},
                    structured_output=structured,
                )

        elif doc.file_type == 'docx' and file_path and os.path.exists(file_path):
            doc_obj = DocxDocument(file_path)
            paragraphs = [p.text.strip() for p in doc_obj.paragraphs if p.text.strip()]
            full_text = '\n\n'.join(paragraphs)
            
            table_texts = []
            for table in doc_obj.tables:
                for row in table.rows:
                    row_text = ' | '.join(cell.text.strip() for cell in row.cells if cell.text.strip())
                    if row_text:
                        table_texts.append(row_text)
            
            if table_texts:
                full_text += '\n\nTable Data:\n' + '\n'.join(table_texts)

            doc.page_count = 1
            doc.save(update_fields=['page_count'])

            extracted_page = ExtractedPage.objects.create(
                document=doc,
                page_number=1,
                page_index=doc.page_index,
                extracted_text=full_text,
                confidence_score=0.98,
                status='completed',
                notes='Direct Word extraction',
                is_reviewed=False
            )
            if full_text:
                extract_logbook_entries_from_text(doc.project, extracted_page, full_text)

        elif doc.file_type == 'note':
            page = ExtractedPage.objects.create(
                document=doc,
                page_number=1,
                page_index=doc.page_index,
                extracted_text=doc.error_message or "",
                confidence_score=1.0,
                status='completed',
                notes='Typed note entered directly',
                is_reviewed=True
            )
            if doc.error_message:
                extract_logbook_entries_from_text(doc.project, page, doc.error_message)
            doc.error_message = ""

        # Run completeness check on project
        check_project_completeness(doc.project)

        doc.status = 'completed'
        doc.save(update_fields=['status', 'error_message'])
        
        if doc.project.status in ['draft', 'uploading']:
            doc.project.status = 'reviewing_sources'
            doc.project.save(update_fields=['status'])
            
        return True

    except Exception as e:
        doc.status = 'error'
        doc.error_message = str(e)
        doc.save(update_fields=['status', 'error_message'])
        return False
