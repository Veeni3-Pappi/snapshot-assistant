require('dotenv').config();
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const https = require('https');
const PDFDocument = require('pdfkit');
const smsGateway = require('./smsGateway');

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
app.post('/api/upload-cctv', upload.array('snapshots', 50), (req, res) => {
  try {
    const files = req.files.map(file => ({
      data: file.buffer,
      mimetype: file.mimetype,
      originalname: file.originalname,
      timestamp: new Date().toISOString()
    }));
    
    sessionData.cctvSnapshots.push(...files);
    
    res.json({ 
      success: true, 
      message: `${files.length} snapshot(s) uploaded successfully`,
      totalSnapshots: sessionData.cctvSnapshots.length
    });
  } catch (error) {
    console.error('Error uploading CCTV snapshots:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Upload Daily Book
app.post('/api/upload-daily-book', upload.single('dailyBook'), (req, res) => {
  try {
    sessionData.dailyBook = {
      data: req.file.buffer,
      mimetype: req.file.mimetype,
      originalname: req.file.originalname
    };
    
    res.json({ 
      success: true, 
      message: 'Daily Book uploaded successfully'
    });
  } catch (error) {
    console.error('Error uploading Daily Book:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Upload Payment/Sales Records
app.post('/api/upload-payment-records', upload.single('paymentRecords'), (req, res) => {
  try {
    sessionData.paymentRecords = {
      data: req.file.buffer,
      mimetype: req.file.mimetype,
      originalname: req.file.originalname
    };
    
    res.json({ 
      success: true, 
      message: 'Payment/Sales Records uploaded successfully'
    });
  } catch (error) {
    console.error('Error uploading Payment Records:', error);
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

        const emailData = JSON.stringify({
          from: fromEmail,
          to: [recipientEmail],
          subject: `Salon Daily Operations Report - ${new Date().toLocaleDateString()}`,
          html: '<p>Your Salon Daily Operations Report is attached as a PDF.</p>',
          attachments: [{
            filename: `salon-daily-operations-${report.dateSlug}.pdf`,
            content: pdfBuffer.toString('base64')
          }, ...sessionData.cctvSnapshots.map((snapshot, index) => ({
            filename: snapshot.originalname || `snapshot-${index + 1}.jpg`,
            content: snapshot.data.toString('base64')
          }))]
        });

        const options = {
          hostname: 'api.resend.com',
          path: '/emails',
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${RESEND_API_KEY}`,
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(emailData)
          },
          timeout: 30000
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
                reject(new Error(`HTTP ${response.statusCode}: ${data}`));
              }
            });
          });

          request.on('error', (error) => {
            console.error('Resend API Request Error:', error);
            reject(error);
          });

          request.on('timeout', () => {
            console.error('Resend API Request Timeout');
            request.destroy();
            reject(new Error('Request timeout after 30 seconds'));
          });

          request.write(emailData);
          request.end();
        });

        results.email = {
          success: true,
          id: emailResult.id,
          recipient: recipientEmail
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

function drawReportTable(doc, headers, rows, widths) {
  const startX = doc.page.margins.left;
  let y = doc.y;
  const drawRow = (cells, bold = false, fill = null) => {
    const heights = cells.map((cell, index) => doc.heightOfString(String(cell || ''), { width: widths[index] - 12 }));
    const rowHeight = Math.max(24, Math.max(...heights) + 12);
    if (fill) doc.save().fillColor(fill).rect(startX, y, widths.reduce((sum, width) => sum + width, 0), rowHeight).fill().restore();
    let x = startX;
    cells.forEach((cell, index) => {
      doc.rect(x, y, widths[index], rowHeight).stroke('#777777');
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(10).fillColor('#111111')
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
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 48 });
    const chunks = [];
    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.font('Helvetica-Bold').fontSize(18).text(`${report.reportDate.toUpperCase()} SUMMARY REPORT`, { align: 'center' });
    doc.moveDown(0.35).fontSize(12).text(`DAILY OPERATIONS REPORT – ${report.reportDate.toUpperCase()}`, { align: 'center' });
    doc.moveDown(1);
    doc.font('Helvetica-Bold').fontSize(13).text('Client Service Coverage');
    drawReportTable(doc, ['Client', 'Service', 'Done by', 'Arrival'], report.clients.map(client => [
      `Client ${client.number}`, client.service, client.staff, client.arrival
    ]), [80, 170, 110, 110]);

    doc.font('Helvetica-Bold').fontSize(13).text('Sales Summary');
    drawReportTable(doc, ['Item', 'Value'], [['Total Sales', report.totalSales]], [170, 300]);
    doc.font('Helvetica-Bold').fontSize(13).text('Payment Method');
    drawReportTable(doc, ['Method', 'Amount'], report.paymentRows, [170, 300]);
    doc.font('Helvetica-Bold').fontSize(13).text('Service Revenue');
    drawReportTable(doc, ['Staff / Service', 'Revenue'], report.serviceRevenue.length ? report.serviceRevenue : [['Total Service Revenue', report.totalSales]], [280, 190]);
    doc.font('Helvetica-Bold').fontSize(13).text('Product sold');
    doc.font('Helvetica').fontSize(10).text(report.productSold);
    doc.moveDown(0.5).font('Helvetica-Bold').fontSize(13).text('Client Summary');
    drawReportTable(doc, ['Client type', 'Count'], [['Repeat Clients', report.repeatClients], ['New Client', report.newClients]], [280, 190]);

    report.clients.forEach(client => {
      doc.addPage();
      drawReportTable(doc, null, [
        [`CLIENT ${client.number}`, ''],
        ['SERVICE', client.service],
        ['REVENUE', client.revenue],
        ['DONE BY', client.staff],
        ['ARRIVAL', client.arrival]
      ], [150, 410]);
      const images = client.snapshots.length ? client.snapshots : [];
      const imageWidth = 238;
      const imageHeight = 170;
      const imageGap = 12;
      images.forEach((snapshot, index) => {
        const column = index % 2;
        if (column === 0 && doc.y + imageHeight + 24 > doc.page.height - doc.page.margins.bottom) doc.addPage();
        const imageX = doc.page.margins.left + column * (imageWidth + imageGap);
        const imageY = doc.y;
        doc.image(snapshot.data, imageX, imageY, { fit: [imageWidth, imageHeight], align: 'left', valign: 'top' });
        if (column === 1 || index === images.length - 1) doc.y = imageY + imageHeight + 12;
      });
    });
    doc.end();
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
