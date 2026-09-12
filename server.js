require('dotenv').config();
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const https = require('https');
const PDFDocument = require('pdfkit');
const smsGateway = require('./smsGateway');
const sharp = require('sharp');

// Helper to optimize and compress image buffers (reduces MBs while keeping high visual clarity)
async function optimizeImage(buffer, maxDimension = 1400, quality = 82) {
  if (!buffer) return null;
  try {
    return await sharp(buffer)
      .rotate() // auto-orient based on EXIF
      .resize({
        width: maxDimension,
        height: maxDimension,
        fit: 'inside',
        withoutEnlargement: true
      })
      .jpeg({ quality, progressive: true, mozjpeg: true })
      .toBuffer();
  } catch (err) {
    console.warn('[Image] Optimization failed, using original buffer:', err.message);
    return buffer;
  }
}

// Check which AI provider to use
const AI_PROVIDER = process.env.AI_PROVIDER || 'claude';

// Initialize Africa's Talking SMS (if configured)
let smsClient = null;
if (process.env.AFRICASTALKING_API_KEY && process.env.AFRICASTALKING_API_KEY !== 'your_api_key_here') {
  try {
    const AfricasTalking = require('africastalking');
    const africasTalking = AfricasTalking({
      apiKey: process.env.AFRICASTALKING_API_KEY,
      username: process.env.AFRICASTALKING_USERNAME || 'sandbox'
    });
    smsClient = africasTalking.SMS;
    console.log('📱 SMS: Africa\'s Talking initialized');
  } catch (error) {
    console.log('⚠️  SMS: Africa\'s Talking package not installed. Run: npm install africastalking');
  }
}

let aiClient;
if (AI_PROVIDER === 'gemini') {
  const { GoogleGenerativeAI } = require('@google/generative-ai');
  aiClient = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
} else {
  const Anthropic = require('@anthropic-ai/sdk');
  aiClient = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY
  });
}

const app = express();
const PORT = process.env.PORT || 3000;

// Configure multer for file uploads (in-memory storage)
const storage = multer.memoryStorage();
const upload = multer({ 
  storage: storage,
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit per file
});

// Middleware
app.use(express.json());
app.use(express.static('public'));

// In-memory storage for the current session
let sessionData = {
  cctvSnapshots: [],
  dailyBook: null,
  paymentRecords: null
};

// Configure Resend email (using direct HTTPS requests)
const RESEND_API_KEY = process.env.RESEND_API_KEY;

// Routes

