# Testing Guide

This guide helps you verify that the Salon Snapshot Assistant works correctly according to all specifications.

## Pre-Testing Setup

1. ✅ `.env` file configured with valid API keys
2. ✅ Server running: `npm start`
3. ✅ Browser open to `http://localhost:3000`
4. ✅ Test images ready (can use any photos initially)

## Test 1: UI and Upload Flow

### Expected Behavior
- All 5 action sections visible in order
- Status bar shows 0 snapshots, ✗ for Daily Book and Payment
- Analyze button is DISABLED until snapshots uploaded
- Generate & Email button is HIDDEN until analysis complete

### Steps
1. Open app in browser
2. Verify status bar shows zeros/✗
3. Verify Analyze button is disabled (grayed out)
4. Verify Generate & Email button is not visible

### ✅ Pass Criteria
- UI matches expected state
- Mobile-responsive (test by resizing browser)

## Test 2: CCTV Snapshot Upload

### Steps
1. Click "Choose Files" under "Upload CCTV Snapshots"
2. Select 2-3 images
3. Click "Upload Snapshots"
4. Wait for success message
5. Verify status bar updates (shows count > 0)
6. Upload 2-3 MORE images
7. Verify count increases

### ✅ Pass Criteria
- Success message appears after each upload
- Status bar shows cumulative count
- Can upload multiple times
- Analyze button becomes ENABLED

## Test 3: Optional Uploads

### Daily Book
1. Select one image
2. Click "Upload Daily Book"
3. Verify success message
4. Verify status bar shows ✓

### Payment Records
1. Select one image
2. Click "Upload Payment Records"
3. Verify success message
4. Verify status bar shows ✓

### ✅ Pass Criteria
- Both upload successfully
- Status indicators update
- Can upload even if not "real" daily book/payment photos (for testing)

## Test 4: Analysis (Core Functionality)

### Critical Requirements
- Images sent to Claude in ONE batch
- Analysis must group by client
- Must not guess/invent information
- Must use "Unable to confirm" for uncertain items

### Steps
1. Ensure at least 1 CCTV snapshot uploaded
2. Click "Analyze Daily Operations"
3. Wait for loading spinner
4. Observe analysis results

### ✅ Pass Criteria
- Loading indicator appears
- Analysis completes without error
- Results displayed in formatted cards
- Generate & Email button appears
- Analysis includes:
  - CLIENT [number] headers
  - Snapshot descriptions
  - Report sections (Arrival, Reception, Services, Staff, Payment, etc.)
  - Uses "Unable to confirm" where appropriate
  - Never invents information from thin air

### If Daily Book Uploaded
- Each client should have "Daily Book Status" section

### If Payment Records Uploaded
- Payment status uses ONLY these phrases:
  - "Paid — Confirmed"
  - "Payment found"
  - "Payment not found"
  - "Unable to verify"

### If NO Payment Records Uploaded
- Payment section should say: "Payment: Not provided for verification"

## Test 5: Blue Alert Rule (Critical)

### Test Scenario
To properly test this, you need:
1. CCTV snapshots showing a service being performed
2. Daily Book photo that does NOT have that service recorded

### Expected Behavior
- [BLUE ALERT] marker appears ONLY for:
  - Service visible in CCTV
  - NOT found in Daily Book
- [BLUE ALERT] should NOT appear for:
  - "Unable to confirm" situations
  - Missing clients (different alert)
  - General uncertainty

### ✅ Pass Criteria
- Blue alerts styled with blue background
- Only appear for the specific condition above
- Appear in both analysis view AND email report
- Format: "🔵 [Service] — [Staff] — NOT RECORDED IN DAILY BOOK"

## Test 6: Email Delivery (Critical)

### Pre-Check
1. Verify `.env` has correct email configuration
2. Verify `REPORT_RECIPIENT_EMAIL` is set
3. Ensure you have access to that email account

### Steps
1. Complete an analysis (Test 4)
2. Click "Generate & Email Report"
3. Wait for response

### ✅ Pass Criteria

**On Success:**
- Success message: "Report sent successfully to [email]"
- Check recipient inbox (and spam folder)
- Email received with:
  - Subject: "Salon Daily Operations Report - [Date]"
  - Formatted HTML content
  - All client cards visible
  - Blue alerts styled in blue
  - Exceptions section
  - Summary section
  - Mobile-readable formatting

**On Failure:**
- Error message displayed: "Failed to send email: [error details]"
- Analysis STILL VISIBLE on screen
- User can see report even though email failed
- NEVER says "sent successfully" if it actually failed

## Test 7: Multiple Clients

### Setup
Upload 6+ CCTV snapshots that could represent 2-3 different clients

### Expected Behavior
- Analysis groups snapshots by person
- Separate client cards (CLIENT 1, CLIENT 2, etc.)
- Numbered chronologically by first appearance
- Same person's snapshots NOT split into different clients

### ✅ Pass Criteria
- Clients properly identified and grouped
- Chronological numbering
- No duplicate entries for same person

