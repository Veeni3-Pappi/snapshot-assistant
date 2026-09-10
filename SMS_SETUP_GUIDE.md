# 📱 SMS Setup Guide - Africa's Talking

## ✅ SMS Integration Added!

Your app now supports sending SMS notifications via **Africa's Talking**!

---

## 🚀 Step-by-Step Setup

### 1. Create Africa's Talking Account
👉 Go to: **https://africastalking.com/register**

- Sign up with your email
- Verify your email address
- Choose your country (Kenya 🇰🇪)

### 2. Get Your Credentials

After logging in:

**A) Get Your Username:**
- For testing: Use `sandbox`
- For live: Your username will be shown in the dashboard

**B) Get Your API Key:**
1. Go to Dashboard → **Settings** → **API Keys**
2. Click **"Generate API Key"**
3. Copy the API Key (starts with `atsk_...`)
4. **Save it securely** (you can't see it again!)

### 3. Get Free Test Credits

**Sandbox Mode (FREE):**
- Go to **Sandbox** section
- Get instant KES 500 free credits
- Use for testing only (SMS won't actually send to real numbers)
- Test number: `+254711XXXYYY`

**For Real SMS:**
- Go to **Billing** → **Buy Airtime**
- Minimum: KES 100
- Rate: ~KES 0.80 - 1.00 per SMS
- Supports: Safaricom, Airtel, Telkom Kenya

---

## 🔧 Configure Your App

### Update `.env` file:

```env
# SMS Configuration (Africa's Talking)
AFRICASTALKING_USERNAME=sandbox              # or your username
AFRICASTALKING_API_KEY=atsk_xxxxxxxxxxxxxxx  # Your API key
AFRICASTALKING_SENDER_ID=SALON              # Optional: Custom sender name
SMS_RECIPIENT=+254712345678                  # Your phone number (Kenyan format)

# Notification Method
NOTIFICATION_METHOD=both   # Options: email, sms, or both
```

**Phone Number Format:**
- ✅ Correct: `+254712345678` (with country code)
- ❌ Wrong: `0712345678` (without country code)
- ❌ Wrong: `254712345678` (missing +)

---

## 📦 Install Africa's Talking Package

Run this command:

```bash
npm install africastalking
```

If it's slow or times out, try:

```bash
npm install africastalking --verbose
```

---

## 🧪 Test SMS

### Test with Sandbox:

```env
AFRICASTALKING_USERNAME=sandbox
AFRICASTALKING_API_KEY=your_sandbox_api_key
SMS_RECIPIENT=+254711082XXX  # Sandbox test numbers
NOTIFICATION_METHOD=sms
```

### Test with Live Credits:

```env
AFRICASTALKING_USERNAME=your_username
AFRICASTALKING_API_KEY=your_live_api_key
SMS_RECIPIENT=+254712345678  # Your actual number
NOTIFICATION_METHOD=sms
```

---

## 📲 How SMS Works

### When you send a report:

**SMS Message Format:**
```
SALON DAILY REPORT - Jan 15, 2026

Clients Analyzed: 8
⚠️ 3 Exception(s) Found

🔵 BLUE ALERTS:
- Pedicure - Carol - NOT RECORDED IN DAILY BOOK
- Payment not found for Client 5

Full report sent via email.
```

**Character Limit:** ~160 characters per SMS
- Long messages split into multiple SMS
- Each SMS costs separately
- Summary format keeps it short

---

## ⚙️ Notification Options

Set in `.env`:

```env
# Send email only (default)
NOTIFICATION_METHOD=email

# Send SMS only
NOTIFICATION_METHOD=sms

# Send both email AND SMS (recommended)
NOTIFICATION_METHOD=both
```

**Recommended:** `both` - Email has full details, SMS gives instant alert

---

## 💰 Pricing (Africa's Talking Kenya)

| Service | Cost |
|---------|------|
| SMS to Safaricom | KES 0.80 |
| SMS to Airtel | KES 0.80 |
| SMS to Telkom | KES 1.00 |
| Sandbox (Testing) | FREE |

**Example:**
- 100 SMS = ~KES 80-100
- 500 SMS = ~KES 400-500
- 1000 SMS = ~KES 800-1000

---

## 🔍 Troubleshooting

### "SMS service not configured"
✅ Install package: `npm install africastalking`
✅ Check API key is in `.env`
✅ Restart server after updating `.env`

### "Invalid phone number"
✅ Use international format: `+254712345678`
✅ Remove spaces and dashes
✅ Include country code (+254 for Kenya)

### "Insufficient balance"
✅ Buy airtime credits at https://africastalking.com/billing
✅ Or use sandbox for testing

### SMS not received (Sandbox)
⚠️ Sandbox doesn't send real SMS
✅ Check console logs for "SMS sent successfully"
✅ Switch to live mode with real credits

### SMS not received (Live)
✅ Check phone number format
✅ Check balance in dashboard
✅ Try with a different number
✅ Check network coverage

---

## 📊 What Gets Sent

### Via Email (Full Report):
- Complete client-by-client analysis
- All CCTV snapshots reviewed
- Daily Book comparison
- Payment verification
- Detailed exceptions
- Formatted HTML

### Via SMS (Summary):
- Total clients analyzed
- Exception count
- Up to 2 Blue Alerts (truncated)
- Quick overview for instant notification

---

## 🎯 Best Practices

1. **Use Both:** Email for details, SMS for alerts
2. **Test First:** Use sandbox before buying credits
3. **Monitor Balance:** Check dashboard regularly
4. **Valid Numbers:** Always use +254 format
5. **Character Limit:** SMS auto-summarizes to stay under 160 chars

---

## 📞 Support

**Africa's Talking:**
- Docs: https://developers.africastalking.com/
- Support: support@africastalking.com
- Community: https://community.africastalking.com/

**Your App:**
- Check server logs for detailed errors
- Use sandbox for free testing
- Email works independently of SMS

---

## ✨ Ready to Use!

Once you have your credentials:

1. Update `.env` with API key, username, and phone number
2. Install package: `npm install africastalking`
3. Restart server: `npm start`
4. Upload CCTV images
5. Click "Analyze"
6. Click "Send Report"
7. Get email + SMS! 🎉

---

**SMS is optional!** If you don't configure it, email still works normally.
