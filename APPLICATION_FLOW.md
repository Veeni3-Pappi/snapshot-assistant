# 🔄 Application Flow Diagram

## High-Level Architecture

```
┌─────────────┐
│   Browser   │ ← User Interface (HTML/CSS/JS)
│  (Mobile/   │   - Upload forms
│  Desktop)   │   - Status display
└──────┬──────┘   - Results viewer
       │
       │ HTTP Requests
       │
┌──────▼──────────────────────────────────────────┐
│           Express Server (Node.js)              │
│  ┌────────────────────────────────────────┐    │
│  │        Session Storage (Memory)         │    │
│  │  - CCTV Snapshots (Base64)             │    │
│  │  - Daily Book Image (Base64)           │    │
│  │  - Payment Records Image (Base64)      │    │
│  └────────────────────────────────────────┘    │
└──────┬──────────────────────────┬───────────────┘
       │                          │
       │ Image Analysis           │ Email Sending
       │                          │
┌──────▼──────────┐        ┌──────▼──────────┐
│  Claude API     │        │   Nodemailer    │
│  (Anthropic)    │        │  (SMTP/         │
│  - Vision Model │        │   SendGrid)     │
│  - Batch        │        │                 │
│    Analysis     │        │                 │
└─────────────────┘        └──────┬──────────┘
                                  │
                           ┌──────▼──────────┐
                           │  Email Server   │
                           │  - Gmail        │
                           │  - SendGrid     │
                           │  - Other SMTP   │
                           └─────────────────┘
```

---

## User Workflow

```
START
  │
  ├─→ [1] UPLOAD CCTV SNAPSHOTS
  │      │
  │      ├─ Select multiple images
  │      ├─ Click "Upload Snapshots"
  │      ├─ Files stored in memory (Base64)
  │      ├─ Status bar updates (count)
  │      └─ Can repeat multiple times ↻
  │
  ├─→ [2] UPLOAD DAILY BOOK (Optional)
  │      │
  │      ├─ Select one image
  │      ├─ Click "Upload Daily Book"
  │      ├─ File stored in memory
  │      └─ Status bar shows ✓
  │
  ├─→ [3] UPLOAD PAYMENT RECORDS (Optional)
  │      │
  │      ├─ Select one image
  │      ├─ Click "Upload Payment Records"
  │      ├─ File stored in memory
  │      └─ Status bar shows ✓
  │
  ├─→ [4] ANALYZE
  │      │
  │      ├─ Button enabled when CCTV snapshots > 0
  │      ├─ Click "Analyze Daily Operations"
  │      ├─ Loading spinner shows
  │      │
  │      ├─ Backend Process:
  │      │   ├─ Gather all images from memory
  │      │   ├─ Convert to Base64
  │      │   ├─ Build analysis prompt with rules
  │      │   ├─ Send ONE request to Claude API
  │      │   │   (All images in single batch)
  │      │   ├─ Wait for AI analysis
  │      │   └─ Return structured text
  │      │
  │      ├─ Results displayed on screen
  │      ├─ Formatted with client cards
  │      ├─ Blue alerts highlighted
  │      └─ "Generate & Email Report" button appears
  │
  ├─→ [5] GENERATE & EMAIL REPORT
  │      │
  │      ├─ Click "Generate & Email Report"
  │      ├─ Analysis text → HTML conversion
  │      │   ├─ Professional styling
  │      │   ├─ Mobile-responsive layout
  │      │   ├─ Blue alerts styled in blue
  │      │   └─ Client cards formatted
  │      │
  │      ├─ Email Sending:
  │      │   ├─ Connect to SMTP server
  │      │   ├─ Compose email with HTML body
  │      │   ├─ Send to recipient
  │      │   └─ Wait for confirmation
  │      │
  │      ├─ Success: "Report sent successfully"
  │      └─ Failure: Error shown, report still visible
  │
  └─→ [Clear Session] → Reset → START
```

---

## Data Flow in Analysis

```
User Uploads
    │
    ├─ CCTV Snapshot 1  ┐
    ├─ CCTV Snapshot 2  ├─→ Stored in Memory
    ├─ CCTV Snapshot 3  │   (as Buffer objects)
    ├─ Daily Book       │
    └─ Payment Records  ┘
         │
         ↓
    Convert to Base64
         │
         ↓
    Build Single Request
         │
         ├─ Text Prompt (with all 11 rules)
         ├─ CCTV Image 1 (base64)
         ├─ CCTV Image 2 (base64)
         ├─ CCTV Image 3 (base64)
         ├─ Daily Book Image (base64)
         └─ Payment Image (base64)
         │
         ↓
    Send to Claude API
    (Single API Call)
         │
         ↓
    Claude AI Processing
         │
         ├─ Analyzes ALL images together
         ├─ Identifies clients across images
         ├─ Groups snapshots by client
         ├─ Compares with Daily Book
         ├─ Verifies payments
         ├─ Applies all 11 rules
         ├─ Marks [BLUE ALERT] items
         └─ Generates structured report
         │
         ↓
    Return Text Analysis
         │
         ↓
    Display to User
```

---

## Email Generation Flow

