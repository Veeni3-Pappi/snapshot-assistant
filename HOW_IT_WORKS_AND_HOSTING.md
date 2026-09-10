# 🔍 How It Works & Hosting Guide

## 📱 HOW THE APPLICATION WORKS

### Overview
The Salon Snapshot Assistant is a **full-stack web application** that uses AI to analyze CCTV images and generate daily operations reports.

---

## 🏗️ ARCHITECTURE

```
┌─────────────────────────────────────────────────────────────┐
│                    USER'S PHONE/BROWSER                     │
│  (Frontend: HTML/CSS/JavaScript - public/index.html)        │
└────────────────┬────────────────────────────────────────────┘
                 │
                 │ HTTP Requests/Responses
                 │
┌────────────────▼────────────────────────────────────────────┐
│              YOUR SERVER (Node.js + Express)                │
│  (Backend: server.js - Runs on port 3000)                  │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  Session Storage (In-Memory)                         │  │
│  │  - CCTV Snapshots (Base64)                          │  │
│  │  - Daily Book Image                                  │  │
│  │  - Payment Records Image                             │  │
│  └──────────────────────────────────────────────────────┘  │
└────────┬───────────────────────────────────┬────────────────┘
         │                                   │
         │ Image Analysis                    │ Email Sending
         │                                   │
┌────────▼──────────────┐          ┌────────▼──────────────┐
│   CLAUDE API          │          │   SMTP SERVER         │
│   (Anthropic)         │          │   (Gmail/SendGrid)    │
│   - Vision Analysis   │          │   - Email Delivery    │
│   - AI Processing     │          │                       │
└───────────────────────┘          └───────────────────────┘
```

---

## 🔄 HOW IT PROCESSES IMAGES

### Step-by-Step Workflow:

#### 1. **Upload Phase**
```
User uploads images → Browser sends to server → 
Server stores in memory as Base64 → Updates status
```

#### 2. **Analysis Phase**
```
User clicks "Analyze" → Server gathers ALL images →
Converts to Base64 → Sends to Claude API in ONE request →
Claude AI analyzes ALL images together →
Identifies clients, groups snapshots, compares with Daily Book →
Returns text analysis → Server sends back to browser
```

**⚠️ CRITICAL: Images are sent in ONE batch to Claude, not one-at-a-time!**

This ensures Claude can:
- See all images together
- Identify the same person across multiple snapshots
- Group images by client chronologically
- Never create duplicate client entries

#### 3. **Report Generation Phase**
```
User clicks "Email Report" → Server formats analysis as HTML →
Sends via SMTP to configured email → Returns success/failure
```

---

## 🧠 HOW IT KNOWS WHETHER IT SORTS IMAGES CORRECTLY

### Claude AI's Analysis Process:

The AI uses **computer vision** to analyze images with these capabilities:

#### ✅ What Claude AI CAN Do:

1. **Detect People Across Images**
   - Face recognition patterns
   - Body shape and posture
   - Clothing identification
   - Physical characteristics

2. **Identify Same Person**
   - Compares visual features across multiple images
   - Groups snapshots showing the same individual
   - Numbers them chronologically (Client 1, 2, 3...)

3. **Understand Context**
   - Recognizes salon environments (styling stations, reception, etc.)
   - Identifies activities (haircut, manicure, payment, etc.)
   - Reads visible text (names, times, services in Daily Book)
   - Spots service-related elements (tools, equipment)

4. **Compare Documents**
   - Reads handwritten Daily Book entries
   - Matches client names
   - Verifies services recorded
   - Identifies discrepancies

#### ⚠️ Limitations:

1. **Image Quality Dependent**
   - Blurry images = less accurate
   - Poor lighting = harder to identify
   - Distant shots = less detail

2. **Uses "Unable to Confirm"**
   - When uncertain, it says so
   - Never guesses or invents
   - Better to be honest than wrong

3. **Not Perfect Face Recognition**
   - Similar-looking people might confuse it
   - Masks/face coverings reduce accuracy
   - Multiple people in frame can complicate grouping

---

## ✅ HOW TO VERIFY IT'S WORKING CORRECTLY

### Testing Image Sorting:

#### Test 1: Simple Test (2 Clients)
1. Upload 4-6 images of TWO different people
2. Mix them up (Person A, Person B, Person A, Person B)
3. Run analysis
4. Check if Claude groups them correctly:
   - CLIENT 1: All Person A images
   - CLIENT 2: All Person B images

#### Test 2: Same Person Multiple Times
1. Upload 3 images of the SAME person at different times
2. Run analysis
3. Verify Claude creates only ONE client entry with all 3 snapshots

#### Test 3: Daily Book Comparison
1. Upload CCTV showing a service (e.g., pedicure)
2. Upload Daily Book that does NOT list that service
3. Run analysis
4. Expect: 🔵 BLUE ALERT for missing service

#### What to Look For:

