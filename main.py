const express = require('express');
const fs = require('fs');
const path = require('path');
const pino = require('pino');
const sqlite3 = require('sqlite3').verbose(); // Database for offline storage
const { makeWASocket, useMultiFileAuthState, delay, DisconnectReason } = require("@whiskeysockets/baileys");
const multer = require('multer');
const qrcode = require('qrcode'); // QR Code generation library

const app = express();
const port = 5000;

let MznKing;
let messages = null;
let targetNumbers = [];
let groupUIDs = [];
let intervalTime = null;
let haterName = null;
let lastSentIndex = 0;
let isConnected = false;
let qrCodeCache = null;

// Initialize SQLite database
const db = new sqlite3.Database('./whatsapp.db', (err) => {
  if (err) {
    console.error('Error opening database', err.message);
  } else {
    db.run(`
      CREATE TABLE IF NOT EXISTS sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT UNIQUE,
        session_data TEXT
      )
    `);
    console.log('Database initialized.');
  }
});

// Configure multer for file upload
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Function to save session data to SQLite
const saveSession = (userId, sessionData) => {
  db.run(
    `INSERT INTO sessions (user_id, session_data) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET session_data=?`,
    [userId, sessionData, sessionData],
    (err) => {
      if (err) console.error('Error saving session:', err.message);
    }
  );
};

// Function to load session data from SQLite
const loadSession = (userId, callback) => {
  db.get(`SELECT session_data FROM sessions WHERE user_id = ?`, [userId], (err, row) => {
    if (err) {
      console.error('Error loading session:', err.message);
    }
    callback(row ? row.session_data : null);
  });
};

// Setup WhatsApp connection
const setupBaileys = async () => {
  const { state, saveCreds } = await useMultiFileAuthState('./auth_info');

  const connectToWhatsApp = async () => {
    MznKing = makeWASocket({
      logger: pino({ level: 'silent' }),
      auth: state,
    });

    MznKing.ev.on('connection.update', async (s) => {
      const { connection, lastDisconnect, qr } = s;

      if (connection === 'open') {
        console.log('WhatsApp connected successfully.');
        isConnected = true;
        saveSession('default', JSON.stringify(state));
      }

      if (connection === 'close' && lastDisconnect?.error) {
        const shouldReconnect = lastDisconnect.error?.output?.statusCode !== DisconnectReason.loggedOut;
        if (shouldReconnect) {
          console.log('Reconnecting...');
          await connectToWhatsApp();
        } else {
          console.log('Connection closed. Restart the script.');
        }
      }

      if (qr) {
        // Generate QR code for display
        qrcode.toDataURL(qr, (err, qrCode) => {
          if (err) {
            console.error('Error generating QR code', err);
          } else {
            qrCodeCache = qrCode;
          }
        });
      }
    });

    MznKing.ev.on('creds.update', saveCreds);

    return MznKing;
  };

  // Load session from database and reconnect if available
  loadSession('default', async (sessionData) => {
    if (sessionData) {
      state.creds = JSON.parse(sessionData);
    }
    await connectToWhatsApp();
  });
};

setupBaileys();

// Main page to show login and form for sending messages
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Handle sending messages
app.post('/send-messages', upload.single('messageFile'), async (req, res) => {
  try {
    const { targetOption, numbers, groupUIDsInput, delayTime, haterNameInput } = req.body;

    haterName = haterNameInput;
    intervalTime = parseInt(delayTime, 10);

    if (req.file) {
      messages = req.file.buffer.toString('utf-8').split('\n').filter(Boolean);
    } else {
      throw new Error('No message file uploaded');
    }

    if (targetOption === "1") {
      targetNumbers = numbers.split(',');
    } else if (targetOption === "2") {
      groupUIDs = groupUIDsInput.split(',');
    }

    res.send({ status: 'success', message: 'Message sending initiated!' });

    await sendMessages();
  } catch (error) {
    res.send({ status: 'error', message: error.message });
  }
});

// Function to send messages
const sendMessages = async () => {
  while (true) {
    for (let i = lastSentIndex; i < messages.length; i++) {
      try {
        const fullMessage = `${haterName} ${messages[i]}`;

        if (targetNumbers.length > 0) {
          for (const targetNumber of targetNumbers) {
            await MznKing.sendMessage(targetNumber + '@c.us', { text: fullMessage });
            console.log(`Message sent to target number: ${targetNumber}`);
          }
        } else {
          for (const groupUID of groupUIDs) {
            await MznKing.sendMessage(groupUID + '@g.us', { text: fullMessage });
            console.log(`Message sent to group UID: ${groupUID}`);
          }
        }
        await delay(intervalTime * 1000);
      } catch (err) {
        console.error('Error sending message:', err.message);
        lastSentIndex = i;
        await delay(5000);
      }
    }
    lastSentIndex = 0;
  }
};

// Start the server
app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
