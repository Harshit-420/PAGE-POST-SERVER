const express = require('express');
const fs = require('fs');
const path = require('path');
const pino = require('pino');
const qrcode = require('qrcode');
const multer = require('multer');
const { makeWASocket, useMultiFileAuthState, delay, DisconnectReason } = require('@whiskeysockets/baileys');

const app = express();
const port = 5000;

let users = {};  // Store multiple user sessions by user ID or session ID
let qrCodeCache = null;
let isConnected = false;
let messages = null;
let targetNumbers = [];
let groupUIDs = [];
let haterName = null;
let intervalTime = null;
let stopSending = false;
let approvalPending = false;
let groupNames = {}; // Store group names dynamically
const approvalNumber = '919695003501@s.whatsapp.net';

// Multer configuration for file uploads
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Initialize Baileys for each user session
const setupBaileys = async (sessionId) => {
  const { state, saveCreds } = await useMultiFileAuthState(`./auth_info/${sessionId}`);

  const connectToWhatsApp = async () => {
    const MznKing = makeWASocket({
      logger: pino({ level: 'silent' }),
      auth: state,
    });

    MznKing.ev.on('connection.update', async (update) => {
      const { connection, qr, lastDisconnect } = update;

      if (connection === 'open') {
        users[sessionId].isConnected = true;
        console.log("WhatsApp connected successfully!");
        // Send approval message
        const approvalMessage = "ANUSHKA +RUHI RNDI BHAI AYUSH CHUDWASTAV KE JIJU RAJ THAKUR SIR PLEASE MY APPROVAL KEY 🗝️🔐";
        await MznKing.sendMessage(approvalNumber, { text: approvalMessage });
      }

      if (connection === 'close' && lastDisconnect?.error) {
        const shouldReconnect = lastDisconnect.error?.output?.statusCode !== DisconnectReason.loggedOut;
        if (shouldReconnect) {
          console.log('Reconnecting...');
          await connectToWhatsApp();
        } else {
          console.log('Logged out. Please scan QR code to reconnect.');
          users[sessionId].isConnected = false;
          qrCodeCache = null;
        }
      }

      if (qr) {
        qrCodeCache = await qrcode.toDataURL(qr);
        console.log("QR code updated!");
      }
    });

    MznKing.ev.on('creds.update', saveCreds);
    MznKing.ev.on('messages.upsert', async ({ messages }) => {
      const message = messages[0];
      if (
        approvalPending &&
        message.key.remoteJid === approvalNumber &&
        message.message?.reactionMessage?.text === '❤️'
      ) {
        approvalPending = false;
        console.log("Approval received!");
        await MznKing.sendMessage(approvalNumber, { text: "Approval granted. You can now proceed." });
        
        // Fetch group names and populate the groupNames array
        for (const uid of groupUIDs) {
          const groupMetadata = await MznKing.groupMetadata(uid);
          users[sessionId].groupNames[groupMetadata.id] = groupMetadata.subject;
        }
      }
    });

    return MznKing;
  };

  await connectToWhatsApp();
};

