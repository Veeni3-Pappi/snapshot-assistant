# 🚀 Quick SMS Setup (5 Minutes!)

## ✅ SMS Support Added to Your App!

---

## Step 1: Get Africa's Talking Credentials (2 mins)

1. **Sign up**: https://africastalking.com/register
2. **Login** and go to **API Keys**
3. **Copy** your API Key (starts with `atsk_...`)

---

## Step 2: Update Your `.env` File (1 min)

Add these lines to your `.env` file:

```env
# SMS Configuration
AFRICASTALKING_USERNAME=sandbox
AFRICASTALKING_API_KEY=atsk_YOUR_KEY_HERE
SMS_RECIPIENT=+254712345678
NOTIFICATION_METHOD=both
```

**Replace:**
- `atsk_YOUR_KEY_HERE` → Your actual API key
- `+254712345678` → Your phone number (with +254)

---

## Step 3: Restart Server (1 min)

```bash
# Stop current server (Ctrl+C)
npm start
```

Look for this in the console:

```
📱 SMS Service: Africa's Talking (sandbox)
📲 SMS to: +254712345678
🔔 Notification: both
```

---

## Step 4: Test It! (1 min)

1. Upload CCTV images
2. Click "Analyze"
3. Click "Send Report"
4. Check your phone! 📱

---

## 💰 Using Real SMS (Not Sandbox)

**Sandbox** = FREE testing (SMS doesn't actually send)

**Live** = Real SMS to real numbers

To switch to live:
1. Go to https://africastalking.com/billing
2. Buy credits (min KES 100)
3. Update `.env`:
   ```env
   AFRICASTALKING_USERNAME=your_username  # Not "sandbox"
   ```

---

## 📲 What You'll Receive via SMS

```
SALON DAILY REPORT - Jan 15

Clients Analyzed: 8
⚠️ 3 Exception(s) Found

🔵 BLUE ALERTS:
- Pedicure NOT RECORDED
- Payment not found

Full report sent via email.
```

Short, sweet, instant alert! 📱

---

## 🎯 Notification Options

**Email only:**
```env
NOTIFICATION_METHOD=email
```

**SMS only:**
```env
NOTIFICATION_METHOD=sms
```

**Both (recommended):**
```env
NOTIFICATION_METHOD=both
```

---

## ❓ Problems?

**"SMS service not configured"**
- Check `.env` has your API key
- Restart server after editing `.env`

**"Invalid phone number"**
- Use format: `+254712345678`
- Must start with `+254` (Kenya)

**SMS not received (sandbox)**
- Normal! Sandbox doesn't send real SMS
- Buy credits for real SMS

---

**That's it! SMS alerts ready in 5 minutes! 🎉**

For detailed info, see `SMS_SETUP_GUIDE.md`
