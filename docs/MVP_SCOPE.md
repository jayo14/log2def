I would make Log2Def a focused SIWES Technical Report Generator, not a general-purpose SIWES management platform.

The MVP has one job:
Turn a student's completed SIWES logbook into a properly structured, editable, professionally formatted technical report, with as little manual work as possible.

Everything should revolve around that outcome.

I'm also keeping the original LASUSTECH-first approach, accepting handwritten and digital logbook inputs, and preserving the logbook as the authoritative source of technical information.

No presentation slides, defence preparation, printing operations, or unnecessary management features in this MVP.
Log2Def: MVP product scope
Product definition
MVP

Logbook in. Technical report out.
A simple, AI-assisted document generation application for SIWES students.

Primary audience: LASUSTECH SIWES students.

Primary input: Photographs/scans of completed SIWES logbooks.

Primary output: Editable technical report, approximately 12–15 pages.

Primary success metric: A student can go from an empty account to a reviewed, downloadable technical report without needing to manually write the report from scratch.

1. The entire user journey
This is the flow I recommend. Six major steps, no unnecessary detours.
1. Enter your details
   
   Student name, matriculation number, department, institution, company details, training period and other basic information.
2. Capture or upload your logbook
   
   Take photographs directly from the web application, or upload existing photographs, scans or PDFs. Support bulk uploads.
3. Extract and review information
   
   OCR reads the logbook. AI structures the extracted information, identifies missing details and flags uncertain readings.
4. Complete missing information
   
   Ask the student only for information that is required but unavailable or unclear. Allow corrections to extracted information.
5. Generate your technical report
   
   Generate the complete report using the approved institutional template and information from the logbook.
6. Edit, preview and download
   
   Review and edit the generated document, save changes, and export the final report as PDF or DOCX.

The important UX principle: don't make students navigate six different dashboard modules. Make these steps feel like one continuous process.
2. Functional scope
A. Student information and training details
Must have
The student should provide their basic information once.
Field	Required
Full name	Yes
Matriculation number	Yes
Department	Yes
Faculty/School	Yes
Institution	Yes
SIWES company/organisation	Yes
Company address	Yes
Department/unit at company	If applicable
Training start date	Yes
Training end date	Yes
Industry supervisor	If required by template
Institution supervisor	If required by template

UX requirement: Pre-fill information wherever it can be reliably extracted from the logbook. Don't ask students to enter the same information twice.
B. Logbook capture and bulk upload
Must have · Core feature
This is one of the most important parts of Log2Def.

Students should have two ways to provide their logbooks:









Capture with camera

Photograph pages directly inside Log2Def.










Upload existing files

Select multiple images or PDF documents at once.


Camera requirements
- Request camera access from the browser.
- Support mobile rear-camera selection where available.
- Capture multiple pages without restarting the camera.
- Provide a thumbnail preview of captured pages.
- Allow retaking and deleting individual pages.
- Allow users to capture from the cover to the final page.
- Allow bulk submission after capturing.
Bulk upload requirements
- Accept JPG, JPEG, PNG, WebP and PDF.
- Support multiple file selection.
- Preserve page ordering.
- Allow reordering and deleting pages.
- Show upload progress per file and overall.
- Handle large submissions without loading all image files into memory simultaneously.
Critical low-memory requirements

This is particularly important because students may use low-end Android phones.
1. Process captured images individually.
2. Compress images before uploading while preserving enough detail for OCR.
3. Generate thumbnails rather than retaining full-resolution previews.
4. Release temporary image URLs and image-processing resources when no longer needed.
5. Upload in small batches with bounded concurrency.
6. Persist upload progress so interrupted uploads can resume.
7. Avoid holding all original images in browser memory.
8. Provide clear feedback when an image is too blurry, dark or unreadable.
I would use a sequential processing pipeline rather than processing 50 photographs simultaneously.

Important: Students should not have to worry about file limits caused by your implementation. Introduce sensible per-file and total submission limits only where necessary for reliability, and communicate them clearly.
C. OCR and intelligent extraction
Must have · Core feature
Once uploaded, the system should:
- Detect and process individual logbook pages.
- Extract handwritten and printed text.
- Identify dates and weekly entries.
- Extract daily activities and technical tasks.
- Identify tools, technologies, equipment and software.
- Extract company and student details.
- Identify training periods.
- Detect signatures, tables and other relevant structures where possible.
- Organise extracted information into structured records.
The AI layer should transform raw OCR output into meaningful information.

For example:
EXAMPLE · RAW LOGBOOK ENTRY

"Mon: Introduction to HTML. Learnt tags and created a simple webpage. Tues: CSS styling and worked on a login page."

STRUCTURED INFORMATION