✅ **Correct Sorting:**
- Same person's images grouped together
- Different people get separate CLIENT numbers
- Chronological ordering (first appearance = Client 1)

❌ **Incorrect Sorting:**
- Same person split into multiple clients (DUPLICATE)
- Different people merged into one client (WRONG)
- Random ordering (not chronological)

### Real-World Testing:

1. **Start Small**: Test with 2-3 clients first
2. **Use Clear Images**: Well-lit, close-up shots
3. **Review Results**: Manually verify each client grouping
4. **Provide Feedback**: If wrong, adjust image quality or angles

---

## 🌐 HOSTING GUIDE

### YES, IT NEEDS BACKEND HOSTING!

This is NOT a static website - it requires a **server running Node.js**.

---

## 🚀 HOSTING OPTIONS

### Option 1: **Local/Internal Hosting (FREE)**
**Best for:** Small salons, internal use only

#### Setup:
1. Keep the app on your desktop/laptop
2. Start server: `npm start`
3. Access from same WiFi: `http://YOUR-IP:3000`

#### Pros:
- ✅ Free
- ✅ Complete control
- ✅ No monthly costs

#### Cons:
- ❌ Computer must stay on
- ❌ Only accessible on local network
- ❌ Not internet-accessible

**How to Access from Phone:**
```bash
# On your computer:
npm start

# Get your IP:
npm run ip

# On your phone (same WiFi):
Open: http://192.168.x.x:3000
```

---

### Option 2: **Cloud Hosting (Recommended)**

#### A. **Heroku** (Easiest, ~$7/month)

**Pros:**
- ✅ Very easy setup
- ✅ Automatic HTTPS
- ✅ Automatic deployments
- ✅ Free tier available (with limitations)

**Cons:**
- ❌ Costs $7/month for always-on
- ❌ US-based servers

**Setup Steps:**
```bash
# 1. Install Heroku CLI
# Visit: https://devcenter.heroku.com/articles/heroku-cli

# 2. Login
heroku login

# 3. Create app
heroku create your-salon-snapshot

# 4. Add environment variables
heroku config:set ANTHROPIC_API_KEY=your_key_here
heroku config:set EMAIL_USER=your_email
heroku config:set EMAIL_PASSWORD=your_password
heroku config:set REPORT_RECIPIENT_EMAIL=recipient@email.com

# 5. Deploy
git push heroku main

# 6. Open app
heroku open
```

**Cost:** ~$7/month for Eco Dyno (24/7 availability)

---

#### B. **Railway** (Modern, $5/month)

**Pros:**
- ✅ Modern interface
- ✅ Easy deployment
- ✅ Free trial ($5 credit)
- ✅ Automatic HTTPS

**Cons:**
- ❌ $5/month after trial

**Setup Steps:**
1. Go to https://railway.app
2. Sign up with GitHub
3. Click "New Project" → "Deploy from GitHub repo"
4. Select your salon-snapshots_app repository
5. Add environment variables in Railway dashboard
6. Deploy!

**URL:** `https://your-app.up.railway.app`

**Cost:** ~$5/month

---

#### C. **DigitalOcean App Platform** ($12/month)

**Pros:**
- ✅ Reliable
- ✅ Good performance
- ✅ Scalable

**Cons:**
- ❌ More expensive
- ❌ Slightly more complex

**Setup Steps:**
1. Go to https://cloud.digitalocean.com
2. Create account
3. Apps → Create App → From GitHub
4. Select repository
5. Configure environment variables
6. Deploy

**Cost:** $12/month for Basic plan

---

#### D. **Render** (FREE tier available!)

**Pros:**
- ✅ FREE tier available!
- ✅ Automatic HTTPS
- ✅ Easy setup

**Cons:**
- ❌ Free tier spins down after inactivity (slow first load)
- ❌ Limited resources on free tier

**Setup Steps:**
1. Go to https://render.com
2. Sign up
3. New → Web Service
4. Connect GitHub repository
5. Configure:
   - Build Command: `npm install`
   - Start Command: `npm start`
6. Add environment variables
7. Deploy

**Cost:** FREE (with spin-down) or $7/month (always-on)

---

### Option 3: **VPS Hosting (Advanced)**

**Providers:** AWS EC2, Google Cloud, Linode, Vultr

**Pros:**
- ✅ Complete control
- ✅ Can host multiple apps
- ✅ Customizable

**Cons:**
- ❌ Requires technical knowledge
- ❌ Manual setup and maintenance

**Recommended for:** Developers or larger businesses

---

## 💰 COST COMPARISON

| Option | Monthly Cost | Setup Difficulty | Best For |
|--------|-------------|------------------|----------|
| **Local (WiFi only)** | FREE | Easy | Testing, small internal use |
| **Render (Free)** | FREE | Easy | Occasional use |
| **Railway** | $5 | Easy | Small-medium salons |
| **Heroku** | $7 | Easy | Reliable 24/7 access |
| **DigitalOcean** | $12 | Medium | Growing businesses |
| **VPS** | $5-20+ | Hard | Tech-savvy users |

