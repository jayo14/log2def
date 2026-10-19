import os
import re
import shutil
import subprocess
from datetime import datetime
from PIL import Image, ImageEnhance, ImageFilter
import pymupdf
from docx import Document as DocxDocument
from django.conf import settings
from .models import SourceDocument, ExtractedPage, LogbookEntry


def run_ocr_on_image(image_path: str) -> tuple[str, float]:
    """
    Attempts to run OCR on an image file using tesseract CLI if installed.
    Returns (extracted_text, confidence_score).
    If OCR is not available, returns empty string and 0.0 confidence.
    """
    tesseract_bin = getattr(settings, 'TESSERACT_CMD', 'tesseract')
    if not shutil.which(tesseract_bin):
        return "", 0.0

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


def extract_logbook_entries_from_text(project, page_instance, text: str):
    """
    Heuristically parses daily or weekly entries from extracted text
    and creates LogbookEntry records for student review.
    """
    if not text or len(text.strip()) < 10:
        return

    lines = [line.strip() for line in text.split('\n') if line.strip()]
    current_week = 1
    
    # Check if a week header exists
    week_match = re.search(r'week\s*[:#-]?\s*(\d+)', text, re.IGNORECASE)
    if week_match:
        try:
            current_week = int(week_match.group(1))
        except ValueError:
            current_week = 1

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
            # Remove day name itself from summary if at beginning
            clean_chunk = re.sub(r'^(?:mon|monday|tue|tues|tuesday|wed|wednesday|thu|thur|thurs|thursday|fri|friday|sat|saturday)[\s:\-–—]+', '', chunk, flags=re.IGNORECASE).strip()
            summary = clean_chunk[:80].replace('\n', ' ') if clean_chunk else f"{day_name} Activities"
            
            LogbookEntry.objects.create(
                project=project,
                source_page=page_instance,
                week_number=current_week,
                day_of_week=day_name,
                raw_text=clean_chunk or chunk,
                verified_text=clean_chunk or chunk,
                activity_summary=summary,
                is_verified=False,
                order=i
            )
    else:
        # If no explicit days, create an entry for the page content
        summary = lines[0][:80] if lines else f"Page {page_instance.page_number} Activity"
        LogbookEntry.objects.create(
            project=project,
            source_page=page_instance,
            week_number=current_week,
            day_of_week="",
            raw_text=text,
            verified_text=text,
            activity_summary=summary,
            is_verified=False,
            order=LogbookEntry.objects.filter(project=project, week_number=current_week).count()
        )


def process_source_document(doc_id: int):
    """
    Main background or synchronous processing function for an uploaded document.
    """
    try:
        doc = SourceDocument.objects.get(id=doc_id)
    except SourceDocument.DoesNotExist:
        return False

    doc.status = 'processing'
    doc.save(update_fields=['status'])

    file_path = doc.file.path if doc.file else None
    
    try:
        if doc.file_type == 'pdf' and file_path and os.path.exists(file_path):
            pdf = pymupdf.open(file_path)
            doc.page_count = len(pdf)
            doc.save(update_fields=['page_count'])

            for page_index in range(len(pdf)):
                page_num = page_index + 1
                page = pdf[page_index]
                text = page.get_text("text").strip()
                confidence = 0.95
                page_status = 'processed'
                notes = ''

                # If text is too short, page might be scanned or image-based
                if len(text) < 30:
                    pix = page.get_pixmap(dpi=150)
                    temp_img_path = f"{file_path}_p{page_num}.png"
                    pix.save(temp_img_path)
                    
                    ocr_text, ocr_conf = run_ocr_on_image(temp_img_path)
                    if os.path.exists(temp_img_path):
                        try:
                            os.remove(temp_img_path)
                        except OSError:
                            pass

                    if ocr_text:
                        text = ocr_text
                        confidence = ocr_conf
                        page_status = 'processed'
                    else:
                        confidence = 0.20
                        page_status = 'manual_correction_needed'
                        notes = 'Page appears to be scanned or handwritten. Please review and input or verify the text.'

                extracted_page = ExtractedPage.objects.create(
                    document=doc,
                    page_number=page_num,
                    extracted_text=text,
                    confidence_score=confidence,
                    status=page_status,
                    notes=notes,
                    is_reviewed=False
                )

                if text:
                    extract_logbook_entries_from_text(doc.project, extracted_page, text)

            pdf.close()

        elif doc.file_type == 'image' and file_path and os.path.exists(file_path):
            doc.page_count = 1
            doc.save(update_fields=['page_count'])
            
            ocr_text, ocr_conf = run_ocr_on_image(file_path)
            if ocr_text:
                page_status = 'processed'
                confidence = ocr_conf
                notes = ''
            else:
                page_status = 'manual_correction_needed'
                confidence = 0.25
                notes = 'Scanned / handwritten image uploaded. Please verify and transcribe handwritten text.'

            extracted_page = ExtractedPage.objects.create(
                document=doc,
                page_number=1,
                extracted_text=ocr_text,
                confidence_score=confidence,
                status=page_status,
                notes=notes,
                is_reviewed=False
            )
            if ocr_text:
                extract_logbook_entries_from_text(doc.project, extracted_page, ocr_text)

        elif doc.file_type == 'docx' and file_path and os.path.exists(file_path):
            doc_obj = DocxDocument(file_path)
            paragraphs = [p.text.strip() for p in doc_obj.paragraphs if p.text.strip()]
            full_text = '\n\n'.join(paragraphs)
            
            # Also extract text from any tables
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
                extracted_text=full_text,
                confidence_score=0.98,
                status='processed',
                notes='Direct Word extraction',
                is_reviewed=False
            )
            if full_text:
                extract_logbook_entries_from_text(doc.project, extracted_page, full_text)

        elif doc.file_type == 'note':
            # Note with direct text provided
            page = ExtractedPage.objects.create(
                document=doc,
                page_number=1,
                extracted_text=doc.error_message or "", # Note content stored temporarily in error_message or separate note
                confidence_score=1.0,
                status='processed',
                notes='Typed note entered directly',
                is_reviewed=True
            )
            if doc.error_message:
                extract_logbook_entries_from_text(doc.project, page, doc.error_message)
            doc.error_message = ""

        doc.status = 'completed'
        doc.save(update_fields=['status', 'error_message'])
        
        # Advance project status if still draft/uploading
        if doc.project.status in ['draft', 'uploading']:
            doc.project.status = 'reviewing_sources'
            doc.project.save(update_fields=['status'])
            
        return True

    except Exception as e:
        doc.status = 'error'
        doc.error_message = str(e)
        doc.save(update_fields=['status', 'error_message'])
        return False
