const express = require('express');
const multer = require('multer');
const { makeWASocket, useMultiFileAuthState, delay } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode');
const pino = require('pino');
const fs = require('fs');

const app = express();
const port = 5000;

// File upload setup
const storage = multer.memoryStorage();
const upload = multer({ storage });

// WhatsApp state
let whatsappSock = null;
let qrCode = null;

// WhatsApp setup
const setupWhatsApp = async () => {
  const { state, saveCreds } = await useMultiFileAuthState('./auth_info');

  whatsappSock = makeWASocket({
    auth: state,
    logger: pino({ level: 'silent' }),
  });

  whatsappSock.ev.on('connection.update', (update) => {
    const { connection, qr } = update;
    if (qr) {
      qrcode.toDataURL(qr, (err, url) => {
        if (err) console.error(err);
        qrCode = url;
      });
    }
    if (connection === 'open') {
      console.log('WhatsApp connected successfully!');
    }
  });

  whatsappSock.ev.on('creds.update', saveCreds);
};

setupWhatsApp();

// Middleware
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Routes
app.get('/', (req, res) => {
  res.send(`
    <h1>WhatsApp Sender</h1>
    <p>Scan QR Code:</p>
    <img src="${qrCode}" alt="QR Code" />
  `);
});

app.post('/send-messages', upload.single('messageFile'), async (req, res) => {
  try {
    const { numbers, delayTime } = req.body;
    const messageFile = req.file;

    if (!numbers || !messageFile) {
      throw new Error('Numbers or message file missing');
    }

    const messageText = messageFile.buffer.toString('utf-8').split('\n');
    const numberList = numbers.split(',');

    for (const number of numberList) {
      for (const message of messageText) {
        await whatsappSock.sendMessage(`${number}@s.whatsapp.net`, { text: message });
        console.log(`Message sent to ${number}`);
        await delay(Number(delayTime) * 1000); // Delay between messages
      }
    }

    res.json({ status: 'success', message: 'Messages sent successfully!' });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// Start the server
app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});