Technical area: Frontend Web Development

Activities:
- Introduction to HTML structure and elements.
- Development of a basic webpage.
- Introduction to CSS styling.
- Development of a login page interface.
Skills acquired: HTML, CSS and basic interface development.

The system must distinguish between:
- Information explicitly recorded in the logbook.
- Information inferred from recorded activities.
- Information that is missing and needs student input.
Never invent projects, technologies, activities, accomplishments or work experience.
D. Missing information and validation
Must have
This is a critical part of the experience.

After extraction, Log2Def should perform a completeness check against the selected report template.

For example:
Information	Status
Student name	Found
Matric number	Found
Company name	Found
Company address	Missing
Training start date	Found
Training end date	Missing

The application should then ask only for the missing information.

Requirements:
- Allow correction of incorrectly extracted text.
- Highlight uncertain OCR results.
- Ask targeted questions for missing required fields.
- Validate dates and other structured information.
- Allow students to confirm extracted information.
- Prevent report generation when essential information is missing.
- Allow optional information to remain blank where the template permits it.
Don't make the student fill another long form after uploading their logbook.
E. Technical report generation
Must have · Core feature
This is the actual product.

Log2Def should generate a complete SIWES technical report using:
1. Student information.
2. Company information.
3. Extracted logbook activities.
4. Confirmed corrections and additional details.
5. The approved LASUSTECH report template.
Proposed document structure

The following is a working structure. The actual institutional template and lecturer-approved examples should determine the final headings and ordering.
Generated technical report
Illustrative document outline
1. Cover Page
   
   Student details, matric number, institution, company, training period.
2. Certification / Approval Page
   
   Where required by the approved template.
3. Dedication
   
   Where required.
4. Acknowledgement
5. Abstract
6. Table of Contents
7. Chapter One: Introduction
   
   SIWES overview, objectives and relevance.
8. Chapter Two: Organisation Profile
   
   Company background, structure, services and department.
9. Chapter Three: Training Activities
   
   Technical activities, tasks, tools, technologies and weekly experiences.
10. Chapter Four: Skills and Experience
    
    Knowledge acquired, practical applications, challenges and solutions.
11. Chapter Five: Conclusion and Recommendations
12. References / Appendices
    
    Where applicable and supported by the source material.

Document formatting requirements
Element	Requirement
Font	Times New Roman
Body text	12pt, subject to template
Main headings	Consistent chapter formatting
Line spacing	Template-defined, typically 1.5
Alignment	Justified body text
Margins	Approved departmental specifications
Cover page	Properly formatted
Header/footer	As required by template
Table of contents	Automatically generated
Page numbers	Correct front-matter and main-matter numbering

Pagination is especially important.
- Preliminary pages use lowercase Roman numerals: i, ii, iii, iv...
- Main report pages use Arabic numerals: 1, 2, 3...
- The first main chapter begins at page 1.
- Page numbering should be continuous within each section.
- The cover page should follow the approved template's numbering convention, commonly without a visible page number.
- The table of contents must reflect actual page numbers.
Page count target: 12–15 pages.

This is a target, not permission to pad the report with repetitive or fabricated content. The generator should use the approved template, meaningful technical content and sensible pagination to achieve the target. Flag insufficient source material rather than inventing information.
F. Report editor and preview
Must have
Generating the report is not the end of the workflow.

Students must be able to edit the report after generation.

Required capabilities:
- View the generated document.
- Edit headings and paragraphs.
- Correct spelling and grammatical errors.
- Modify student and company details.
- Edit generated sections.
- Save changes automatically.
- Preview page layouts.
- Regenerate the table of contents and pagination after changes.
- Download the final report.
I recommend a document-oriented editor, not a generic collection of form fields.

The user should feel like they're editing a Word document, not configuring an AI chatbot.
G. Export and download
Must have
Two export formats:
- DOCX: editable in Microsoft Word and compatible applications.
- PDF: ready for submission or printing.
Both must preserve formatting, page numbering, margins, headings and tables as accurately as possible.

3. Features explicitly outside the MVP
These are features I would hide behind feature flags or remove from the active navigation.
Feature	MVP decision
SIWES defence preparation	Disabled
AI-generated defence questions	Disabled
Presentation slide generation	Disabled
Presentation slide editor	Disabled
Slide templates	Disabled
Printing and binding management	Disabled
Delivery management	Disabled
Printing-shop integrations	Disabled
University administration dashboard	Disabled
Supervisor portal	Disabled
Supervisor approval workflow	Disabled
Collaborative report editing	Disabled
Multiple institutional templates	Later
Advanced analytics dashboard	Disabled
AI chat assistant	Disabled
Subscription management	Disabled
Payment integrations	Later
Automated report-quality diagnostics	Basic validation only
Autonomous AI agents	Disabled

