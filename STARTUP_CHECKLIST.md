# 🚦 Startup Checklist

Before using the Salon Snapshot Assistant for the first time, complete this checklist.

## ⚙️ Configuration Check

### 1. Environment Variables (.env file)

Open the `.env` file and verify:

- [ ] `ANTHROPIC_API_KEY` is set to your actual Claude API key (starts with `sk-ant-`)
- [ ] Email configuration is complete (choose ONE method):
  
  **Option A: Gmail/SMTP**
  - [ ] `EMAIL_SERVICE` is set (e.g., `gmail`)
  - [ ] `EMAIL_USER` is your email address
  - [ ] `EMAIL_PASSWORD` is your app-specific password (NOT your regular password)
  
  **Option B: SendGrid**
  - [ ] `SENDGRID_API_KEY` is set (starts with `SG.`)
  
- [ ] `REPORT_RECIPIENT_EMAIL` is set to where reports should be sent

### 2. Dependencies

- [ ] Run `npm install` to install all required packages
- [ ] No error messages during installation
- [ ] `node_modules/` folder exists

### 3. Test API Keys

#### Test Claude API Key:
```bash
# Quick test (optional)
curl https://api.anthropic.com/v1/messages \
  -H "x-api-key: YOUR_ANTHROPIC_API_KEY" \
  -H "anthropic-version: 2023-06-01" \
  -H "content-type: application/json" \
  -d '{"model":"claude-3-5-sonnet-20241022","max_tokens":10,"messages":[{"role":"user","content":"Hi"}]}'
```

Should return a JSON response (not an error).

#### Test Email (Gmail):
- [ ] 2-factor authentication is enabled on your Google account
- [ ] App password was generated from https://myaccount.google.com/apppasswords
- [ ] You're using the 16-character app password (no spaces)

## 🔌 Network Setup

### For Desktop Testing:
- [ ] No configuration needed
- [ ] Access via `http://localhost:3000`

### For Phone Testing (Same WiFi):
- [ ] Computer and phone are on the same WiFi network
- [ ] Firewall allows incoming connections on port 3000
- [ ] Get your IP address:
  ```bash
  npm run ip
  # or manually:
  hostname -I
  ```
- [ ] Note the IP address (e.g., 192.168.1.105)
- [ ] Phone will access: `http://YOUR-IP:3000`

## 🚀 First Start

### 1. Start the Server

```bash
npm start
```

Expected output:
```
Salon Snapshot Assistant running on port 3000
Open http://localhost:3000 in your browser
```

- [ ] Server starts without errors
- [ ] Port 3000 is available (not already in use)

### 2. Access the App

**Desktop:**
- [ ] Open browser to `http://localhost:3000`
- [ ] Page loads completely
- [ ] Status bar shows: 0 snapshots, ✗ Daily Book, ✗ Payment
- [ ] All 5 sections visible

**Mobile:**
- [ ] Phone browser opens to `http://YOUR-IP:3000`
- [ ] Page is responsive and readable
- [ ] Buttons are easy to tap
- [ ] File upload buttons work

## 🧪 Initial Test

### Quick Functionality Test

1. **Upload Test**
   - [ ] Select 2-3 photos (any photos for testing)
   - [ ] Click "Upload Snapshots"
   - [ ] Success message appears
   - [ ] Status bar shows count > 0
   - [ ] Analyze button becomes enabled (not grayed out)

2. **Analysis Test**
   - [ ] Click "Analyze Daily Operations"
   - [ ] Loading spinner appears
   - [ ] Wait for Claude AI to respond (may take 10-30 seconds)
   - [ ] Analysis results appear on screen
   - [ ] "Generate & Email Report" button appears
   - [ ] No error messages

3. **Email Test**
   - [ ] Click "Generate & Email Report"
   - [ ] Wait for email to send
   - [ ] Success message: "Report sent successfully to [email]"
   - [ ] Check recipient email inbox (and spam folder)
   - [ ] Email received with formatted report
   - [ ] Report is readable on mobile device

## ❌ Troubleshooting

### Server won't start
```
Error: listen EADDRINUSE: address already in use :::3000
```
**Solution**: Port 3000 is in use. Either:
- Stop other process using port 3000
- Change `PORT=3001` in `.env` file

---

```
Error: Cannot find module 'express'
```
**Solution**: Run `npm install` first

---

### Analysis fails
```
Error analyzing snapshots: 401 Unauthorized
```
**Solution**: 
- Check `ANTHROPIC_API_KEY` in `.env` is correct
- Verify API key is active at https://console.anthropic.com/
- Restart server after changing `.env`

---

### Email fails (Gmail)
```
Error: Invalid login: 535-5.7.8 Username and Password not accepted
```
**Solution**:
- Ensure using app-specific password, NOT regular Gmail password
- Generate new app password at https://myaccount.google.com/apppasswords
- Update `EMAIL_PASSWORD` in `.env`
- Restart server

---

### Can't access from phone
**Solution**:
- Verify phone and computer on same WiFi network
- Use `http://` not `https://`
- Check firewall isn't blocking port 3000
- Try different port if network blocks 3000

---

### Images too large
```
Error: File too large
```
**Solution**:
- Individual file limit is 10MB
- Compress images if needed
- Use lower resolution CCTV snapshots

## ✅ Ready for Production Use

Once all checklist items are complete:

- [ ] Server starts successfully
- [ ] Can upload files
- [ ] Analysis completes without errors
- [ ] Email delivers successfully
- [ ] Accessible from phone (if needed)
- [ ] No console errors

## 📚 Next Steps

1. **Read the User Guide**: See `README.md` for detailed usage instructions
2. **Understand the Rules**: Review `SPECIFICATION_CHECKLIST.md` to understand analysis rules
3. **Test Thoroughly**: Follow `TESTING_GUIDE.md` for comprehensive testing
4. **Daily Use**: Start uploading real CCTV snapshots and daily books

## 🆘 Getting Help

If you encounter issues not covered here:

1. Check server console logs for detailed error messages
2. Check browser console (F12 → Console tab) for frontend errors
3. Review `README.md` troubleshooting section
4. Verify all checklist items are actually complete
5. Try restarting the server after any `.env` changes

## 🔒 Security Reminders

- [ ] Never commit `.env` file to git
- [ ] Keep API keys confidential
- [ ] Use app-specific passwords for Gmail
- [ ] Regularly rotate API keys
- [ ] Clear session data after each day

---

**Once all items are checked, you're ready to use the Salon Snapshot Assistant!** 🎉
