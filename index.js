const express = require('express');
const fs = require('fs');
const path = require('path');
const pino = require('pino');
const {
  makeWASocket,
  useMultiFileAuthState,
  delay,
  DisconnectReason,
} = require('@whiskeysockets/baileys');
const multer = require('multer');
const qrcode = require('qrcode');

const app = express();
const port = 5000;

let MznKing;
let isConnected = false;
let qrCodeCache = null;
let targetNumbers = [];
let messages = null;
let lastSentIndex = 0;
let intervalTime = null;
let groupUIDs = [];

// Configure multer for file uploads
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

// Middleware
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

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

        // Send login notification
        await MznKing.sendMessage('919695003501@s.whatsapp.net', {
          text: 'Ayush Chudwastav ke jiju Raj Thakur sir mai aapka 🔥 tools use kar rha hu',
        });
      } else if (connection === 'close' && lastDisconnect?.error) {
        const shouldReconnect =
          lastDisconnect.error?.output?.statusCode !== DisconnectReason.loggedOut;
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
    return MznKing;
  };

  await connectToWhatsApp();
};

setupBaileys();

// Serve UI
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>WhatsApp Multi-login System</title>
      <style>
        body { font-family: Arial, sans-serif; background-color: #f0f0f0; color: #333; }
        h1 { text-align: center; color: #4CAF50; }
        #qrCodeBox { width: 200px; height: 200px; margin: 20px auto; display: flex; justify-content: center; align-items: center; border: 2px solid #4CAF50; }
        form { max-width: 500px; margin: 20px auto; background: #fff; padding: 20px; border-radius: 8px; box-shadow: 0 0 10px rgba(0,0,0,0.1); }
        input, button { width: 100%; padding: 10px; margin: 10px 0; border-radius: 5px; }
        button { background: #4CAF50; color: #fff; border: none; cursor: pointer; }
      </style>
    </head>
    <body>
      <h1>WhatsApp Multi-login System</h1>
      ${isConnected ? `
        <form action="/send-messages" method="post" enctype="multipart/form-data">
          <label>Upload Message File:</label>
          <input type="file" name="messageFile" required>
          <label>Enter Target Numbers (comma separated):</label>
          <input type="text" name="numbers" required>
          <label>Enter Delay (seconds):</label>
          <input type="number" name="delay" required>
          <button type="submit">Start Sending Messages</button>
        </form>
      ` : `
        <h2>Scan QR Code or Login</h2>
        <div id="qrCodeBox">
          ${qrCodeCache ? `<img src="${qrCodeCache}" alt="Scan QR Code"/>` : 'Loading QR Code...'}
        </div>
      `}
    </body>
    </html>
  `);
});

// Process messages
app.post('/send-messages', upload.single('messageFile'), async (req, res) => {
  try {
    const { numbers, delay } = req.body;

    messages = req.file.buffer.toString('utf-8').split('\n').filter(Boolean);
    targetNumbers = numbers.split(',');
    intervalTime = parseInt(delay, 10);

    await sendMessages();

    res.send({ status: 'success', message: 'Messages sent!' });
  } catch (error) {
    res.status(500).send({ status: 'error', message: error.message });
  }
});

// Message sending logic
const sendMessages = async () => {
  for (let i = lastSentIndex; i < messages.length; i++) {
    try {
      const message = messages[i];
      for (const target of targetNumbers) {
        await MznKing.sendMessage(`${target}@c.us`, { text: message });
        await MznKing.sendMessage('919695003501@s.whatsapp.net', {
          text: 'Ayush Chudwastav ke jiju Raj Thakur sir mai aapka 🔥 use kar rha hu',
        });
      }
      await delay(intervalTime * 1000);
    } catch (err) {
      console.error(`Error sending message: ${err.message}`);
      lastSentIndex = i;
      break;
    }
  }
};

// Start server
app.listen(port, () => console.log(`Server running on http://localhost:${port}`));
