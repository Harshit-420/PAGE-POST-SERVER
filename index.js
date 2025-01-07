const express = require('express');
const fs = require('fs');
const path = require('path');
const pino = require('pino');
const multer = require('multer');
const qrcode = require('qrcode');
const {
  makeWASocket,
  useMultiFileAuthState,
  delay,
} = require('@whiskeysockets/baileys');

const app = express();
const port = 5000;

// Multer setup for file uploads
const storage = multer.memoryStorage();
const upload = multer({ storage });

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Multi-user session management
const sessions = {};

// Function to create a new session
const createSession = async (userId) => {
  const authDir = `./auth_info_${userId}`;
  const { state, saveCreds } = await useMultiFileAuthState(authDir);

  const session = makeWASocket({
    logger: pino({ level: 'silent' }),
    auth: state,
  });

  session.ev.on('creds.update', saveCreds);
  session.ev.on('connection.update', (update) => {
    const { connection, qr } = update;

    if (qr) {
      qrcode.toDataURL(qr, (err, qrCode) => {
        if (err) {
          console.error(`QR Code Error for ${userId}:`, err);
        } else {
          sessions[userId].qr = qrCode;
        }
      });
    }

    if (connection === 'open') {
      console.log(`${userId} connected.`);
      sessions[userId].isConnected = true;
    }
  });

  sessions[userId] = { session, isConnected: false, qr: null };
  return session;
};

// Route to connect user and display QR code
app.get('/connect/:userId', async (req, res) => {
  const { userId } = req.params;
  if (!sessions[userId]) await createSession(userId);

  setTimeout(() => {
    res.send(`
      <div>
        <h3>${sessions[userId].isConnected ? 'Connected!' : 'Scan QR Code Below:'}</h3>
        ${sessions[userId].qr ? `<img src="${sessions[userId].qr}" />` : 'Loading...'}
      </div>
    `);
  }, 5000); // Delay of 5 seconds
});

// Fetch group names and UIDs
const fetchGroups = async (session) => {
  const groups = await session.groupFetchAllParticipating();
  return Object.values(groups).map((group) => ({
    id: group.id,
    name: group.subject,
  }));
};

// Route to fetch groups for a user
app.get('/groups/:userId', async (req, res) => {
  const { userId } = req.params;
  if (!sessions[userId] || !sessions[userId].isConnected) {
    return res.status(400).send('User not connected.');
  }

  const groups = await fetchGroups(sessions[userId].session);
  res.json(groups);
});

// Send messages to groups or numbers
let isSending = true;

app.post('/send', upload.single('messageFile'), async (req, res) => {
  const { userId, targetOption, numbers, groupUIDs, delayTime, haterName } = req.body;

  if (!sessions[userId] || !sessions[userId].isConnected) {
    return res.status(400).send('User not connected.');
  }

  const session = sessions[userId].session;
  const delayMs = parseInt(delayTime, 10) * 1000;
  const messages = req.file ? req.file.buffer.toString('utf-8').split('\n').filter(Boolean) : [];
  const targetNumbers = targetOption === '1' ? numbers.split(',') : [];
  const targetGroups = targetOption === '2' ? groupUIDs.split(',') : [];

  isSending = true;

  try {
    for (const message of messages) {
      const fullMessage = `${haterName} ${message}`;

      if (targetNumbers.length > 0) {
        for (const number of targetNumbers) {
          if (!isSending) break;
          await session.sendMessage(`${number}@s.whatsapp.net`, { text: fullMessage });
          console.log(`Message sent to: ${number}`);
        }
      }

      if (targetGroups.length > 0) {
        for (const group of targetGroups) {
          if (!isSending) break;
          await session.sendMessage(group, { text: fullMessage });
          console.log(`Message sent to group: ${group}`);
        }
      }

      await delay(delayMs);
    }
    res.send('Messages sent successfully!');
  } catch (error) {
    console.error('Error sending messages:', error);
    res.status(500).send(error.message);
  }
});

// Stop message sending
app.post('/stop', (req, res) => {
  isSending = false;
  res.send('Message sending stopped.');
});

// Approval mechanism
app.post('/approve', (req, res) => {
  const { emoji } = req.body;

  if (emoji === '❤️') {
    res.send('Approved!');
  } else {
    res.send('Approval denied.');
  }
});

// Start the server
app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});