One distinction: basic document validation is essential. A separate advanced AI quality-analysis product is not.
4. Feature flag structure
I recommend grouping flags by capability rather than creating a flag for every tiny UI element.

These are the flags I'd use:
Feature flag	Default
logbook_camera_capture	ON
logbook_bulk_upload	ON
logbook_pdf_upload	ON
logbook_image_processing	ON
ocr_extraction	ON
ai_logbook_structuring	ON
missing_information_collection	ON
report_generation	ON
report_editor	ON
report_preview	ON
report_docx_export	ON
report_pdf_export	ON
report_quality_validation	ON
defence_preparation	OFF
slide_generation	OFF
payment_processing	OFF
print_fulfilment	OFF
delivery_management	OFF
supervisor_portal	OFF
institution_management	OFF
advanced_analytics	OFF
ai_chat_assistant	OFF

Don't use feature flags as a substitute for access control. Disabled functionality must also be unavailable through its API endpoints, not merely hidden from the frontend.
5. Non-functional requirements
These are not optional extras. They determine whether Log2Def will actually work for its target audience.
Area	Requirement
Performance	Work reliably on low-end Android devices.
Memory	Bounded image processing and upload concurrency.
Reliability	Recover from interrupted uploads.
Security	Students can only access their own reports and uploads.
Storage	Original logbook files must be securely stored.
AI accuracy	Never fabricate logbook activities.
Document quality	Consistent formatting and pagination.
Persistence	Generated reports and edits must survive reloads.
Responsiveness	Mobile-first experience.
Accessibility	Clear controls, readable text and understandable errors.

I'd also make sure OCR and AI processing happen asynchronously on the backend. The browser should not be responsible for processing an entire logbook with heavy AI operations.
6. MVP acceptance criteria
Log2Def is ready for its first real users when these scenarios work:
- [ ] A student can enter their basic information.
- [ ] A student can capture multiple logbook pages using their phone.
- [ ] A student can bulk-upload existing logbook photographs.
- [ ] A student can upload a PDF logbook.
- [ ] Large submissions don't crash low-memory devices.
- [ ] Uploads preserve page order.
- [ ] The system extracts handwritten and printed information.
- [ ] The system identifies missing and uncertain information.
- [ ] Students can correct extracted information.
- [ ] The system refuses to silently invent missing experiences.
- [ ] A complete technical report can be generated.
- [ ] The report follows the approved institutional template.
- [ ] Preliminary and main report pagination work correctly.
- [ ] The report can be edited after generation.
- [ ] Changes persist when the student leaves and returns.
- [ ] DOCX and PDF exports are downloadable.
- [ ] The final document is approximately 12–15 pages when sufficient source material exists.
7. Recommended application navigation
Keep it extremely small.
Log2Def

MVP navigation


Home

My Logbooks

My Reports

Settings


Home screen
Turn your logbook into a technical report.
Upload your completed SIWES logbook. We'll extract your activities and help you prepare your technical report.
Start a new report


You don't need a complicated dashboard. The main action should be starting a new report.

8. What I would NOT compromise on
There are four product decisions I consider fundamental:
1. Logbook-first: The logbook is the source of truth. AI must not manufacture experiences to make a report look impressive.
2. Minimal interaction: Students should not have to manually rewrite their entire logbook into forms.
3. Editable output: AI-generated reports are drafts until the student reviews and approves them.
4. Reliable documents: A beautifully generated report with incorrect page numbering, broken tables or inconsistent formatting is not a finished product.
One additional consideration: the report template should be versioned. Your departmental requirements may change, and previously generated reports should not unexpectedly change when you update the template.
9. My recommended implementation priority
If I were managing this as your CTO, I'd enforce this order:
1. P0
   Capture and ingestion
   
   Camera, bulk upload, PDF support, image optimisation and upload reliability.
2. P0
   Extraction and validation
   
   OCR, AI structuring, missing information and correction.
3. P0
   Report generation
   
   Template, content generation, pagination, document formatting.
4. P0
   Editing and export
   
   Document editor, autosave, preview, DOCX and PDF.
5. P0
   End-to-end reliability
   
   Test the complete journey on actual low-end Android devices and real handwritten logbooks.

My final recommendation: Freeze this scope. Don't introduce new features until the complete journey works reliably.

The biggest risk isn't whether Log2Def has enough features. It's whether a student can photograph 30–50 logbook pages on an inexpensive phone, upload them without crashing, get accurate extraction, answer a few missing-information questions and receive a properly formatted report.

If you solve that exceptionally well, you have a product students can recommend to one another.

And that's the product I'd launch.
