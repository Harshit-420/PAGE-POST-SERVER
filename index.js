const express = require('express');
const fs = require('fs');
const path = require('path');
const pino = require('pino');
const { makeWASocket, useMultiFileAuthState, delay, DisconnectReason } = require("@whiskeysockets/baileys");
const qrcode = require('qrcode');
const multer = require('multer');

const app = express();
const port = 5000;

// User session management
let userSessions = {}; // Object to maintain individual user sessions

// Configure multer for file uploads
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Initialize a WhatsApp connection for each user
const setupBaileysForUser = async (userId) => {
  const { state, saveCreds } = await useMultiFileAuthState(`./auth_info_${userId}`);
  
  const connectToWhatsApp = async () => {
    const socket = makeWASocket({
      logger: pino({ level: 'silent' }),
      auth: state,
    });

    socket.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (connection === 'open') {
        console.log(`User ${userId} connected successfully.`);
        userSessions[userId].isConnected = true;
      } else if (connection === 'close' && lastDisconnect?.error) {
        const shouldReconnect = lastDisconnect.error?.output?.statusCode !== DisconnectReason.loggedOut;
        if (shouldReconnect) {
          console.log(`Reconnecting for user ${userId}...`);
          await connectToWhatsApp();
        }
      }

      if (qr) {
        userSessions[userId].qrCode = await qrcode.toDataURL(qr);
      }
    });

    socket.ev.on('creds.update', saveCreds);
    userSessions[userId].socket = socket;
  };

  await connectToWhatsApp();
};

// Serve the main page
app.get('/', (req, res) => {
  const userId = req.query.userId || Date.now(); // Assign a unique ID to each user
  if (!userSessions[userId]) {
    userSessions[userId] = { isConnected: false, qrCode: null };
    setupBaileysForUser(userId);
  }

  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>WhatsApp Message Sender</title>
      <style>
        body { font-family: Arial, sans-serif; background-color: #f0f0f0; color: #333; }
        h1 { text-align: center; color: #4CAF50; }
        #qrCodeBox { width: 200px; height: 200px; margin: 20px auto; display: flex; justify-content: center; align-items: center; border: 2px solid #4CAF50; }
        #qrCodeBox img { width: 100%; height: 100%; }
      </style>
    </head>
    <body>
      <h1>WhatsApp Message Sender</h1>
      ${userSessions[userId].isConnected ? `
        <p>User ${userId} is connected. You can now send messages.</p>
      ` : `
        <h2>Scan this QR code to connect WhatsApp</h2>
        <div id="qrCodeBox">
          <p id="qrPlaceholder">Waiting for QR Code...</p>
          <img id="qrCodeImage" style="display:none;" alt="Scan QR Code"/>
        </div>
        <script>
          const userId = ${JSON.stringify(userId)};
          async function fetchQRCode() {
            try {
              const response = await fetch('/qr-code?userId=' + userId);
              const data = await response.json();
              if (data.qrCode) {
                document.getElementById('qrPlaceholder').style.display = 'none';
                const qrCodeImage = document.getElementById('qrCodeImage');
                qrCodeImage.src = data.qrCode;
                qrCodeImage.style.display = 'block';
              }
            } catch (error) {
              console.error('Error fetching QR code:', error);
            }
          }
          setInterval(fetchQRCode, 5000); // Fetch QR code every 5 seconds
        </script>
      `}
    </body>
    </html>
  `);
});

// Endpoint to fetch QR code
app.get('/qr-code', (req, res) => {
  const { userId } = req.query;
  if (userSessions[userId]) {
    return res.json({ qrCode: userSessions[userId].qrCode || null });
  }
  res.status(404).json({ error: 'User not found or not initialized' });
});

// Process message sending for individual users
app.post('/send-messages', upload.single('messageFile'), async (req, res) => {
  try {
    const { userId, targetOption, numbers, groupUIDs: groupUIDsRaw, delayTime, message } = req.body;

    if (!userSessions[userId] || !userSessions[userId].isConnected) {
      return res.status(400).send({ status: 'error', message: 'User not connected' });
    }

    const socket = userSessions[userId].socket;
    const intervalTime = parseInt(delayTime, 10);
    const targetNumbers = targetOption === "1" ? numbers.split(',') : [];
    const groupUIDs = targetOption === "2" ? (Array.isArray(groupUIDsRaw) ? groupUIDsRaw : [groupUIDsRaw]) : [];

    if (req.file) {
      const messages = req.file.buffer.toString('utf-8').split('\n').filter(Boolean);
      for (const msg of messages) {
        const fullMessage = `${message} ${msg}`;
        if (targetNumbers.length > 0) {
          for (const target of targetNumbers) {
            await socket.sendMessage(`${target}@s.whatsapp.net`, { text: fullMessage });
          }
        } else {
          for (const group of groupUIDs) {
            await socket.sendMessage(group, { text: fullMessage });
          }
        }
        await delay(intervalTime * 1000);
      }
    }

    res.send({ status: 'success', message: 'Messages sent successfully!' });
  } catch (error) {
    res.status(500).send({ status: 'error', message: error.message });
  }
});

// Start the server
app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});
