# Log2Def — SIWES Logbook-to-Defence Platform

**Log2Def** is an AI-powered academic productivity platform engineered for Nigerian tertiary institution students (with initial tailoring for Lagos State University of Science and Technology — LASUSTECH). It transforms raw SIWES logbook entries, handwritten scans, photos, digital PDFs, and technical notes into a structured, editable, printable 5-chapter technical report and prepares students to defend their work.

---

## Key Features

1. **Document Processing & Source Verification**
   - Ingestion of PDF, JPG, PNG, DOCX, and typed/pasted notes.
   - Text extraction via PyMuPDF for digital documents.
   - Pillow image preprocessing with Tesseract OCR integration.
   - Graceful uncertainty handling: scans requiring transcription are flagged with `manual_correction_needed` rather than hallucinating fake text.
   - Automatic heuristic extraction of chronological weekly and daily logbook entries.
   - Bulk verification workflow for factual grounding.

2. **Institutional 5-Chapter Report Generation**
   - Built to Nigerian Industrial Training Fund (ITF) and LASUSTECH standards:
     - **Front Matter:** Cover page, Title page, Declaration, Certification (Industry Supervisor, Institutional Supervisor, HOD sign-off blocks), Dedication, Acknowledgements, Abstract, Table of Contents.
     - **Chapter One:** Introduction (Background to SIWES, Objectives, Scope & Significance).
     - **Chapter Two:** Organization Profile (Company overview, Organizational structure, Department of placement).
     - **Chapter Three:** Training Activities & Technical Experience (Environment, Tools deployed, Weekly chronological summary tables, Detailed procedures, Projects).
     - **Chapter Four:** Skills, Challenges & Solutions (Technical skills, Real workplace problems, Troubleshooting strategies, Lessons learned).
     - **Chapter Five:** Conclusion & Recommendations (Experience summary, Objectives realization, Actionable recommendations for host firm, university, and ITF).
     - **Back Matter:** References & Appendices.
   - **No-AI Development Mode:** Fully functional deterministic rule-based generator that synthesizes all real placement data without requiring an external API key.
   - **AI-Enhanced Mode:** Compatible with any OpenAI-compatible endpoint for academic prose refinement while strictly preserving factual bounds.
   - Section-by-section regeneration with edit preservation (`last_edited_by_student`).

3. **Authentic Academic Document Exports**
   - **DOCX Generation:** Built via `python-docx` with standard Nigerian academic binding specifications:
     - A4 Paper size (210mm x 297mm).
     - 1.5-inch (38.1mm) left margin for physical binding; 1.0-inch top, bottom, and right margins.
     - Times New Roman 12pt, 1.5 line spacing.
     - Preliminary Roman numeral page numbering (`i, ii, iii...`) and body Arabic page numbering.
   - **PDF Generation:** Rendered via headless LibreOffice (`libreoffice --headless --convert-to pdf`) ensuring exact document pagination, table formatting, and `%PDF-` validation.

4. **Oral Defence Preparation**
   - 15+ rigorous, grounded oral examination questions categorized into:
     - Organization & Objectives
     - Tasks & Projects Undertaken
     - Technical Tools & Equipment
     - Challenges & Troubleshooting
     - Examiner Cross-Examination & Authenticity Verification
   - Grounded context citing exact report chapters and logbook entries.
   - Model answers toggle and mastery tracking (`Confident`, `Needs Practice`).
   - Interactive **Mock Oral Defence Mode** simulating panel examination.

---

## Architecture & Tech Stack

- **Backend:** Python 3.12+ / 3.14, Django 6+, Django REST Framework, SimpleJWT, drf-spectacular (OpenAPI 3.0 / Swagger), PyMuPDF, python-docx, Pillow, Requests.
- **API Documentation:** Interactive Swagger UI documentation served at `/docs` (and OpenAPI schema at `/api/schema/`).
- **Database:** SQLite (default for development) / PostgreSQL (production-ready via `DB_ENGINE=postgres`).
- **Frontend:** Next.js 16 (App Router with Turbopack), React 19, TypeScript, Tailwind CSS, Lucide React, Tiptap.
- **Rendering:** Headless LibreOffice (`libreoffice`) for PDF compilation.

