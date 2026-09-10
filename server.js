require('dotenv').config();
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const https = require('https');

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

// Generate and email report
app.post('/api/generate-report', async (req, res) => {
  try {
    const { analysis } = req.body;
    
    if (!analysis) {
      return res.status(400).json({ 
        success: false, 
        error: 'No analysis provided' 
      });
    }

    const notificationMethod = process.env.NOTIFICATION_METHOD || 'email';
    const results = {
      email: null,
      sms: null
    };

    // Send Email
    if (notificationMethod === 'email' || notificationMethod === 'both') {
      try {
        const htmlReport = formatReportAsHTML(analysis);
        const fromEmail = process.env.EMAIL_USER || 'onboarding@resend.dev';
        const recipientEmail = process.env.REPORT_RECIPIENT_EMAIL;
        
        if (!recipientEmail) {
          throw new Error('Recipient email not configured in .env file');
        }

        const emailData = JSON.stringify({
          from: fromEmail,
          to: [recipientEmail],
          subject: `Salon Daily Operations Report - ${new Date().toLocaleDateString()}`,
          html: htmlReport
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

        if (!smsClient) {
          throw new Error('SMS service not initialized. Install: npm install africastalking');
        }

        const smsSummary = generateSMSSummary(analysis);
        const smsResult = await sendSMS(smsSummary, smsRecipient);
        
        results.sms = {
          success: true,
          recipient: smsRecipient,
          messageId: smsResult.SMSMessageData?.Recipients?.[0]?.messageId
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
      message: message,
      details: results,
      report: formatReportAsHTML(analysis)
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

// Helper function to send SMS
async function sendSMS(message, recipient) {
  if (!smsClient) {
    throw new Error('SMS service not configured');
  }
  
  const options = {
    to: [recipient],
    message: message,
    from: process.env.AFRICASTALKING_SENDER_ID || null
  };
  
  try {
    const result = await smsClient.send(options);
    console.log('SMS sent successfully:', result);
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

NOW ANALYZE THE IMAGES:`;

  return prompt;
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

// Start server
app.listen(PORT, () => {
  console.log(`\n╔════════════════════════════════════════════════════════╗`);
  console.log(`║   Salon Snapshot Assistant - Server Running!        ║`);
  console.log(`╚════════════════════════════════════════════════════════╝`);
  console.log(`\n🌐 Local: http://localhost:${PORT}`);
  console.log(`📱 Mobile: Run 'npm run ip' to get your IP address\n`);
  console.log(`🤖 AI Provider: ${AI_PROVIDER.toUpperCase()}`);
  console.log(`📧 Email Service: Resend`);
  console.log(`📨 Reports to: ${process.env.REPORT_RECIPIENT_EMAIL || 'Not configured'}\n`);
  
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
