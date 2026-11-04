# Log2Def Mobile Capture & Upload Manual Test Checklist
**Target Device Profile:** Low-end Android Smartphone (e.g., Tecno Spark 8/9/10, Infinix Hot 11/12, Redmi 9A/10A) with 2GB–3GB RAM, Chrome for Android (v115+), testing a full 40-page SIWES logbook submission.

---

## 1. Test Environment Setup
- [ ] **Device:** Physical Android device (≤3GB RAM) running Chrome or Chromium-based mobile browser.
- [ ] **Logbook:** Physical or printed 40-page SIWES logbook (1 cover page + 39 weekly/daily activity pages).
- [ ] **Network Conditions:** Standard 3G/4G cellular connection (or throttled WiFi matching ~1.5 Mbps upload).
- [ ] **Account:** Active student account on Log2Def with an active SIWES Report Project created.

---

## 2. In-Browser Camera Capture Verification (Group B.1)

### 2.1 Permissions & Rear Camera Initialization
- [ ] Navigate to the Dashboard -> **Logbook** tab.
- [ ] Tap **Snap with Camera**.
- [ ] Confirm browser displays camera permission dialog.
- [ ] Grant permission.
- [ ] **Pass Criteria:**
  - Viewfinder initializes within 2.5 seconds.
  - The **rear (environment) camera** is selected by default without manual switching.
  - Camera stream fills viewport smoothly without tearing or high latency.

### 2.2 Continuous Multi-Page Capture (Cover-to-Last-Page)
- [ ] Note header label: indicates `Next target: Cover Page • 0 snapped`.
- [ ] Tap the white/green shutter button to capture the Cover Page.
- [ ] Verify shutter flash animation triggers (~200ms) and camera stream **remains continuously active** (stream does NOT stop or re-request permissions).
- [ ] Note header label automatically advances to `Next target: Page 2 • 1 snapped`.
- [ ] Continuously capture pages 2 through 40 in sequence.
- [ ] **Pass Criteria:**
  - Snapping 40 photos is seamless without video freezing or stream resets.
  - Thumbnail tray at the bottom scrolls horizontally and displays all 40 mini-thumbnails.
  - Memory does not leak: Chrome Android does not reload the tab or terminate the process.

### 2.3 Blur & Lighting Quality Heuristics (Group B.3)
- [ ] **Darkness Test:** Point camera at a dimly lit corner (or cup hand partially over lens) and snap.
  - **Pass Criteria:** Amber banner appears: *"Too dark: The page is poorly lit. Turn on your flashlight or move near sunlight and retake."*
  - Tap **Retake**: Most recent shot is discarded; counter decrements by 1.
- [ ] **Blur Test:** Rapidly wave phone while tapping shutter.
  - **Pass Criteria:** Amber banner appears: *"Blurry image: Handwriting appears out of focus. Rest phone on a steady surface and retake."*
  - Tap **Retake**: Blurry shot is discarded.
- [ ] Snap a clean, steady shot:
  - **Pass Criteria:** Quality notice dismisses; shot is appended to thumbnail tray.

### 2.4 Individual Thumbnail Review & Page Deletion
- [ ] In the thumbnail preview strip at the bottom of the camera modal:
  - Locate any page thumbnail.
  - Hover or tap thumbnail to reveal the `✕` delete button.
  - Tap `✕` on a page.
- [ ] **Pass Criteria:**
  - Selected page is removed immediately.
  - Subsequent pages automatically re-index sequentially (`Cover Page`, `Page 2`, `Page 3`, etc.).

---

## 3. Memory Safety & Client-Side Compression Verification

### 3.1 Resource Disposal & RAM Consumption
- [ ] Connect Android phone to PC via USB and open `chrome://inspect/#devices`.
- [ ] Open Chrome DevTools Memory / Performance tab for the Log2Def mobile tab.
- [ ] Record heap snapshot during the 40-page capture session.
- [ ] **Pass Criteria:**
  - JS Heap Size remains below 45MB throughout the 40-page session.
  - No detached `HTMLCanvasElement` or leaking `Blob`/`MediaStream` instances retained.
  - Micro-thumbnails consume <350KB total in IndexedDB.
  - Processed image Blobs are resized to max 1600px longest edge at JPEG quality 0.82 (~180KB–300KB each, rather than raw 5MB–10MB camera files).

---

## 4. Bulk Upload, Queue Persistence & Bounded Concurrency

