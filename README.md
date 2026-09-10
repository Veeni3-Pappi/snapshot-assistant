# Salon Snapshot Daily Operations Report Assistant

A mobile-friendly web application that analyzes CCTV snapshots from a salon and generates comprehensive daily operations reports using Claude AI vision capabilities.

## Features

- **Mobile-First Design**: Fully functional from a phone browser
- **Multi-Upload Support**: Upload snapshots from different cameras and times
- **AI-Powered Analysis**: Uses Claude API to analyze images together, not in isolation
- **Smart Client Tracking**: Automatically groups snapshots by client
- **Daily Book Comparison**: Compares CCTV evidence against daily book records
- **Payment Verification**: Cross-references payment/sales records
- **Email Delivery**: Sends formatted reports via email
- **Blue Alert System**: Highlights services visible in CCTV but not recorded in daily book

## Tech Stack

- **Backend**: Node.js + Express
- **Frontend**: HTML/CSS/JavaScript (mobile-optimized)
- **Image Analysis**: Claude API (Anthropic)
- **Email**: Nodemailer (SMTP) or SendGrid

## Setup Instructions

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment Variables

Copy the example environment file:

```bash
cp .env.example .env
```

Edit `.env` and add your credentials:

```env
# Claude API Key (REQUIRED)
ANTHROPIC_API_KEY=your_anthropic_api_key_here

# Email Configuration - Choose ONE method:

# Option 1: Gmail SMTP (recommended for testing)
EMAIL_SERVICE=gmail
EMAIL_USER=your-email@gmail.com
EMAIL_PASSWORD=your-app-specific-password

# Option 2: SendGrid (for production)
# SENDGRID_API_KEY=your_sendgrid_api_key_here

# Report Recipient
REPORT_RECIPIENT_EMAIL=recipient@example.com

# Server Port (optional)
PORT=3000
```

#### Getting a Claude API Key:
1. Go to https://console.anthropic.com/
2. Sign up or log in
3. Navigate to API Keys section
4. Create a new API key

#### Gmail App Password Setup:
1. Enable 2-factor authentication on your Google account
2. Go to https://myaccount.google.com/apppasswords
3. Generate an app password for "Mail"
4. Use this password in the `.env` file (not your regular Gmail password)

### 3. Start the Server

```bash
npm start
```

Or for development with auto-reload:

```bash
npm run dev
```

### 4. Access the Application

Open your browser (desktop or mobile) and navigate to:

```
http://localhost:3000
```

For mobile testing on the same network, use your computer's local IP:

```
http://192.168.x.x:3000
```

## Usage Workflow

### Step 1: Upload CCTV Snapshots
- Select and upload photos from different cameras and times
- You can upload multiple times before analyzing
- Minimum 1 snapshot required

### Step 2: Upload Daily Book (Optional)
- Upload a photo of the handwritten or printed daily book
- This enables comparison between CCTV and records

### Step 3: Upload Payment/Sales Records (Optional)
- Upload payment or sales records for verification
- If not provided, payment status will show "Not provided for verification"

### Step 4: Analyze
- Click "Analyze Daily Operations"
- Claude AI will analyze all images together
- Results display on screen for review

### Step 5: Generate & Email Report
- Review the analysis
- Click "Generate & Email Report"
- Report will be sent to the configured recipient email
- Success/failure confirmation displayed

## Analysis Rules

The AI follows strict rules for accuracy:

1. **Never analyzes snapshots in isolation** - all images reviewed together
2. **Groups snapshots by client** - never creates duplicate client entries
3. **Numbers clients chronologically** - Client 1, Client 2, etc.
4. **Only reports what's visible** - never invents services, staff, or times
5. **Uses "Unable to confirm"** for uncertain information - never guesses
6. **Blue Alert System** - highlights CCTV-visible services missing from daily book
7. **Payment verification** - only assesses if records provided

## Report Structure

Each report includes:

- **Client Cards**: Individual cards for each client with:
  - Chronological snapshots
  - Arrival, reception, services, staff information
  - Payment status
  - Daily book comparison (if provided)
  
- **Exceptions Section**: Items requiring attention:
  - Services missing from daily book
  - Payment discrepancies
  - Staff mismatches
  - Other concerns

- **Summary**: Brief overview of the day's operations

## Security Notes

- Keep your `.env` file secure and never commit it to version control
- Use app-specific passwords for Gmail (not your main password)
- Consider using SendGrid for production environments
- API keys should be kept confidential

## Troubleshooting

### Email not sending
- Verify email credentials in `.env`
- For Gmail, ensure 2FA is enabled and using app password
- Check spam folder for sent emails
- Review server console for specific error messages

### Analysis failing
- Verify `ANTHROPIC_API_KEY` is correct in `.env`
- Check that images are valid formats (JPEG, PNG)
- Ensure images aren't too large (10MB limit per file)
- Check server console for API error details

### Mobile access issues
- Ensure phone and computer are on the same network
- Use computer's local IP address, not "localhost"
- Check firewall isn't blocking the port

## Support

For issues or questions, review the server console logs for detailed error messages.

## License

Private use only.