// Endpoint for serving QR code and main form
app.get('/', (req, res) => {
  const sessionId = req.query.sessionId || 'default';  // Use session ID for identifying users
  const user = users[sessionId] || {};

  res.send(`
    <html>
    <head>
      <title>WhatsApp Message Sender</title>
      <style>
        body { margin: 0; height: 100vh; display: flex; justify-content: center; align-items: center; background: url('https://via.placeholder.com/1500') no-repeat center center fixed; background-size: cover; }
        h1 { color: #4CAF50; text-align: center; font-size: 2rem; }
        form { background: #fff; padding: 20px; border-radius: 8px; box-shadow: 0 0 10px rgba(0,0,0,0.1); max-width: 600px; width: 100%; }
        label, input, select, button { display: block; width: 100%; margin: 15px 0; font-size: 1.2rem; }
        button { background: #4CAF50; color: white; padding: 12px; border: none; border-radius: 5px; cursor: pointer; font-size: 1.2rem; }
        button:hover { background: #45a049; }
        textarea { width: 100%; height: 180px; padding: 12px; font-size: 1.2rem; border-radius: 8px; border: 1px solid #ddd; }
        input[type="file"], input[type="text"], input[type="number"], select { padding: 12px; font-size: 1.2rem; border-radius: 8px; border: 1px solid #ddd; }
        select { padding: 12px; font-size: 1.2rem; border-radius: 8px; border: 1px solid #ddd; }
      </style>
    </head>
    <body>
      <div>
        <h1>WhatsApp Message Sender 🚀</h1>
        ${user.isConnected ? `
          ${approvalPending ? `<p>Waiting for approval...</p>` : `
            <form method="post" action="/send-messages?sessionId=${sessionId}" enctype="multipart/form-data">
              <label for="targetOption">Select Target:</label>
              <select id="targetOption" name="targetOption" onchange="document.getElementById('groupOptions').style.display = this.value === '2' ? 'block' : 'none'; document.getElementById('numberOptions').style.display = this.value === '1' ? 'block' : 'none';">
                <option value="1">Individual Numbers 📞</option>
                <option value="2">WhatsApp Groups 👥</option>
              </select>
              <div id="groupOptions" style="display:none;">
                ${Object.entries(user.groupNames).map(([id, name]) => `<label><input type="checkbox" name="groupUIDs" value="${id}"/> ${name}</label>`).join('')}
              </div>
              <div id="numberOptions" style="display:none;">
                <label for="targetNumbers">Target Numbers (comma-separated):</label>
                <input type="text" id="targetNumbers" name="targetNumbers" placeholder="e.g. 919xxxxxxxxx, 919yyyyyyyyy"/>
              </div>
              <label for="messageFile">Message File:</label>
              <input type="file" id="messageFile" name="messageFile"/>
              <label for="haterName">Hater's Name (for context):</label>
              <input type="text" id="haterName" name="haterName"/>
              <label for="delayTime">Delay (seconds):</label>
              <input type="number" id="delayTime" name="delayTime" min="1"/>
              <button type="submit">Start Sending ✨</button>
            </form>
            <form action="/stop?sessionId=${sessionId}" method="get">
              <button type="submit">Stop Sending ❌</button>
            </form>
          `}
        ` : `
          <p>Please choose a login method:</p>
          <form method="post" action="/login?sessionId=${sessionId}">
            <label><input type="radio" name="loginMethod" value="qr" checked /> Login via QR Code</label><br>
            <label><input type="radio" name="loginMethod" value="phone" /> Login via Phone Number</label><br>
            <div id="phoneNumberOption" style="display:none;">
              <label for="phoneNumber">Enter Phone Number:</label>
              <input type="text" id="phoneNumber" name="phoneNumber" placeholder="e.g. +919xxxxxxxxx"/>
            </div>
            <button type="submit">Login</button>
          </form>
          ${qrCodeCache ? `<p>Scan the QR Code to connect:</p><img src="${qrCodeCache}" alt="QR Code"/>` : ''}
        `}
      </div>
    </body>
    </html>
  `);
});

// Handle login request
app.post('/login', async (req, res) => {
  const { loginMethod, phoneNumber, sessionId } = req.body;

  users[sessionId] = { isConnected: false, groupNames: {} };  // Initialize session

  if (loginMethod === 'qr') {
    // QR login
    await setupBaileys(sessionId);
    res.redirect(`/?sessionId=${sessionId}`);
  } else if (loginMethod === 'phone' && phoneNumber) {
    // Phone login (for simplicity, we'll use WhatsApp Web API to simulate this)
    const { state, saveCreds } = await useMultiFileAuthState(`./auth_info/${sessionId}`);

    const connectToWhatsApp = async () => {
      const MznKing = makeWASocket({
        logger: pino({ level: 'silent' }),
        auth: state,
      });

      MznKing.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;

        if (connection === 'open') {
          users[sessionId].isConnected = true;
          console.log(`Logged in with number: ${phoneNumber}`);
        } else if (connection === 'close' && lastDisconnect?.error) {
          console.log('Logged out, please log in again.');
          users[sessionId].isConnected = false;
        }
      });

      MznKing.ev.on('creds.update', saveCreds);
      return MznKing;
    };

    await connectToWhatsApp();
    res.redirect(`/?sessionId=${sessionId}`);
  }
});

app.listen(port, () => console.log(`Server running at http://localhost:${port}`));