---

## Quickstart & Local Setup

### 1. Prerequisites
- Python 3.10+
- Node.js 18+ and npm
- LibreOffice (for PDF conversion): `sudo apt install libreoffice` (Linux) or via homebrew (macOS)
- Tesseract (optional, for image OCR): `sudo apt install tesseract-ocr`

### 2. Backend Setup

```bash
# Navigate to repository root
cd /path/to/log2def

# Activate virtual environment
source .venv/bin/activate

# Install dependencies
pip install -r backend/requirements.txt

# Configure environment variables
cp .env.example .env
cp .env.example backend/.env

# Run database migrations
python backend/manage.py migrate

# Start Django development server (runs on http://localhost:8000)
python backend/manage.py runserver 8000
```

### 3. Frontend Setup

```bash
# Navigate to frontend directory
cd frontend

# Install npm dependencies
npm install

# Start Next.js development server (runs on http://localhost:3000)
npm run dev
```

Visit `http://localhost:3000` to access Log2Def.

---

## Environment Variables (`.env`)

| Variable | Description | Default |
|---|---|---|
| `DJANGO_SECRET_KEY` | Secret key for Django | Preconfigured dev key |
| `DJANGO_DEBUG` | Debug mode | `True` |
| `DJANGO_ALLOWED_HOSTS` | Allowed hostnames | `localhost,127.0.0.1,0.0.0.0` |
| `DB_ENGINE` | Database type (`sqlite` or `postgres`) | `sqlite` |
| `DB_NAME` | PostgreSQL database name | `log2def` |
| `DB_USER` | PostgreSQL user | `postgres` |
| `DB_PASSWORD` | PostgreSQL password | `postgres` |
| `DB_HOST` | PostgreSQL host | `localhost` |
| `DB_PORT` | PostgreSQL port | `5432` |
| `AI_PROVIDER` | AI provider type | `openai` |
| `AI_API_KEY` | Server-side API key (leave empty for No-AI Mode) | `""` |
| `AI_MODEL` | LLM model for refinement | `gpt-4o-mini` |
| `AI_BASE_URL` | Optional custom OpenAI-compatible base URL | `https://api.openai.com/v1` |
| `LIBREOFFICE_PATH` | Path to LibreOffice binary | `libreoffice` |
| `TESSERACT_CMD` | Path to Tesseract OCR binary | `tesseract` |
| `NEXT_PUBLIC_API_URL`| Backend REST API endpoint for Next.js | `http://localhost:8000/api` |

---

## Running the Automated Test Suite

Log2Def includes automated tests for all critical backend modules:
- Student registration & JWT authentication
- Multi-tenant ownership isolation (404/denial across users)
- PDF extraction with PyMuPDF
- Image OCR & manual correction fallback flags
- Logbook parsing and bulk verification
- 5-chapter report generation and student edit preservation
- A4 DOCX generation and validated LibreOffice PDF rendering
- Defence question generation, mastery ratings, and session recording

Run the test suite:

```bash
source .venv/bin/activate
python backend/manage.py test api
```

Expected output:
```
Ran 8 tests in ~14s
OK
```

---

## Production Deployment Checklist

1. Set `DJANGO_DEBUG=False` and supply a strong random `DJANGO_SECRET_KEY`.
2. Configure `DB_ENGINE=postgres` with production PostgreSQL credentials.
3. Configure static files collection: `python backend/manage.py collectstatic --noinput`.
4. Run Django via Gunicorn / Uwsgi behind Nginx.
5. Deploy the Next.js frontend using `npm run build` and run with PM2 / Docker or on Vercel.
6. Mount a persistent private volume for `backend/media/` to store student uploads and exports.
