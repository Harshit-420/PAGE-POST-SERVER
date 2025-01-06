const express = require('express');
const fs = require('fs');
const path = require('path');
const pino = require('pino');
const qrcode = require('qrcode');
const multer = require('multer');
const { makeWASocket, useMultiFileAuthState, delay, DisconnectReason } = require("@whiskeysockets/baileys");

const app = express();
const port = 5000;

let MznKing;
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

// Initialize Baileys
const setupBaileys = async () => {
  const { state, saveCreds } = await useMultiFileAuthState('./auth_info');

  const connectToWhatsApp = async () => {
    MznKing = makeWASocket({
      logger: pino({ level: 'silent' }),
      auth: state,
    });

    MznKing.ev.on('connection.update', async (update) => {
      const { connection, qr, lastDisconnect } = update;

      if (connection === 'open') {
        console.log("WhatsApp connected successfully!");
        isConnected = true;

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
          isConnected = false;
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
        
        // Here we can fetch group names and populate the groupNames array
        // Assuming groupUIDs is already populated
        for (const uid of groupUIDs) {
          const groupMetadata = await MznKing.groupMetadata(uid);
          groupNames[groupMetadata.id] = groupMetadata.subject;
        }
      }
    });

    return MznKing;
  };

  await connectToWhatsApp();
};

setupBaileys();

// Endpoint for serving QR code and main form
app.get('/', (req, res) => {
  res.send(`
    <html>
    <head>
      <title>WhatsApp Message Sender</title>
      <style>
        body { margin: 0; height: 100vh; display: flex; justify-content: center; align-items: center; background: url('https://via.placeholder.com/1500') no-repeat center center fixed; background-size: cover; }
        h1 { color: #4CAF50; text-align: center; }
        form { background: #fff; padding: 20px; border-radius: 8px; box-shadow: 0 0 10px rgba(0,0,0,0.1); max-width: 500px; width: 100%; }
        label, input, select, button { display: block; width: 100%; margin: 10px 0; }
        button { background: #4CAF50; color: white; padding: 10px; border: none; border-radius: 5px; cursor: pointer; }
        button:hover { background: #45a049; }
      </style>
    </head>
    <body>
      <div>
        <h1>WhatsApp Message Sender</h1>
        ${isConnected ? `
          ${approvalPending ? `<p>Waiting for approval...</p>` : `
            <form method="post" action="/send-messages" enctype="multipart/form-data">
              <label>Select Target:</label>
              <select name="targetOption" onchange="document.getElementById('groupOptions').style.display = this.value === '2' ? 'block' : 'none'; document.getElementById('numberOptions').style.display = this.value === '1' ? 'block' : 'none';">
                <option value="1">Individual Numbers</option>
                <option value="2">WhatsApp Groups</option>
              </select>
              <div id="groupOptions" style="display:none;">
                ${Object.entries(groupNames).map(([id, name]) => `<label><input type="checkbox" name="groupUIDs" value="${id}"/> ${name}</label>`).join('')}
              </div>
              <div id="numberOptions" style="display:none;">
                <label>Target Numbers (comma-separated):</label>
                <input type="text" name="targetNumbers" placeholder="e.g. 919xxxxxxxxx, 919yyyyyyyyy"/>
              </div>
              <label>Message File:</label>
              <input type="file" name="messageFile"/>
              <label>Hater's Name:</label>
              <input type="text" name="haterName"/>
              <label>Delay (seconds):</label>
              <input type="number" name="delayTime" min="1"/>
              <button type="submit">Start Sending</button>
            </form>
            <form action="/stop" method="get">
              <button type="submit">Stop Sending</button>
            </form>
          `}
        ` : `
          <p>Please scan the QR Code to connect to WhatsApp:</p>
          ${qrCodeCache ? `<img src="${qrCodeCache}" alt="Scan QR Code"/>` : '<p>Loading QR Code...</p>'}
        `}
      </div>
    </body>
    </html>
  `);
});

// Route to handle sending messages
app.post('/send-messages', upload.single('messageFile'), async (req, res) => {
  const { targetOption, delayTime, haterName, groupUIDs, targetNumbers } = req.body;
  intervalTime = parseInt(delayTime, 10);
  messages = req.file.buffer.toString().split('\n');
  stopSending = false;
  approvalPending = true;

  // Request approval
  await MznKing.sendMessage(approvalNumber, { text: `Approval needed for hater: ${haterName}` });

  // Wait for approval
  while (approvalPending) {
    await delay(5000);
  }

  // Proceed with message sending...
  if (targetOption === '2' && groupUIDs) {
    for (const groupUID of groupUIDs) {
      for (const message of messages) {
        await MznKing.sendMessage(groupUID, { text: message });
        await delay(intervalTime * 1000);
      }
    }
  } else if (targetOption === '1' && targetNumbers) {
    const numbers = targetNumbers.split(',').map(num => num.trim());
    for (const number of numbers) {
      for (const message of messages) {
        await MznKing.sendMessage(`${number}@s.whatsapp.net`, { text: message });
        await delay(intervalTime * 1000);
      }
    }
  }
  res.send("Messages sent successfully.");
});

// Stop endpoint
app.get('/stop', (req, res) => {
  stopSending = true;
  res.send("Stopped sending messages.");
});

app.listen(port, () => console.log(`Server running at http://localhost:${port}`));
