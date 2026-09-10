#!/bin/bash

# Script to get local IP address for mobile access

echo "=========================================="
echo "  Salon Snapshot - Mobile Access Helper"
echo "=========================================="
echo ""
echo "To access from your phone:"
echo ""

# Get the local IP address (excluding localhost)
IP=$(hostname -I | awk '{print $1}')

if [ -n "$IP" ]; then
    echo "✅ Your computer's IP address: $IP"
    echo ""
    echo "📱 On your phone's browser, visit:"
    echo ""
    echo "   http://$IP:3000"
    echo ""
else
    echo "❌ Could not detect IP address"
    echo ""
    echo "Try running this command manually:"
    echo "   hostname -I"
    echo ""
fi

echo "=========================================="
echo "Make sure:"
echo "  1. Your phone is on the same WiFi"
echo "  2. The server is running (npm start)"
echo "  3. Firewall allows port 3000"
echo "=========================================="