```
Analysis Text
    │
    ├─ "CLIENT 1..."
    ├─ "CLIENT 2..."
    ├─ "[BLUE ALERT] ..."
    ├─ "EXCEPTIONS..."
    └─ "SUMMARY..."
         │
         ↓
    Parse & Format
         │
         ├─ Detect sections (CLIENT, EXCEPTIONS, SUMMARY)
         ├─ Create HTML structure
         ├─ Apply CSS styling
         ├─ Highlight [BLUE ALERT] in blue
         └─ Make mobile-responsive
         │
         ↓
    Generate Email
         │
         ├─ Subject: "Salon Daily Operations Report - [Date]"
         ├─ From: Configured sender
         ├─ To: REPORT_RECIPIENT_EMAIL
         └─ Body: HTML content
         │
         ↓
    Send via Nodemailer
         │
         ├─ SMTP Connection
         ├─ Authenticate
         ├─ Transmit email
         └─ Wait for server response
         │
         ├─→ SUCCESS → Show "Report sent successfully"
         │
         └─→ FAILURE → Show error, keep report visible
```

---

## Session Lifecycle

```
Server Start
    │
    ↓
Initialize Empty Session
    │
    ├─ cctvSnapshots: []
    ├─ dailyBook: null
    └─ paymentRecords: null
    │
    ↓
User Interacts
    │
    ├─ Upload CCTV → Add to cctvSnapshots[]
    ├─ Upload Daily Book → Set dailyBook
    ├─ Upload Payment → Set paymentRecords
    ├─ Analyze → Read all data
    └─ Generate Report → Read analysis
    │
    ↓
Session Ends (any of):
    │
    ├─→ User clicks "Clear Session"
    ├─→ Server restarts
    └─→ Browser refresh (frontend state only)
         │
         ↓
    Session Reset → Back to Empty State
```

---

## API Request/Response Flow

### Upload CCTV Snapshots

```
Client                          Server
   │                              │
   │──── POST /api/upload-cctv ───→│
   │     (multipart/form-data)     │
   │     [File, File, File]        │
   │                              │
   │                              ├─ Receive files via Multer
   │                              ├─ Store in sessionData.cctvSnapshots
   │                              ├─ Count total snapshots
   │                              │
   │←─── Response ─────────────────┤
   │     {success: true,            │
   │      message: "3 uploaded",    │
   │      totalSnapshots: 3}        │
   │                              │
```

### Analyze

```
Client                          Server                      Claude API
   │                              │                              │
   │──── POST /api/analyze ───────→│                              │
   │                              │                              │
   │                              ├─ Get all images              │
   │                              ├─ Convert to Base64           │
   │                              ├─ Build prompt                │
   │                              │                              │
   │                              │──── API Request ────────────→│
   │                              │    (all images + prompt)     │
   │                              │                              │
   │                              │                              ├─ Process
   │                              │                              ├─ Analyze
   │                              │                              └─ Generate
   │                              │                              │
   │                              │←─── Response ────────────────┤
   │                              │    (analysis text)           │
   │                              │                              │
   │←─── Response ─────────────────┤
   │     {success: true,            │
   │      analysis: "CLIENT 1..."}  │
   │                              │
```

### Generate & Email Report

```
Client                          Server                      Email Server
   │                              │                              │
   │─ POST /api/generate-report ──→│                              │
   │  {analysis: "CLIENT 1..."}    │                              │
   │                              │                              │
   │                              ├─ Convert analysis to HTML    │
   │                              ├─ Build email message         │
   │                              │                              │
   │                              │──── Send Email ─────────────→│
   │                              │    (HTML content)            │
   │                              │                              │
   │                              │                              ├─ Deliver
   │                              │                              │
   │                              │←─── Confirmation ────────────┤
   │                              │    (success/failure)         │
   │                              │                              │
   │←─── Response ─────────────────┤
   │     {success: true,            │
   │      message: "Report sent"}   │
   │                              │
```

---

## Security & Error Handling Flow

```
Every Request
    │
    ├─ Try-Catch Block
    │     │
    │     ├─→ Success Path
    │     │     └─→ Return JSON {success: true, ...}
    │     │
    │     └─→ Error Path
    │           ├─ Log error to console
    │           ├─ Return JSON {success: false, error: "..."}
    │           └─ HTTP 400/500 status
    │
    ↓
Frontend Receives Response
    │
    ├─→ success === true
    │     ├─ Show success message (green)
    │     └─ Update UI state
    │
    └─→ success === false
          ├─ Show error message (red)
          └─ Keep existing state (graceful degradation)
```

---

## Environment Configuration Flow

```
.env File
    │
    ├─ ANTHROPIC_API_KEY ──→ Used by Anthropic SDK
    ├─ EMAIL_SERVICE ────────┐
    ├─ EMAIL_USER ───────────┤→ Used by Nodemailer
    ├─ EMAIL_PASSWORD ───────┤
    └─ SENDGRID_API_KEY ─────┘
    │
    ↓
process.env (Runtime)
    │
    ↓
Server Initialization
    │
    ├─ Initialize Anthropic client
    └─ Initialize Email transporter
```

---

## Key Design Principles

1. **Batch Processing**: All images sent to Claude in ONE request
2. **In-Memory Storage**: No database, session data in RAM
3. **Real Email**: Actual SMTP send, not simulation
4. **Mobile-First**: Responsive design, touch-friendly
5. **Error Tolerance**: Graceful failures, clear messages
6. **No Assumptions**: "Unable to confirm" over guessing
7. **Blue Alert Rule**: Strict criteria for alerts
8. **Stateless Backend**: Each request independent (except session data)

---

This flow ensures:
- ✅ All images analyzed together (specification requirement)
- ✅ Real email delivery with feedback
- ✅ Mobile-friendly at every step
- ✅ Clear error handling
- ✅ Professional output formatting
