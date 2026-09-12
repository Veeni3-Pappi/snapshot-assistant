const http = require('http');
const https = require('https');
const { URL } = require('url');

/**
 * Salon Snapshot SMS Gateway Service
 * 
 * Supports:
 * 1. Direct Push to Android MSMS / smsgt gateway (HTTP POST to phone's embedded server)
 * 2. Polling Queue (Android phone polls GET /api/sms-gateway/pending and reports back)
 * 3. Fallback to Africa's Talking if configured and gateway is offline
 */

class SmsGateway {
  constructor() {
    // In-memory queue of SMS messages
    this.messageQueue = [];
    // Map of registered Android gateway devices: deviceId -> deviceInfo
    this.registeredDevices = new Map();
    // In-memory log of recent gateway events
    this.recentLogs = [];
    this.maxLogs = 100;
    this.maxQueueHistory = 500;
    this.messageCounter = 1;

    this.log('SMS Gateway initialized');
  }

  log(message, type = 'info') {
    const timestamp = new Date().toISOString();
    const entry = { timestamp, type, message };
    this.recentLogs.unshift(entry);
    if (this.recentLogs.length > this.maxLogs) {
      this.recentLogs.pop();
    }
    const icon = type === 'error' ? '❌' : type === 'warn' ? '⚠️' : '📱';
    console.log(`${icon} [SMS-GATEWAY] ${message}`);
  }

  /**
   * Register or update an Android gateway device
   */
  registerDevice(deviceInfo) {
    const {
      deviceId = 'default_phone',
      model = 'Android Device',
      ip = '',
      port = 8080,
      batteryLevel = null,
      simSlots = [],
      appVersion = '1.0'
    } = deviceInfo;

    const gatewayUrl = ip ? `http://${ip}:${port}` : null;

    const device = {
      deviceId,
      model,
      ip,
      port,
      gatewayUrl,
      batteryLevel,
      simSlots,
      appVersion,
      lastSeen: new Date().toISOString()
    };

    this.registeredDevices.set(deviceId, device);
    this.log(`Device registered: ${model} (${deviceId}) at ${gatewayUrl || 'polling only'}`);
    return device;
  }

  /**
   * Update device heartbeat
   */
  heartbeat(deviceId, extraInfo = {}) {
    if (this.registeredDevices.has(deviceId)) {
      const device = this.registeredDevices.get(deviceId);
      Object.assign(device, extraInfo, { lastSeen: new Date().toISOString() });
      return device;
    }
    return this.registerDevice({ deviceId, ...extraInfo });
  }

  /**
   * Get active devices (seen within last 2 minutes)
   */
  getActiveDevices() {
    const now = Date.now();
    const active = [];
    for (const [id, dev] of this.registeredDevices.entries()) {
      const seenTime = new Date(dev.lastSeen).getTime();
      const isOnline = (now - seenTime) < 120000; // 2 minutes
      active.push({ ...dev, isOnline });
    }
    return active;
  }

  /**
   * Enqueue an SMS message
   */
  enqueueMessage({ to, message, simSlot = 0, metadata = {} }) {
    const messageId = `sms_${Date.now()}_${this.messageCounter++}`;
    const item = {
      id: messageId,
      to,
      message,
      simSlot,
      status: 'pending', // pending, sent, delivered, failed
      createdAt: new Date().toISOString(),
      sentAt: null,
      deliveredAt: null,
      error: null,
      retries: 0,
      metadata
    };

    this.messageQueue.push(item);
    if (this.messageQueue.length > this.maxQueueHistory) {
      // Remove oldest completed/failed items
      const removableIndex = this.messageQueue.findIndex(m => m.status === 'delivered' || m.status === 'sent' || m.status === 'failed');
      if (removableIndex !== -1) {
        this.messageQueue.splice(removableIndex, 1);
      }
    }

    this.log(`Message queued: ${messageId} to ${to}`);
    return item;
  }

  /**
   * Get pending messages for the Android phone to poll
   */
  getPendingMessages(limit = 10) {
    return this.messageQueue
      .filter(m => m.status === 'pending')
      .slice(0, limit);
  }