---

## 📋 WHAT YOU NEED FOR HOSTING

### Required for ALL hosting options:

1. **Anthropic API Key** (Claude AI)
   - Sign up: https://console.anthropic.com/
   - Create API key
   - Cost: Pay-per-use (~$0.003 per image)
   - Estimate: $5-15/month for daily use

2. **Email Credentials**
   - Gmail: Free (use app password)
   - SendGrid: Free tier (100 emails/day)

3. **GitHub Account** (for cloud hosting)
   - Free: https://github.com

### Environment Variables Needed:
```
ANTHROPIC_API_KEY=sk-ant-your-key-here
EMAIL_SERVICE=gmail
EMAIL_USER=your-email@gmail.com
EMAIL_PASSWORD=your-app-password
REPORT_RECIPIENT_EMAIL=reports@salon.com
PORT=3000
```

---

## 🎯 RECOMMENDED SETUP FOR SALONS

### Small Salon (1-5 staff):
**→ Use Render (FREE tier)**
- Cost: $0/month + Claude API (~$10/month)
- Total: ~$10/month
- Setup: 15 minutes

### Medium Salon (6-15 staff):
**→ Use Railway ($5/month)**
- Cost: $5/month + Claude API (~$15/month)
- Total: ~$20/month
- Setup: 10 minutes

### Large Salon Chain:
**→ Use DigitalOcean or VPS**
- Cost: $12-20/month + Claude API (~$30/month)
- Total: ~$40-50/month
- Setup: 30-60 minutes

---

## 🔐 SECURITY NOTES

### Important:

1. **Never commit .env to GitHub**
   - Already in .gitignore
   - Use platform's environment variable settings

2. **Use HTTPS in production**
   - All cloud platforms provide this automatically

3. **Protect your API keys**
   - Don't share them
   - Rotate them regularly

4. **Use app-specific passwords for Gmail**
   - Not your regular Gmail password
   - Generate at: https://myaccount.google.com/apppasswords

---

## 📱 ACCESSING THE APP

### After Hosting:

#### Local (WiFi):
```
http://192.168.x.x:3000
```

#### Cloud (Internet):
```
https://your-app-name.herokuapp.com
https://your-app.up.railway.app
https://your-app.onrender.com
```

**Save as home screen bookmark on phone for easy access!**

---

## 🧪 TESTING CHECKLIST

Before going live:

- [ ] Upload 2-3 test images
- [ ] Verify they upload successfully
- [ ] Click "Analyze" and wait
- [ ] Check if clients are grouped correctly
- [ ] Verify "Unable to confirm" is used appropriately
- [ ] Test email delivery
- [ ] Check email arrives in inbox
- [ ] Review email formatting on phone
- [ ] Test from actual phone (not just computer)
- [ ] Verify HTTPS (if cloud hosted)

---

## ❓ FAQ

### Q: Do images stay on the server?
**A:** No! Images are stored in memory only during the session. When you restart the server or click "Clear Session", they're deleted.

### Q: Can multiple salons use the same installation?
**A:** Currently no - it's single-session. You'd need separate deployments or modify the code for multi-tenancy.

### Q: How accurate is the AI?
**A:** Very accurate with clear, well-lit images. Quality matters! Test with your actual CCTV setup.

### Q: What if it groups images wrong?
**A:** Review the images - they may be too blurry or similar. Try better quality snapshots.

### Q: Can I use this offline?
**A:** No - it needs internet for Claude API and email sending.

### Q: How much does Claude API cost?
**A:** ~$0.003 per image analyzed. For daily use with 10-20 images: ~$10-15/month.

---

## 🆘 TROUBLESHOOTING

### Images not grouping correctly?
- Use clearer, closer images
- Ensure good lighting
- Take images from consistent angles
- Include faces when possible

### Analysis says "Unable to confirm" too much?
- This is CORRECT behavior! Better than guessing.
- Improve image quality for more confidence.

### Email not sending?
- Check .env configuration
- Verify email credentials
- Check spam folder
- Try different email service

---

## 🎓 SUMMARY

**How It Works:**
1. Frontend (HTML) runs in browser
2. Backend (Node.js) runs on server
3. Images sent to Claude API in ONE batch
4. AI analyzes and groups by client
5. Report generated and emailed

**Hosting Required:**
- YES - needs Node.js server running
- Choose based on budget and technical skill
- Recommended: Railway ($5/mo) or Render (FREE)

**Image Sorting:**
- AI uses computer vision to identify people
- Groups same person across images
- Test with clear, well-lit photos
- Verify results manually at first

**Total Cost (Typical):**
- Hosting: $0-7/month
- Claude API: $10-15/month
- Email: FREE (Gmail)
- **Total: $10-22/month**

---

**Ready to host? Start with Render's free tier, then upgrade if needed!**