## Test 8: Error Handling

### Test 8a: No Snapshots
1. Clear session
2. Click Analyze with no uploads
3. Expected: Error message "No CCTV snapshots uploaded"

### Test 8b: Invalid Email Config
1. Temporarily break email config in `.env`
2. Restart server
3. Do analysis
4. Try to email report
5. Expected: Error message shown, report still visible

### Test 8c: Invalid API Key
1. Temporarily set wrong `ANTHROPIC_API_KEY`
2. Restart server
3. Try analysis
4. Expected: Error message with API error details

### ✅ Pass Criteria
- All errors caught and displayed to user
- No crashes or white screens
- User can recover from errors

## Test 9: Session Management

### Steps
1. Upload files
2. Do analysis
3. Click "Clear Session (Start New Day)"
4. Confirm the prompt
5. Verify:
   - Status bar resets to 0/✗/✗
   - Analysis results cleared
   - Generate & Email button hidden
   - Analyze button disabled
   - File inputs cleared

### ✅ Pass Criteria
- Complete session reset
- Ready for new day's data

## Test 10: Mobile Device Testing

### If Possible
1. Access app from actual mobile device
2. Use phone's local IP address
3. Test all upload flows
4. Verify touch-friendly interface

### ✅ Pass Criteria
- All buttons easily tappable
- File picker works on mobile
- Layout doesn't break
- Readable text size
- No horizontal scrolling

## Test 11: Comprehensive End-to-End

### Full Workflow
1. **Fresh start**: Clear session
2. **Upload 8-10 CCTV snapshots** in 2 batches
3. **Upload Daily Book photo**
4. **Upload Payment Records photo**
5. **Analyze**
6. **Review analysis** for:
   - Multiple clients identified
   - Services listed or "Unable to confirm"
   - Daily Book Status comparisons
   - Payment status with correct phrases
   - Any blue alerts if applicable
7. **Generate & Email Report**
8. **Verify email received**
9. **Check email formatting**:
   - All client cards present
   - Professional appearance
   - Readable on mobile device
   - Blue alerts styled correctly
   - Exceptions section (if any)
   - Summary section

### ✅ Pass Criteria
- Complete workflow works smoothly
- No errors or crashes
- Report is accurate and well-formatted
- Email successfully delivered

## Test 12: Specification Compliance

### Critical Rules Verification

Read through each analysis result and verify:

1. **Never analyzed in isolation**: Images processed together ✅
2. **Grouped by client**: Same person's snapshots together ✅
3. **Chronological numbering**: Client 1, 2, 3... ✅
4. **Stage order**: Entry → Reception → Service → Payment → Exit ✅
5. **Never invents**: Only reports visible information ✅
6. **Services identified**: Only when clearly visible ✅
7. **"Unable to confirm"**: Used for uncertainty ✅
8. **Daily Book comparison**: Present when uploaded ✅
9. **Payment verification**: Follows exact phrase rules ✅
10. **Blue alerts**: ONLY for CCTV-visible service missing from Daily Book ✅
11. **No payment assumption**: Never assumes paid just because client left ✅

### ✅ Pass Criteria
- All 11 rules followed in every analysis
- No guessing or invention
- No false blue alerts

## Performance Testing

### Large Upload Test
1. Upload 20+ images
2. Verify analysis completes (may take longer)
3. Check memory usage (should not crash)

### Concurrent Session Test
1. Open app in 2 different browsers
2. Upload different files in each
3. Verify sessions are independent
4. Note: Sessions share same memory (by design for v1)

## Final Verification Checklist

- [ ] UI loads correctly on desktop
- [ ] UI loads correctly on mobile
- [ ] All 5 actions work in sequence
- [ ] Multiple uploads accumulate correctly
- [ ] Analysis uses Claude API successfully
- [ ] Analysis follows all 11 rules
- [ ] Blue alert rule implemented correctly
- [ ] Payment phrases exactly as specified
- [ ] "Unable to confirm" used appropriately
- [ ] Email actually sends (not fake)
- [ ] Email format is professional and mobile-friendly
- [ ] Error handling works (doesn't crash)
- [ ] Session clear works
- [ ] No console errors in browser
- [ ] README documentation complete
- [ ] .env.example provided
- [ ] Dependencies install cleanly

## Bug Reporting Template

If you find issues:

```
**Test**: [Test number and name]
**Steps to Reproduce**:
1. 
2. 
3. 

**Expected**: [What should happen]
**Actual**: [What actually happened]
**Screenshots**: [If applicable]
**Browser**: [Chrome/Safari/etc.]
**Device**: [Desktop/iPhone/Android]
**Console Errors**: [Any errors in browser console]
```

## Success Criteria Summary

The application is ready for use when:

✅ All 12 tests pass
✅ No critical bugs found
✅ Email delivery confirmed working
✅ Analysis follows all specification rules
✅ Mobile-friendly and accessible
✅ Documentation complete and accurate