  /**
   * Update status of a message from the Android phone callback
   */
  updateMessageStatus(messageId, status, details = {}) {
    const item = this.messageQueue.find(m => m.id === messageId);
    if (!item) {
      this.log(`Received status for unknown message ${messageId}`, 'warn');
      return null;
    }

    item.status = status;
    if (status === 'sent') {
      item.sentAt = new Date().toISOString();
    } else if (status === 'delivered') {
      item.deliveredAt = new Date().toISOString();
    } else if (status === 'failed') {
      item.error = details.error || 'Unknown dispatch error';
    }

    if (details.parts) item.parts = details.parts;
    if (details.simSlot !== undefined) item.simSlot = details.simSlot;

    this.log(`Message ${messageId} status updated to: ${status} (to: ${item.to})`);
    return item;
  }

  /**
   * Send HTTP request directly to the Android Gateway server
   */
  async sendDirectToPhone(targetUrl, payload) {
    return new Promise((resolve, reject) => {
      try {
        const parsedUrl = new URL(targetUrl);
        const postData = JSON.stringify(payload);
        const isHttps = parsedUrl.protocol === 'https:';
        const client = isHttps ? https : http;

        const options = {
          hostname: parsedUrl.hostname,
          port: parsedUrl.port || (isHttps ? 443 : 80),
          path: parsedUrl.pathname === '/' ? '/send' : parsedUrl.pathname,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(postData),
            'X-Gateway-Client': 'SalonSnapshot-Backend'
          },
          timeout: 10000 // 10s timeout
        };

        const req = client.request(options, (res) => {
          let responseData = '';
          res.on('data', chunk => { responseData += chunk; });
          res.on('end', () => {
            if (res.statusCode >= 200 && res.statusCode < 300) {
              try {
                const parsed = JSON.parse(responseData);
                resolve(parsed);
              } catch (e) {
                resolve({ success: true, raw: responseData });
              }
            } else {
              reject(new Error(`Gateway phone returned HTTP ${res.statusCode}: ${responseData}`));
            }
          });
        });

        req.on('error', (err) => {
          reject(err);
        });

        req.on('timeout', () => {
          req.destroy();
          reject(new Error('Connection to Android Gateway timed out (10s)'));
        });

        req.write(postData);
        req.end();
      } catch (err) {
        reject(err);
      }
    });
  }

  /**
   * Helper to resolve SIM slot (supports 1-based and 0-based indexing)
   */
  resolveSimSlot(val) {
    if (val === undefined || val === null || val === '') {
      val = process.env.SMS_SIM_SLOT;
    }
    const str = String(val !== undefined && val !== null ? val : '1').trim().toLowerCase();
    if (str === '2' || str === 'sim2' || str === 'sim 2' || str === 'slot1') {
      return 1; // Slot 1 (SIM 2)
    }
    // Default to SIM 1 (Slot 0)
    return 0; // Slot 0 (SIM 1)
  }

  /**
   * Primary method to send an SMS
   * Respects SMS_PROVIDER ('msms', 'smsgt', 'africastalking', 'auto')
   */
  async sendSMS(message, recipient, options = {}) {
    const provider = (process.env.SMS_PROVIDER || 'msms').toLowerCase();
    const smsRecipient = recipient || process.env.SMS_RECIPIENT;

    if (!smsRecipient) {
      throw new Error('No SMS recipient specified');
    }

    const resolvedSlot = this.resolveSimSlot(options.simSlot);
    this.log(`Sending SMS to ${smsRecipient} via provider '${provider}' on Safaricom SIM ${resolvedSlot + 1} (Slot ${resolvedSlot})`);

    // 1. Direct Africa's Talking provider
    if (provider === 'africastalking') {
      return this.sendViaAfricasTalking(message, smsRecipient, options.africasTalkingClient);
    }

    // 2. MSMS / SMSGT Android Gateway
    // Determine the phone target URL: from .env or active registered devices
    let targetPhoneUrl = process.env.SMS_GATEWAY_URL || null;

    if (!targetPhoneUrl) {
      // Check if we have an active online registered Android phone
      const activeDevices = this.getActiveDevices().filter(d => d.isOnline && d.gatewayUrl);
      if (activeDevices.length > 0) {
        targetPhoneUrl = activeDevices[0].gatewayUrl;
        this.log(`Auto-detected active Android gateway device: ${activeDevices[0].model} at ${targetPhoneUrl}`);
      }
    }

    // Prepare standard payload compatible with Msms Gateway and SMS Gate (smsgt)
    const payload = {
      to: smsRecipient,
      phoneNumbers: [smsRecipient], // compatible with Capcom / standard smsgt
      message: message,
      simSlot: resolvedSlot,       // 0 for SIM 1, 1 for SIM 2
      simNumber: resolvedSlot + 1, // 1 for SIM 1, 2 for SIM 2
      carrier: 'Safaricom'
    };

    // A. Attempt Direct Push if URL is available
    if (targetPhoneUrl) {
      try {
        this.log(`Attempting direct push to Android phone at ${targetPhoneUrl}...`);
        const result = await this.sendDirectToPhone(targetPhoneUrl, payload);
        this.log(`Direct send to Android phone succeeded: ${JSON.stringify(result)}`);
        
        // Also track in queue for history
        const queueItem = this.enqueueMessage({
          to: smsRecipient,
          message,
          simSlot: payload.simSlot,
          metadata: { provider: 'msms-direct', targetPhoneUrl }
        });
        this.updateMessageStatus(queueItem.id, 'sent', result);

        return {
          success: true,
          provider: 'msms-direct',
          messageId: result.messageId || queueItem.id,
          recipient: smsRecipient,
          details: result
        };
      } catch (directError) {
        this.log(`Direct push to ${targetPhoneUrl} failed: ${directError.message}`, 'warn');
        if (provider === 'msms' || provider === 'smsgt') {
          // Fall through to queue mode
        } else if (provider === 'auto' && options.africasTalkingClient) {
          this.log('Falling back to Africa\'s Talking...', 'info');
          return this.sendViaAfricasTalking(message, smsRecipient, options.africasTalkingClient);
        }
      }
    }

    // B. Queue Mode: Enqueue message for Android phone polling
    this.log(`Enqueuing message for Android phone polling...`);
    const queuedItem = this.enqueueMessage({
      to: smsRecipient,
      message,
      simSlot: payload.simSlot,
      metadata: { provider: 'msms-queued' }
    });

    // If waitMs is requested, we can wait a short time to see if the phone picks it up immediately
    const waitMs = options.waitMs || 3000;
    const startTime = Date.now();

    while (Date.now() - startTime < waitMs) {
      const current = this.messageQueue.find(m => m.id === queuedItem.id);
      if (current && (current.status === 'sent' || current.status === 'delivered')) {
        return {
          success: true,
          provider: 'msms-polling',
          messageId: current.id,
          recipient: smsRecipient,
          status: current.status
        };
      }
      await new Promise(r => setTimeout(r, 500));
    }

    // If it hasn't finished yet, return queued confirmation
    return {
      success: true,
      provider: 'msms-queued',
      messageId: queuedItem.id,
      recipient: smsRecipient,
      status: 'queued',
      message: 'Message queued for Android phone MSMS dispatch'
    };
  }

  /**
   * Helper to send via Africa's Talking
   */
  async sendViaAfricasTalking(message, recipient, africasTalkingClient) {
    if (!africasTalkingClient) {
      throw new Error('Africa\'s Talking SMS client not initialized');
    }
    const options = {
      to: [recipient],
      message: message,
      from: process.env.AFRICASTALKING_SENDER_ID || null
    };
    const result = await africasTalkingClient.send(options);
    this.log(`Africa's Talking send succeeded: ${JSON.stringify(result)}`);
    return {
      success: true,
      provider: 'africastalking',
      recipient,
      messageId: result.SMSMessageData?.Recipients?.[0]?.messageId,
      details: result
    };
  }

  /**
   * Get full gateway diagnostics
   */
  getStatus() {
    return {
      provider: process.env.SMS_PROVIDER || 'msms',
      configuredGatewayUrl: process.env.SMS_GATEWAY_URL || null,
      smsRecipient: process.env.SMS_RECIPIENT || null,
      queue: {
        total: this.messageQueue.length,
        pending: this.messageQueue.filter(m => m.status === 'pending').length,
        sent: this.messageQueue.filter(m => m.status === 'sent').length,
        delivered: this.messageQueue.filter(m => m.status === 'delivered').length,
        failed: this.messageQueue.filter(m => m.status === 'failed').length
      },
      activeDevices: this.getActiveDevices(),
      recentMessages: this.messageQueue.slice(-15).reverse(),
      recentLogs: this.recentLogs.slice(0, 20)
    };
  }

  /**
   * Clear all messages from queue
   */
  clearQueue() {
    const count = this.messageQueue.length;
    this.messageQueue = [];
    this.log(`Cleared ${count} messages from queue`);
    return { cleared: count };
  }
}

// Export singleton instance
const smsGateway = new SmsGateway();
module.exports = smsGateway;