### 4.1 Bounded Concurrency Ingestion
- [ ] In the Camera modal, tap **Done (40)**.
- [ ] Camera stream tracks stop immediately; modal closes.
- [ ] Observe upload progress banner:
  - Banner shows: *"Uploading & analyzing 40 logbook files..."*
  - Progress bar advances smoothly.
- [ ] Open Network tab in remote DevTools:
  - Filter by `/api/projects/{id}/documents/`.
- [ ] **Pass Criteria:**
  - Concurrency is strictly bounded: **at most 2 upload requests are executed simultaneously**.
  - No mobile network saturation or HTTP 504 Gateway Timeouts.

### 4.2 Offline Resilience & Automatic Resumption
- [ ] While upload is in progress (e.g. at 15 of 40 files), toggle phone to **Airplane Mode**.
- [ ] Observe UI:
  - Active requests fail gracefully; status switches to *"Offline / 25 queued page(s) (Saved Offline)"*.
  - Upload items are safely persisted inside IndexedDB (`Log2DefUploadsDB` -> `upload_queue`).
- [ ] **Hard Refresh Tab:** Swipe down or tap Reload in mobile Chrome.
- [ ] Reopen Dashboard -> **Logbook** tab:
  - **Pass Criteria:** All 25 remaining queued pages are restored from IndexedDB in their exact order.
- [ ] Turn off Airplane Mode (reconnect WiFi / 4G):
  - **Pass Criteria:** Auto-resume triggers automatically on window `online` event; remaining 25 files resume uploading 2-by-2 without user intervention.

### 4.3 Idempotent Upload Verification
- [ ] Inspect the payload of retried requests:
  - Verify `client_upload_id` and `page_index` are present in FormData.
- [ ] In case of duplicate transmission of an already uploaded page:
  - **Pass Criteria:** Backend returns `200 OK` with the existing document without creating duplicate records or running duplicate AI OCR processing.

---

## 5. Explicit Page Ordering & Reordering Verification

### 5.1 Queue Reordering Before Upload
- [ ] Add 3 new pages to the offline queue.
- [ ] In the queued items list:
  - Tap `arrow_downward` on `Cover Page` (Item 0).
- [ ] **Pass Criteria:**
  - Item 0 swaps positions with Item 1.
  - Labels update to reflect the new sequence.
  - Refreshing the page preserves the reordered sequence from IndexedDB.

### 5.2 Server-Side Document Reordering After Upload
- [ ] Switch to the **Documents** sub-tab in Logbook.
- [ ] Locate the uploaded documents list (sorted by `page_index`).
- [ ] On Page 2, tap `arrow_upward`.
- [ ] **Pass Criteria:**
  - Page 2 moves to position 0 (`Cover Page`).
  - Backend `PATCH /api/projects/{id}/documents/reorder/` responds with `200 OK`.
  - Reloading page verifies backend persists the new order in PostgreSQL.

---

## 6. Document File Format Validation Verification

- [ ] Attempt upload of `.jpg`, `.jpeg`, `.png`, `.webp`, `.pdf` files.
  - **Pass Criteria:** All valid files are accepted and processed.
- [ ] Attempt upload of an invalid/renamed file (e.g., an `.exe` renamed to `.png`).
  - **Pass Criteria:** Backend security validator catches magic byte mismatch and returns HTTP 400 with a clear error:
    `"File content does not match allowed document types (PDF, JPG, PNG, WEBP, DOCX)."`
- [ ] Attempt upload of a file > 15MB.
  - **Pass Criteria:** Rejected with clear error message stating 15MB limit.

---

## 7. Sign-Off Summary
| Check | Status | Notes |
|---|---|---|
| Camera rear-camera preference & continuous stream | [ ] PASS | Tested on Android Chrome |
| Low-RAM safety (JS heap < 45MB across 40 snaps) | [ ] PASS | Memory canvases closed, object URLs revoked |
| Blur & darkness quality warnings | [ ] PASS | Laplacian & luma heuristics responsive |
| Offline queue IndexedDB persistence | [ ] PASS | Survives tab close / reload |
| Bounded concurrency (2 parallel workers) | [ ] PASS | Prevents network stall & OOM |
| Upload idempotency (`client_upload_id`) | [ ] PASS | Zero duplicate records on retry |
| Document reordering (`page_index`) | [ ] PASS | Drag/arrow reordering persisted |