// Upload CCTV snapshots
app.post('/api/upload-cctv', upload.array('snapshots', 50), async (req, res) => {
  try {
    const rawFiles = req.files || [];
    const files = await Promise.all(rawFiles.map(async file => {
      const optimized = await optimizeImage(file.buffer, 1400, 82);
      return {
        data: optimized,
        mimetype: 'image/jpeg',
        originalname: file.originalname,
        timestamp: new Date().toISOString()
      };
    }));
    
    sessionData.cctvSnapshots.push(...files);
    
    res.json({ 
      success: true, 
      message: `${files.length} snapshot(s) uploaded and optimized successfully`,
      totalSnapshots: sessionData.cctvSnapshots.length
    });
  } catch (error) {
    console.error('Error uploading CCTV snapshots:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Upload Daily Book
app.post('/api/upload-daily-book', upload.single('dailyBook'), async (req, res) => {
  try {
    const optimized = await optimizeImage(req.file.buffer, 1600, 85);
    sessionData.dailyBook = {
      data: optimized,
      mimetype: 'image/jpeg',
      originalname: req.file.originalname
    };
    
    res.json({ 
      success: true, 
      message: 'Daily Book uploaded and optimized successfully'
    });
  } catch (error) {
    console.error('Error uploading Daily Book:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Upload Payment/Sales Records
app.post('/api/upload-payment-records', upload.single('paymentRecords'), async (req, res) => {
  try {
    const optimized = await optimizeImage(req.file.buffer, 1600, 85);
    sessionData.paymentRecords = {
      data: optimized,
      mimetype: 'image/jpeg',
      originalname: req.file.originalname
    };
    
    res.json({ 
      success: true, 
      message: 'Payment records uploaded and optimized successfully'
    });
  } catch (error) {
    console.error('Error uploading Payment records:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get session status
app.get('/api/session-status', (req, res) => {
  res.json({
    cctvCount: sessionData.cctvSnapshots.length,
    hasDailyBook: !!sessionData.dailyBook,
    hasPaymentRecords: !!sessionData.paymentRecords
  });
});

// Analyze snapshots
app.post('/api/analyze', async (req, res) => {
  try {
    if (sessionData.cctvSnapshots.length === 0) {
      return res.status(400).json({ 
        success: false, 
        error: 'No CCTV snapshots uploaded' 
      });
    }

    // Build the analysis prompt
    const analysisPrompt = buildAnalysisPrompt(
      sessionData.cctvSnapshots.length,
      !!sessionData.dailyBook,
      !!sessionData.paymentRecords
    );

    let analysisResult;

    if (AI_PROVIDER === 'gemini') {
      // Use Gemini
      const model = aiClient.getGenerativeModel({ model: 'gemini-3.6-flash' });
      
      // Prepare images for Gemini
      const imageParts = sessionData.cctvSnapshots.map(snapshot => ({
        inlineData: {
          data: snapshot.data.toString('base64'),
          mimeType: snapshot.mimetype
        }
      }));

      // Add Daily Book if available
      if (sessionData.dailyBook) {
        imageParts.push({
          inlineData: {
            data: sessionData.dailyBook.data.toString('base64'),
            mimeType: sessionData.dailyBook.mimetype
          }
        });
      }

      // Add Payment Records if available
      if (sessionData.paymentRecords) {
        imageParts.push({
          inlineData: {
            data: sessionData.paymentRecords.data.toString('base64'),
            mimeType: sessionData.paymentRecords.mimetype
          }
        });
      }

      const result = await model.generateContent([analysisPrompt, ...imageParts]);
      analysisResult = result.response.text();

    } else {
      // Use Claude
      const imageContents = sessionData.cctvSnapshots.map((snapshot, index) => ({
        type: 'image',
        source: {
          type: 'base64',
          media_type: snapshot.mimetype,
          data: snapshot.data.toString('base64')
        }
      }));

      // Add Daily Book if available
      if (sessionData.dailyBook) {
        imageContents.push({
          type: 'image',
          source: {
            type: 'base64',
            media_type: sessionData.dailyBook.mimetype,
            data: sessionData.dailyBook.data.toString('base64')
          }
        });
      }

      // Add Payment Records if available
      if (sessionData.paymentRecords) {
        imageContents.push({
          type: 'image',
          source: {
            type: 'base64',
            media_type: sessionData.paymentRecords.mimetype,
            data: sessionData.paymentRecords.data.toString('base64')
          }
        });
      }

      const message = await aiClient.messages.create({
        model: 'claude-3-5-sonnet-20241022',
        max_tokens: 4000,
        messages: [{
          role: 'user',
          content: [
            {
              type: 'text',
              text: analysisPrompt
            },
            ...imageContents
          ]
        }]
      });

      analysisResult = message.content[0].text;
    }

    res.json({ 
      success: true, 
      analysis: analysisResult,
      provider: AI_PROVIDER
    });
  } catch (error) {
    console.error('Error analyzing snapshots:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// Generate PDF report and email it when configured
app.post('/api/generate-report', async (req, res) => {
  try {
    const { analysis } = req.body;
    
    if (!analysis) {
      return res.status(400).json({ 
        success: false, 
        error: 'No analysis provided' 
      });
    }

    const report = parseAnalysisForReport(analysis, sessionData.cctvSnapshots);
    const pdfBuffer = await createReportPDF(report);
    const notificationMethod = process.env.NOTIFICATION_METHOD || 'email';
    const results = {
      email: null,
      sms: null
    };

    // Send Email
    if (notificationMethod !== 'sms') {
      try {
        const fromEmail = process.env.EMAIL_USER || 'onboarding@resend.dev';
        const recipientEmail = process.env.REPORT_RECIPIENT_EMAIL;
        
        if (!recipientEmail) {
          throw new Error('Recipient email not configured in .env file');
        }

        // Prepare attachments safely: PDF is essential; snapshots are attached if within safe size limit (15MB)
        const attachments = [{
          filename: `salon-daily-operations-${report.dateSlug}.pdf`,
          content: pdfBuffer.toString('base64')
        }];

        let currentPayloadBytes = pdfBuffer.length;
        const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024; // 15MB safe threshold for Resend

        for (let index = 0; index < sessionData.cctvSnapshots.length; index++) {
          const snapshot = sessionData.cctvSnapshots[index];
          if (snapshot && snapshot.data) {
            const snapBytes = snapshot.data.length;
            if (currentPayloadBytes + snapBytes <= MAX_ATTACHMENT_BYTES) {
              attachments.push({
                filename: snapshot.originalname || `snapshot-${index + 1}.jpg`,
                content: snapshot.data.toString('base64')
              });
              currentPayloadBytes += snapBytes;
            } else {
              console.log(`[Email] Skipping raw snapshot ${index + 1} (${(snapBytes / 1024 / 1024).toFixed(1)}MB) to keep payload under 15MB. It is already included inside the PDF report.`);
            }
          }
        }

        const emailData = JSON.stringify({
          from: fromEmail,
          to: [recipientEmail],
          subject: `Salon Daily Operations Report - ${new Date().toLocaleDateString()}`,
          html: `<p>Your Salon Daily Operations Report is attached as a PDF.</p><p><small>Generated at ${new Date().toLocaleTimeString()} on ${report.reportDate}</small></p>`,
          attachments
        });

        console.log(`[Email] Sending report email via Resend to ${recipientEmail} (${(Buffer.byteLength(emailData) / (1024 * 1024)).toFixed(2)} MB, ${attachments.length} attachment(s))...`);

        const options = {
          hostname: 'api.resend.com',
          path: '/emails',
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${RESEND_API_KEY}`,
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(emailData)
          },
          timeout: 60000
        };

        const emailResult = await new Promise((resolve, reject) => {
          const request = https.request(options, (response) => {
            let data = '';
            
            console.log(`Resend API Response Status: ${response.statusCode}`);
            
            response.on('data', (chunk) => {
              data += chunk;
            });
            
            response.on('end', () => {
              console.log('Resend API Response:', data);
              
              if (response.statusCode >= 200 && response.statusCode < 300) {
                try {
                  resolve(JSON.parse(data));
                } catch (e) {
                  reject(new Error(`Failed to parse response: ${data}`));
                }
              } else {
                reject(new Error(`Resend API Error HTTP ${response.statusCode}: ${data}`));
              }
            });
          });

          request.on('error', (error) => {
            console.error('Resend API Request Error:', error);
            reject(error);
          });

          request.on('timeout', () => {
            console.error('Resend API Request Timeout after 60 seconds');
            request.destroy();
            reject(new Error('Request timeout after 60 seconds. Payload may be too large or connection too slow.'));
          });

          request.write(emailData);
          request.end();
        });

        results.email = {
          success: true,
          id: emailResult.id,
          recipient: recipientEmail,
          attachmentCount: attachments.length
        };
      } catch (emailError) {
        console.error('Email error:', emailError);
        results.email = {
          success: false,
          error: emailError.message
        };
      }
    }

    // Send SMS
    if (notificationMethod === 'sms' || notificationMethod === 'both') {
      try {
        const smsRecipient = process.env.SMS_RECIPIENT;
        
        if (!smsRecipient || smsRecipient === '+254700000000') {
          throw new Error('SMS recipient not configured in .env file');
        }

        const smsSummary = generateSMSSummary(analysis);
        const smsResult = await sendSMS(smsSummary, smsRecipient);
        
        results.sms = {
          success: true,
          provider: smsResult.provider || process.env.SMS_PROVIDER || 'msms',
          recipient: smsRecipient,
          messageId: smsResult.messageId || smsResult.SMSMessageData?.Recipients?.[0]?.messageId,
          status: smsResult.status || 'sent',
          details: smsResult.details || null
        };
      } catch (smsError) {
        console.error('SMS error:', smsError);
        results.sms = {
          success: false,
          error: smsError.message
        };
      }
    }

    // Build response message
    let message = '';
    let overallSuccess = false;

    if (results.email?.success && results.sms?.success) {
      message = `Report sent via email to ${results.email.recipient} and SMS to ${results.sms.recipient}`;
      overallSuccess = true;
    } else if (results.email?.success) {
      message = `Report sent via email to ${results.email.recipient}`;
      if (results.sms) message += `. SMS failed: ${results.sms.error}`;
      overallSuccess = true;
    } else if (results.sms?.success) {
      message = `Report sent via SMS to ${results.sms.recipient}`;
      if (results.email) message += `. Email failed: ${results.email.error}`;
      overallSuccess = true;
    } else {
      message = 'Failed to send report. ';
      if (results.email) message += `Email: ${results.email.error}. `;
      if (results.sms) message += `SMS: ${results.sms.error}`;
    }

    res.json({
      success: overallSuccess,
      message: overallSuccess ? message : `PDF generated but could not be emailed. ${message}`,
      details: results,
      attachmentCount: sessionData.cctvSnapshots.length + 1
    });
  } catch (error) {
    console.error('Error in report generation:', error);
    res.status(500).json({
      success: false, 
      error: `Failed to generate report: ${error.message}` 
    });
  }
});

// Clear session (start new day)
app.post('/api/clear-session', (req, res) => {
  sessionData = {
    cctvSnapshots: [],
    dailyBook: null,
    paymentRecords: null
  };
  res.json({ success: true, message: 'Session cleared' });
});

// Helper function to generate SMS summary
function generateSMSSummary(analysis) {
  try {
    const lines = analysis.split('\n');
    let clientCount = 0;
    let exceptionsCount = 0;
    let blueAlerts = [];
    
    for (let line of lines) {
      if (line.match(/^CLIENT \d+/i)) clientCount++;
      if (line.includes('[BLUE ALERT]')) {
        blueAlerts.push(line.replace('[BLUE ALERT]', '').trim());
        exceptionsCount++;
      }
      if (line.match(/Payment not found|Client missing|Staff mismatch/i)) {
        exceptionsCount++;
      }
    }
    
    let sms = `SALON DAILY REPORT - ${new Date().toLocaleDateString()}\n\n`;
    sms += `Clients Analyzed: ${clientCount}\n`;
    
    if (exceptionsCount > 0) {
      sms += `⚠️ ${exceptionsCount} Exception(s) Found\n`;
      if (blueAlerts.length > 0) {
        sms += `\n🔵 BLUE ALERTS:\n`;
        blueAlerts.slice(0, 2).forEach(alert => {
          sms += `- ${alert.substring(0, 80)}\n`;
        });
        if (blueAlerts.length > 2) {
          sms += `... +${blueAlerts.length - 2} more\n`;
        }
      }
    } else {
      sms += `✅ No Exceptions - All Clear\n`;
    }
    
    sms += `\nFull report sent via email.`;
    
    return sms;
  } catch (error) {
    return `Salon Daily Report - ${new Date().toLocaleDateString()}\nAnalysis complete. Check email for full report.`;
  }
}

// Helper function to send SMS (supports Android MSMS / smsgt gateway + Africa's Talking)
async function sendSMS(message, recipient) {
  try {
    const result = await smsGateway.sendSMS(message, recipient, {
      africasTalkingClient: smsClient
    });
    console.log('SMS dispatch result:', result);
    return result;
  } catch (error) {
    console.error('SMS error:', error);
    throw error;
  }
}

// Helper function to build analysis prompt
function buildAnalysisPrompt(cctvCount, hasDailyBook, hasPaymentRecords) {
  let prompt = `You are analyzing CCTV snapshots from a salon for a daily operations report.

CRITICAL RULES:
1. Analyze ALL ${cctvCount} CCTV snapshots together as a complete set, never in isolation.
2. Identify individual clients and group ALL snapshots belonging to the same client together.
3. NEVER create duplicate client entries - if someone reappears later, add those snapshots to their existing entry.
4. Number clients chronologically as they first appear: Client 1, Client 2, Client 3, etc.
5. For each client, arrange their snapshots in stage order: ENTRY → RECEPTION → SERVICE → SERVICE → PAYMENT/RECEPTION → EXIT
6. Skip any stage with no visible evidence.
7. NEVER invent a stage, service, staff member, or time not visibly supported by a snapshot.
8. Identify visible services ONLY where the image makes it reasonably clear.
9. Recognized services: Manicure, Pedicure, Mani & Pedi, Manigel, Pedigel, Haircut, Cornrows, Gel application, Overlays, Nail services, and other clearly visible services.
10. If a service can't be confidently identified, write "Service: Unable to confirm" - NEVER guess.
11. Identify staff members only where visible and identifiable.
`;

  if (hasDailyBook) {
    prompt += `
12. A Daily Book photo is provided. For each client/service, compare against it:
    - Is the client recorded?
    - Is the service recorded?
    - Is the staff member recorded correctly?
    - Does the time reasonably match?
    - Is there any CCTV-visible service with NO matching Daily Book entry?
`;
  }

  if (hasPaymentRecords) {
    prompt += `
13. Payment/sales records were uploaded. For each client, verify payment using ONLY these exact phrases:
    - "Paid — Confirmed" (if clearly verified in payment records)
    - "Payment found" (if payment is found but needs more verification)
    - "Payment not found" (if searched but not found)
    - "Unable to verify" (if unclear)
`;
  } else {
    prompt += `
13. NO payment records were provided. For every client, write: "Payment: Not provided for verification."
    NEVER assume payment just because a client left the frame.
`;
  }

  prompt += `

BLUE ALERT RULE (CRITICAL):
- Use the marker "[BLUE ALERT]" ONLY for a service that is confirmed visible in CCTV but has NO matching Daily Book entry.
- Example: "[BLUE ALERT] Pedicure — Carol — NOT RECORDED IN DAILY BOOK"
- NEVER use [BLUE ALERT] for mere uncertainty or "Unable to confirm" situations.

OUTPUT FORMAT:
For each client, provide:

CLIENT [number]
Evidence snapshots: [comma-separated original snapshot numbers, using the upload order 1 through ${cctvCount}]
Snapshots: [describe each snapshot with camera/location and approximate time if visible, in chronological/stage order]
- Snapshot 1: [Entry at front door, 9:15 AM]
- Snapshot 2: [Reception desk, 9:17 AM]
- Snapshot 3: [Service area - pedicure station, 9:25 AM]
- etc.

REPORT:
Arrival: [time if visible, or "Unable to confirm"]
Reception: [describe what's visible: client at desk, staff member if identifiable, or "Unable to confirm"]
Services: [list only confirmed services, or "Unable to confirm"]
Staff: [name if identifiable, or "Unable to confirm"]
Payment: [use exact phrases from rule 13]
${hasDailyBook ? 'Daily Book Status: [comparison results, including any [BLUE ALERT] items]' : 'Daily Book Status: Not provided'}
Remarks: [any notable observations or concerns]

---

Then provide:

EXCEPTIONS / ITEMS REQUIRING ATTENTION
[List ONLY genuine discrepancies:]
- Any [BLUE ALERT] items (CCTV-visible service missing from Daily Book)
- Client missing from Daily Book
- Payment not found
- Staff mismatch
- Service mismatch
- Client apparently did not pass reception
- Insufficient CCTV evidence

SUMMARY
[2-3 sentence summary of the day's operations]

Also include these exact headings when the evidence is available:
SALES SUMMARY
Total Sales: [amount or Not provided]
PAYMENT METHOD
Cash: [amount or Nil]
Mpesa: [amount or Nil]
PDQ: [amount or Nil]
Credit: [amount or Nil]
SERVICE REVENUE
- [staff]: [service] – [amount or Not provided]
PRODUCT SOLD
- [product or Nil]
CLIENT SUMMARY
Repeat Clients: [count or Nil]
New Client: [count or Nil]

NOW ANALYZE THE IMAGES:`;

  return prompt;
}

function cleanReportValue(value) {
  return value.replace(/^[-•*]\s*/, '').replace(/\s+/g, ' ').trim();
}

function findReportValue(lines, label) {
  const line = lines.find(item => new RegExp(`^[-•*]?\\s*${label}\\s*[-:]`, 'i').test(item));
  if (!line) return '';
  return cleanReportValue(line.replace(new RegExp(`^[-•*]?\\s*${label}\\s*[-:]\\s*`, 'i'), ''));
}

function parseAnalysisForReport(analysis, snapshots = []) {
  const lines = analysis.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const clientIndexes = [];
  lines.forEach((line, index) => {
    if (/^CLIENT\s+\d+/i.test(line)) clientIndexes.push(index);
  });

  const clients = clientIndexes.map((start, index) => {
    const block = lines.slice(start, clientIndexes[index + 1] || lines.length)
      .filter(line => !/^(EXCEPTIONS|ITEMS REQUIRING ATTENTION|SUMMARY)\b/i.test(line));
    const clientNumber = Number(block[0].match(/\d+/)[0]);
    return {
      number: clientNumber,
      service: findReportValue(block, 'Services?') || 'Unable to confirm',
      revenue: findReportValue(block, 'Revenue') || 'Not provided',
      staff: findReportValue(block, 'Staff') || 'Unable to confirm',
      arrival: findReportValue(block, 'Arrival') || 'Unable to confirm',
      reception: findReportValue(block, 'Reception') || 'Unable to confirm',
      payment: findReportValue(block, 'Payment') || 'Not provided for verification',
      remarks: findReportValue(block, 'Remarks') || '',
      snapshotNumbers: parseSnapshotNumbers(block)
    };
  }).sort((left, right) => left.number - right.number);

  const fallbackGroups = splitSnapshotIndexes(snapshots.length, clients.length);
  clients.forEach((client, index) => {
    if (client.snapshotNumbers.length === 0) client.snapshotNumbers = fallbackGroups[index] || [];
    client.snapshots = client.snapshotNumbers
      .map(number => snapshots[number - 1])
      .filter(Boolean);
  });

  const dateMatch = analysis.match(/(?:DAILY OPERATIONS REPORT|SUMMARY REPORT)\s*[–-]\s*([^\n]+)/i);
  const reportDate = dateMatch ? cleanReportValue(dateMatch[1]) : new Date().toLocaleDateString('en-GB', {
    day: 'numeric', month: 'long', year: 'numeric'
  });
  const summaryLines = lines.slice(Math.max(0, lines.findIndex(line => /^SUMMARY\b/i.test(line)) + 1));
  const serviceRevenueStart = lines.findIndex(line => /^SERVICE REVENUE\b/i.test(line));
  const serviceRevenueEnd = lines.findIndex((line, index) => index > serviceRevenueStart && /^(PRODUCT SOLD|CLIENT SUMMARY|EXCEPTIONS|SUMMARY)\b/i.test(line));
  const serviceRevenueLines = serviceRevenueStart >= 0
    ? lines.slice(serviceRevenueStart + 1, serviceRevenueEnd >= 0 ? serviceRevenueEnd : lines.length)
    : [];
  const serviceRevenue = serviceRevenueLines.map(line => {
    const value = cleanReportValue(line);
    const separator = value.indexOf(':');
    return separator >= 0
      ? [value.slice(0, separator), value.slice(separator + 1).trim()]
      : [value, ''];
  }).filter(row => row[0] && !/^total service revenue/i.test(row[0]));

  const totalSales = findReportValue(lines, 'Total Sales') || 'Not provided';
  const paymentRows = ['Cash', 'Mpesa', 'PDQ', 'Credit'].map(method => [method, findReportValue(lines, method) || 'Nil']);
  const productSold = findReportValue(lines, 'Product sold') || 'Nil';
  const repeatClients = findReportValue(lines, 'Repeat Clients') || 'Nil';
  const newClients = findReportValue(lines, 'New Client') || 'Nil';

  return {
    clients,
    reportDate,
    dateSlug: reportDate.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'report',
    totalSales,
    paymentRows,
    serviceRevenue,
    productSold,
    repeatClients,
    newClients,
    summary: summaryLines.filter(line => !/^(EXCEPTIONS|ITEMS REQUIRING ATTENTION)\b/i.test(line)).join(' ')
  };
}

function parseSnapshotNumbers(lines) {
  const evidenceLine = lines.find(line => /^(Evidence|Snapshot files?|Snapshots used)\s*:/i.test(line));
  if (!evidenceLine) return [];
  return [...evidenceLine.matchAll(/\d+/g)].map(match => Number(match[0])).filter(number => number > 0);
}

function splitSnapshotIndexes(snapshotCount, clientCount) {
  if (!snapshotCount || !clientCount) return [];
  const groups = [];
  for (let index = 0; index < clientCount; index += 1) {
    const start = Math.floor(index * snapshotCount / clientCount);
    const end = Math.floor((index + 1) * snapshotCount / clientCount);
    groups.push(Array.from({ length: Math.max(1, end - start) }, (_, offset) => start + offset + 1));
  }
  return groups;
}

function drawReportTable(doc, headers, rows, widths, options = {}) {
  const startX = doc.page.margins.left;
  let y = doc.y;
  const totalWidth = widths.reduce((sum, width) => sum + width, 0);
  const boldFirstCol = options.boldFirstCol || false;

  const drawRow = (cells, bold = false, fill = null) => {
    const heights = cells.map((cell, index) => doc.heightOfString(String(cell || ''), { width: widths[index] - 12 }));
    const rowHeight = Math.max(24, Math.max(...heights) + 12);

    // Check if row fits on current page, add page if needed
    if (y + rowHeight > doc.page.height - doc.page.margins.bottom) {
      doc.addPage();
      y = doc.page.margins.top;
    }

    if (fill) doc.save().fillColor(fill).rect(startX, y, totalWidth, rowHeight).fill().restore();
    let x = startX;
    cells.forEach((cell, index) => {
      doc.rect(x, y, widths[index], rowHeight).stroke('#777777');
      const isBold = bold || (boldFirstCol && index === 0);
      doc.font(isBold ? 'Helvetica-Bold' : 'Helvetica').fontSize(10).fillColor('#111111')
        .text(String(cell || ''), x + 6, y + 6, { width: widths[index] - 12, height: rowHeight - 8 });
      x += widths[index];
    });
    y += rowHeight;
  };
  if (headers) drawRow(headers, true, '#f3f3f3');
  rows.forEach(row => drawRow(row));
  doc.y = y + 16;
}

function createReportPDF(report) {
  return new Promise(async (resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: 'A4', margin: 48 });
      const chunks = [];
      doc.on('data', chunk => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      // Page content width: 595.28 - 48*2 = ~499 pt
      const pageContentWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;

      // ── Page 1: Summary ──
      doc.font('Helvetica-Bold').fontSize(18).text(`${report.reportDate.toUpperCase()} SUMMARY REPORT`, { align: 'center' });
      doc.moveDown(0.35).fontSize(12).text(`DAILY OPERATIONS REPORT – ${report.reportDate.toUpperCase()}`, { align: 'center' });
      doc.moveDown(1);

      // Client Service Coverage table
      doc.font('Helvetica-Bold').fontSize(13).text('Client Service Coverage');
      doc.moveDown(0.3);
      const coverageWidths = [
        Math.round(pageContentWidth * 0.16),   // Client
        Math.round(pageContentWidth * 0.34),   // Service
        Math.round(pageContentWidth * 0.30),   // Done by
        Math.round(pageContentWidth * 0.20)    // Arrival
      ];
      drawReportTable(doc, ['Client', 'Service', 'Done by', 'Arrival'], report.clients.map(client => [
        `Client ${client.number}`, client.service, client.staff, client.arrival
      ]), coverageWidths);

      // Sales Summary
      doc.font('Helvetica-Bold').fontSize(13).text('Sales Summary');
      doc.moveDown(0.3);
      const twoColWidths = [Math.round(pageContentWidth * 0.40), Math.round(pageContentWidth * 0.60)];
      drawReportTable(doc, ['Item', 'Value'], [['Total Sales', report.totalSales]], twoColWidths);

      // Payment Method
      doc.font('Helvetica-Bold').fontSize(13).text('Payment Method');
      doc.moveDown(0.3);
      drawReportTable(doc, ['Method', 'Amount'], report.paymentRows, twoColWidths);

      // Service Revenue
      doc.font('Helvetica-Bold').fontSize(13).text('Service Revenue');
      doc.moveDown(0.3);
      const revenueWidths = [Math.round(pageContentWidth * 0.55), Math.round(pageContentWidth * 0.45)];
      drawReportTable(doc, ['Staff / Service', 'Revenue'], report.serviceRevenue.length ? report.serviceRevenue : [['Total Service Revenue', report.totalSales]], revenueWidths);

      // Product sold
      doc.font('Helvetica-Bold').fontSize(13).text('Product sold');
      doc.moveDown(0.3);
      doc.font('Helvetica').fontSize(10).text(report.productSold);
      doc.moveDown(0.5);

      // Client Summary
      doc.font('Helvetica-Bold').fontSize(13).text('Client Summary');
      doc.moveDown(0.3);
      drawReportTable(doc, ['Client type', 'Count'], [['Repeat Clients', report.repeatClients], ['New Client', report.newClients]], revenueWidths);

      // ── Per-client detail pages ──
      const detailWidths = [Math.round(pageContentWidth * 0.25), Math.round(pageContentWidth * 0.75)];

      for (const client of report.clients) {
        doc.addPage();

        // Client header
        doc.font('Helvetica-Bold').fontSize(16).fillColor('#111111')
          .text(`CLIENT ${client.number}`, { align: 'left' });
        doc.moveDown(0.5);

        // Detail table with Field / Details header
        const detailRows = [
          ['SERVICE', client.service],
          ['REVENUE', client.revenue],
          ['DONE BY', client.staff],
          ['ARRIVAL', client.arrival],
          ['RECEPTION', client.reception || 'Unable to confirm'],
          ['PAYMENT', client.payment || 'Not provided for verification.'],
          ['REMARKS', client.remarks || '']
        ].filter(row => row[1]); // Remove rows with empty values

        drawReportTable(doc, ['Field', 'Details'], detailRows, detailWidths, { boldFirstCol: true });

        // Snapshot images: bigger display size, physically smaller MBs via sharp compression
        const rawSnapshots = client.snapshots && client.snapshots.length ? client.snapshots : [];
        if (rawSnapshots.length > 0) {
          doc.moveDown(0.5);

          // Compress and optimize each snapshot buffer before embedding
          const optimizedBuffers = await Promise.all(
            rawSnapshots.map(async (snap) => {
              if (!snap || !snap.data) return null;
              return await optimizeImage(snap.data, 1200, 80);
            })
          );
          const validImages = optimizedBuffers.filter(Boolean);

          if (validImages.length === 1) {
            // Single snapshot: BIG full-width display
            const availableHeight = doc.page.height - doc.page.margins.bottom - doc.y;
            if (availableHeight < 160) {
              doc.addPage();
            }
            const singleMaxHeight = Math.min(340, Math.max(220, doc.page.height - doc.page.margins.bottom - doc.y - 12));
            const startY = doc.y;
            try {
              doc.image(validImages[0], doc.page.margins.left, startY, {
                fit: [pageContentWidth, singleMaxHeight],
                align: 'center',
                valign: 'center'
              });
              doc.y = startY + singleMaxHeight + 14;
            } catch (imgErr) {
              console.error(`Failed to embed snapshot for Client ${client.number}:`, imgErr.message);
            }
          } else if (validImages.length > 1) {
            // Multiple snapshots: large 2-column grid (each image up to ~242 pt wide x 230 pt high)
            const gap = 14;
            const colWidth = Math.floor((pageContentWidth - gap) / 2);
            const colHeight = 230;

            for (let index = 0; index < validImages.length; index++) {
              const column = index % 2;
              if (column === 0 && doc.y + colHeight + 20 > doc.page.height - doc.page.margins.bottom) {
                doc.addPage();
              }

              const imageX = doc.page.margins.left + column * (colWidth + gap);
              const imageY = doc.y;

              try {
                doc.image(validImages[index], imageX, imageY, {
                  fit: [colWidth, colHeight],
                  align: 'center',
                  valign: 'center'
                });
              } catch (imgErr) {
                console.error(`Failed to embed snapshot ${index + 1} for Client ${client.number}:`, imgErr.message);
              }

              if (column === 1 || index === validImages.length - 1) {
                doc.y = imageY + colHeight + 14;
              }
            }
          }
        }
      }

      // ── Final page: Summary narrative ──
      if (report.summary) {
        doc.addPage();
        doc.font('Helvetica-Bold').fontSize(16).fillColor('#111111').text('SUMMARY', { align: 'left' });
        doc.moveDown(0.5);
        doc.font('Helvetica').fontSize(10).fillColor('#111111')
          .text(report.summary, {
            align: 'left',
            lineGap: 3,
            width: pageContentWidth
          });
      }

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

// Helper function to format report as HTML
function formatReportAsHTML(analysis) {
  // Convert the analysis text to HTML with proper formatting
  let html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      line-height: 1.6;
      color: #333;
      max-width: 800px;
      margin: 0 auto;
      padding: 20px;
      background-color: #f5f5f5;
    }
    .report-container {
      background-color: white;
      padding: 30px;
      border-radius: 8px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }
    h1 {
      color: #2c3e50;
      border-bottom: 3px solid #3498db;
      padding-bottom: 10px;
      margin-top: 0;
    }
    h2 {
      color: #34495e;
      margin-top: 30px;
      border-left: 4px solid #3498db;
      padding-left: 15px;
    }
    .client-card {
      background-color: #f8f9fa;
      border: 1px solid #dee2e6;
      border-radius: 6px;
      padding: 20px;
      margin: 20px 0;
    }
    .client-header {
      font-size: 1.3em;
      font-weight: bold;
      color: #2c3e50;
      margin-bottom: 15px;
      border-bottom: 2px solid #3498db;
      padding-bottom: 8px;
    }
    .blue-alert {
      color: #0066cc;
      font-weight: bold;
      background-color: #e3f2fd;
      padding: 8px 12px;
      border-radius: 4px;
      margin: 8px 0;
      border-left: 4px solid #0066cc;
    }
    .report-section {
      margin: 10px 0;
    }
    .report-label {
      font-weight: bold;
      color: #495057;
    }
    .exceptions-section {
      background-color: #fff3cd;
      border: 2px solid #ffc107;
      border-radius: 6px;
      padding: 20px;
      margin: 30px 0;
    }
    .exceptions-section h2 {
      color: #856404;
      border-left-color: #ffc107;
      margin-top: 0;
    }
    .summary-section {
      background-color: #d1ecf1;
      border: 1px solid #bee5eb;
      border-radius: 6px;
      padding: 20px;
      margin: 30px 0;
    }
    .summary-section h2 {
      color: #0c5460;
      border-left-color: #17a2b8;
      margin-top: 0;
    }
    ul {
      margin: 10px 0;
      padding-left: 25px;
    }
    li {
      margin: 8px 0;
    }
    @media (max-width: 600px) {
      body {
        padding: 10px;
      }
      .report-container {
        padding: 15px;
      }
      h1 {
        font-size: 1.5em;
      }
      h2 {
        font-size: 1.2em;
      }
    }
  </style>
</head>
<body>
  <div class="report-container">
    <h1>DAILY OPERATIONS REPORT</h1>
    <p><strong>Date:</strong> ${new Date().toLocaleDateString('en-US', { 
      weekday: 'long', 
      year: 'numeric', 
      month: 'long', 
      day: 'numeric' 
    })}</p>
`;

  // Process the analysis text and convert to formatted HTML
  const lines = analysis.split('\n');
  let inClientCard = false;
  let inExceptions = false;
  let inSummary = false;
  
  for (let line of lines) {
    line = line.trim();
    
    if (!line) continue;
    
    // Detect sections
    if (line.match(/^CLIENT \d+/i)) {
      if (inClientCard) html += '</div>'; // Close previous card
      html += `<div class="client-card"><div class="client-header">${line}</div>`;
      inClientCard = true;
      continue;
    }
    
    if (line.match(/^EXCEPTIONS|ITEMS REQUIRING ATTENTION/i)) {
      if (inClientCard) {
        html += '</div>';
        inClientCard = false;
      }
      html += '<div class="exceptions-section"><h2>EXCEPTIONS / ITEMS REQUIRING ATTENTION</h2>';
      inExceptions = true;
      continue;
    }
    
    if (line.match(/^SUMMARY/i)) {
      if (inExceptions) {
        html += '</div>';
        inExceptions = false;
      }
      if (inClientCard) {
        html += '</div>';
        inClientCard = false;
      }
      html += '<div class="summary-section"><h2>SUMMARY</h2>';
      inSummary = true;
      continue;
    }
    
    // Handle blue alerts
    if (line.includes('[BLUE ALERT]')) {
      line = line.replace('[BLUE ALERT]', '').trim();
      html += `<div class="blue-alert">🔵 ${line}</div>`;
      continue;
    }
    
    // Handle list items
    if (line.startsWith('-') || line.startsWith('•')) {
      html += `<li>${line.substring(1).trim()}</li>`;
      continue;
    }
    
    // Regular content
    if (line.includes(':')) {
      const [label, ...rest] = line.split(':');
      const value = rest.join(':').trim();
      html += `<div class="report-section"><span class="report-label">${label}:</span> ${value}</div>`;
    } else {
      html += `<p>${line}</p>`;
    }
  }
  
  // Close any open sections
  if (inClientCard) html += '</div>';
  if (inExceptions) html += '</div>';
  if (inSummary) html += '</div>';
  
  html += `
  </div>
</body>
</html>`;

  return html;
}

// ==========================================
// SMS GATEWAY API (Android MSMS / smsgt)
// ==========================================

// Gateway diagnostics & status
app.get('/api/sms-gateway/status', (req, res) => {
  res.json({ success: true, data: smsGateway.getStatus() });
});

// Android phone polls for pending messages
app.get('/api/sms-gateway/pending', (req, res) => {
  const limit = parseInt(req.query.limit, 10) || 10;
  const messages = smsGateway.getPendingMessages(limit);
  res.json({ success: true, count: messages.length, messages });
});

// Android phone updates status of a message (sent / delivered / failed)
app.post('/api/sms-gateway/status', (req, res) => {
  const { messageId, status, error, parts, simSlot } = req.body;
  if (!messageId || !status) {
    return res.status(400).json({ success: false, error: 'messageId and status are required' });
  }
  const updated = smsGateway.updateMessageStatus(messageId, status, { error, parts, simSlot });
  res.json({ success: !!updated, data: updated });
});

// Android phone registers or sends heartbeat
app.post('/api/sms-gateway/register', (req, res) => {
  const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';
  const cleanIp = clientIp.replace(/^.*:/, ''); // strip ipv6 prefix if present
  const deviceInfo = {
    ...req.body,
    ip: req.body.ip || cleanIp
  };
  const device = smsGateway.registerDevice(deviceInfo);
  res.json({ success: true, device });
});

// Active devices
app.get('/api/sms-gateway/devices', (req, res) => {
  res.json({ success: true, devices: smsGateway.getActiveDevices() });
});

// Send an arbitrary SMS via the gateway
app.post('/api/sms-gateway/send', async (req, res) => {
  try {
    const { to, message, simSlot } = req.body;
    if (!to || !message) {
      return res.status(400).json({ success: false, error: 'to and message are required' });
    }
    const result = await smsGateway.sendSMS(message, to, {
      simSlot,
      africasTalkingClient: smsClient
    });
    res.json({ success: true, result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Clear queue
app.post('/api/sms-gateway/clear', (req, res) => {
  res.json({ success: true, result: smsGateway.clearQueue() });
});

// Start server
app.listen(PORT, () => {
  console.log(`\n╔════════════════════════════════════════════════════════╗`);
  console.log(`║   Salon Snapshot Assistant - Server Running!        ║`);
  console.log(`╚════════════════════════════════════════════════════════╝`);
  console.log(`\n🌐 Local: http://localhost:${PORT}`);
  console.log(`📱 Mobile: Run 'npm run ip' to get your IP address\n`);
  console.log(`🤖 AI Provider: ${AI_PROVIDER.toUpperCase()}`);
  console.log(`📧 Email Service: Resend`);
  console.log(`📨 Reports to: ${process.env.REPORT_RECIPIENT_EMAIL || 'Not configured'}`);
  console.log(`📱 SMS Provider: ${process.env.SMS_PROVIDER || 'msms (Android Gateway)'}`);
  console.log(`📲 SMS Recipient: ${process.env.SMS_RECIPIENT || 'Not configured'}\n`);
  
  if (AI_PROVIDER === 'gemini' && !process.env.GOOGLE_API_KEY) {
    console.log(`⚠️  WARNING: GOOGLE_API_KEY not set in .env file`);
  }
  if (AI_PROVIDER === 'claude' && !process.env.ANTHROPIC_API_KEY) {
    console.log(`⚠️  WARNING: ANTHROPIC_API_KEY not set in .env file`);
  }
  if (!process.env.RESEND_API_KEY) {
    console.log(`⚠️  WARNING: RESEND_API_KEY not set in .env file`);
  }
  console.log(`\n✨ Ready to analyze salon operations!\n`);
});
