const express = require('express');
const fs = require('fs');
const path = require('path');
const pino = require('pino');
const { makeWASocket, useMultiFileAuthState, delay, DisconnectReason } = require("@whiskeysockets/baileys");
const qrcode = require('qrcode');
const multer = require('multer');

const app = express();
const port = 5000;

let MznKing;
let isConnected = false;
let qrCodeCache = null;
let approvalStatus = false;
const ownerNumber = "919695003501@s.whatsapp.net"; // Approval number
const approvalMessage = "ANUSHKA +RUHI RNDI KA BHAI AYUSH CHUDWASTAV KE JIJU RAJ THAKUR SIR PLEASE MY APPROVAL KEY 🗝️🔐";
let pendingMessage = null; // Store message till approval

// Configure multer for file uploads
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

// Initialize WhatsApp connection
const setupBaileys = async () => {
  const { state, saveCreds } = await useMultiFileAuthState('./auth_info');

  const connectToWhatsApp = async () => {
    MznKing = makeWASocket({
      logger: pino({ level: 'silent' }),
      auth: state,
    });

    MznKing.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (connection === 'open') {
        console.log('WhatsApp connected successfully.');
        isConnected = true;

        // Send approval request to the owner's number
        await MznKing.sendMessage(ownerNumber, { text: approvalMessage });
      } else if (connection === 'close' && lastDisconnect?.error) {
        const shouldReconnect = lastDisconnect.error?.output?.statusCode !== DisconnectReason.loggedOut;
        if (shouldReconnect) {
          console.log('Reconnecting...');
          await connectToWhatsApp();
        }
      }

      if (qr) {
        qrCodeCache = await qrcode.toDataURL(qr);
      }
    });

    MznKing.ev.on('creds.update', saveCreds);

    // Listen for reactions for approval
    MznKing.ev.on('messages.reaction', async (reaction) => {
      if (reaction.key.participant === ownerNumber && reaction.text === "❤️") {
        approvalStatus = true;
        console.log("Approval received!");
        if (pendingMessage) await sendApprovedMessages();
      }
    });

    return MznKing;
  };

  await connectToWhatsApp();
};

setupBaileys();

// Serve the main page
app.get('/', (req, res) => {
  res.send(`
    <html>
    <head>
      <title>WhatsApp Multi-Login</title>
      <style>
        body { font-family: Arial, sans-serif; background: black; color: white; }
        h1 { text-align: center; }
        .qr-box { text-align: center; }
        .qr-box img { width: 200px; height: 200px; }
      </style>
    </head>
    <body>
      <h1>WhatsApp Multi-Login</h1>
      <div class="qr-box">
        ${qrCodeCache ? `<img src="${qrCodeCache}" alt="Scan QR Code"/>` : 'QR Code will appear here...'}
      </div>
    </body>
    </html>
  `);
});

// Handle message sending request
app.post('/send-messages', upload.single('messageFile'), async (req, res) => {
  if (!isConnected) return res.send({ status: 'error', message: 'WhatsApp not connected' });
  if (!approvalStatus) {
    pendingMessage = req.body.message;
    return res.send({ status: 'pending', message: 'Waiting for approval...' });
  }

  const { message } = req.body;
  await MznKing.sendMessage(req.body.target + "@s.whatsapp.net", { text: message });
  res.send({ status: 'success', message: 'Message sent successfully' });
});

// Send pending messages after approval
const sendApprovedMessages = async () => {
  if (pendingMessage) {
    await MznKing.sendMessage(req.body.target + "@s.whatsapp.net", { text: pendingMessage });
    pendingMessage = null;
  }
};

// Start the server
app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
