# Quick Start Guide

## 1️⃣ Get Your API Keys

### Claude API Key (Required)
1. Visit https://console.anthropic.com/
2. Sign up or log in
3. Go to API Keys → Create Key
4. Copy the key

### Email Setup (Required)
Choose one method:

**Option A: Gmail (Easiest for Testing)**
1. Enable 2-factor authentication: https://myaccount.google.com/security
2. Generate app password: https://myaccount.google.com/apppasswords
3. Copy the 16-character password

**Option B: SendGrid (Better for Production)**
1. Sign up at https://sendgrid.com
2. Create API key with Mail Send permissions
3. Copy the key

## 2️⃣ Configure the App

Edit the `.env` file:

```env
# Required: Add your Claude API key
ANTHROPIC_API_KEY=sk-ant-your-key-here

# Choose one email method:

# Option A: Gmail
EMAIL_SERVICE=gmail
EMAIL_USER=youremail@gmail.com
EMAIL_PASSWORD=your-16-char-app-password

# Option B: SendGrid
# SENDGRID_API_KEY=SG.your-sendgrid-key-here

# Where to send reports
REPORT_RECIPIENT_EMAIL=reports@yoursalon.com
```

## 3️⃣ Start the Server

```bash
npm start
```

You should see:
```
Salon Snapshot Assistant running on port 3000
Open http://localhost:3000 in your browser
```

## 4️⃣ Access from Phone

### Same Device (Testing)
```
http://localhost:3000
```

### From Phone on Same WiFi

1. Find your computer's IP address:
   - **Linux/Mac**: `ifconfig | grep "inet " | grep -v 127.0.0.1`
   - **Windows**: `ipconfig | findstr IPv4`

2. On your phone browser, visit:
   ```
   http://YOUR-IP-ADDRESS:3000
   ```
   Example: `http://192.168.1.105:3000`

## 5️⃣ Use the App

1. **Upload CCTV Snapshots** (at least 1)
   - Select multiple photos
   - Can upload multiple times

2. **Upload Daily Book** (optional)
   - Photo of the handwritten book

3. **Upload Payment Records** (optional)
   - Photo of payment/sales records

4. **Click Analyze**
   - Wait for Claude AI to process
   - Review results on screen

5. **Generate & Email Report**
   - Sends formatted report to configured email
   - Check for success message

## 📱 Mobile Tips

- Use landscape mode for easier viewing
- Take clear, well-lit photos
- Ensure CCTV screenshots show timestamps/camera info if possible
- Upload in batches if you have many photos

## 🔧 Troubleshooting

### "Analysis failed"
- Check that `ANTHROPIC_API_KEY` is correct in `.env`
- Restart server after changing `.env`
- Verify you have API credits

### "Email failed"
- Check email credentials in `.env`
- For Gmail: ensure you're using app password, not regular password
- Check recipient email is correct
- Look in spam folder

### Can't access from phone
- Ensure phone and computer on same WiFi
- Check firewall isn't blocking port 3000
- Try `http://` not `https://`

### App not loading
- Run `npm install` first
- Check that port 3000 isn't already in use
- View terminal for error messages

## 🎯 First Test

1. Take 2-3 photos with your phone
2. Upload them as CCTV snapshots
3. Click Analyze
4. If you see results → It's working! ✅
5. Try Generate & Email to test email delivery

## Need Help?

Check the full README.md for detailed documentation.
