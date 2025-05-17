const { makeWASocket, useSingleFileAuthState } = require('manul-ofc-baileys-new');
const express = require('express');
const cors = require('cors');
const qrcode = require('qrcode');
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Pair code storage
const pairCodes = new Map();
const activeSessions = new Map();

// WhatsApp connection
const { state, saveState } = useSingleFileAuthState('./auth_info.json');
let sock = null;

async function startWhatsApp() {
  sock = makeWASocket({
    auth: state,
    printQRInTerminal: false,
    browser: ['WhatsApp DP Changer', 'Chrome', 'Linux']
  });

  sock.ev.on('creds.update', saveState);
  
  sock.ev.on('messages.upsert', async ({ messages }) => {
    for (const msg of messages) {
      if (msg.key.remoteJid.endsWith('@s.whatsapp.net')) {
        const phone = msg.key.remoteJid.replace('@s.whatsapp.net', '');
        const code = msg.message?.conversation?.trim();
        
        if (pairCodes.has(phone) && pairCodes.get(phone).code === code) {
          activeSessions.set(phone, true);
          await sock.sendMessage(msg.key.remoteJid, { 
            text: 'Pair code accepted! Your DP will be updated shortly.'
          });
        }
      }
    }
  });
}

startWhatsApp();

// API Endpoints
app.post('/api/generate-pair', async (req, res) => {
  const { phone } = req.body;
  
  if (!phone) {
    return res.status(400).json({ error: 'Phone number required' });
  }

  const pairCode = Math.floor(100000 + Math.random() * 900000).toString();
  const expiresAt = Date.now() + 15 * 60 * 1000; // 15 minutes
  
  pairCodes.set(phone, { code: pairCode, expiresAt });
  
  // Generate QR code with deep link
  const deepLink = `https://wa.me/${phone}?text=Your%20DP%20Pair%20Code:%20${pairCode}`;
  const qrImage = await qrcode.toDataURL(deepLink);
  
  res.json({
    success: true,
    pairCode,
    qrImage,
    deepLink
  });
});

app.post('/api/update-dp', async (req, res) => {
  const { phone, imageData } = req.body;
  
  if (!activeSessions.has(phone)) {
    return res.status(403).json({ error: 'Not paired or session expired' });
  }

  try {
    const imageBuffer = Buffer.from(imageData.split(',')[1], 'base64');
    const processedImage = await sharp(imageBuffer)
      .resize(640, 640)
      .jpeg({ quality: 90 })
      .toBuffer();

    await sock.updateProfilePicture(`${phone}@s.whatsapp.net`, processedImage);
    
    activeSessions.delete(phone);
    pairCodes.delete(phone);
    
    res.json({ success: true, message: 'DP updated successfully!' });
  } catch (error) {
    console.error('DP update error:', error);
    res.status(500).json({ error: 'Failed to update DP' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
