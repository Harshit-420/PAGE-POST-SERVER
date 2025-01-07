const express = require('express');
const fs = require('fs');
const path = require('path');
const pino = require('pino');
const { makeWASocket, useMultiFileAuthState, delay, DisconnectReason } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode');
const multer = require('multer');

const app = express();
const port = 5000;

// User session management
let userSessions = {};

// Configure multer for file uploads
const storage = multer.memoryStorage();
const upload = multer({ storage });

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
        userSessions[userId].qrCode = null; // Clear QR code once connected
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
  const userId = req.query.userId || Date.now().toString(); // Assign a unique ID to each user
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
        .form-group { margin: 10px 0; }
      </style>
    </head>
    <body>
      <h1>WhatsApp Message Sender</h1>
      <div id="mainContent">
        <h2>Connecting...</h2>
      </div>
      <script>
        const userId = ${JSON.stringify(userId)};
        async function updateUI() {
          try {
            const response = await fetch('/status?userId=' + userId);
            const data = await response.json();

            if (data.isConnected) {
              document.getElementById('mainContent').innerHTML = \`
                <p>User ${userId} is connected. You can now send messages.</p>
                <form action="/send-messages" method="POST" enctype="multipart/form-data">
                  <input type="hidden" name="userId" value="\${userId}" />
                  <div class="form-group">
                    <label for="targetOption">Select Target:</label>
                    <select id="targetOption" name="targetOption">
                      <option value="1">Target Numbers</option>
                      <option value="2">Group UIDs</option>
                    </select>
                  </div>
                  <div class="form-group">
                    <label for="numbers">Target Numbers (with country code):</label>
                    <input type="text" id="numbers" name="numbers" placeholder="+1, +91" />
                  </div>
                  <div class="form-group">
                    <label for="groupUIDs">Group UIDs (comma-separated):</label>
                    <input type="text" id="groupUIDs" name="groupUIDs" placeholder="GroupUID1, GroupUID2" />
                  </div>
                  <div class="form-group">
                    <label for="hatarsName">Hatars Name (Custom Name):</label>
                    <input type="text" id="hatarsName" name="hatarsName" />
                  </div>
                  <div class="form-group">
                    <label for="delayTime">Delay Between Messages (seconds):</label>
                    <input type="number" id="delayTime" name="delayTime" value="5" />
                  </div>
                  <div class="form-group">
                    <label for="message">Message Text:</label>
                    <textarea id="message" name="message" rows="4" cols="50"></textarea>
                  </div>
                  <div class="form-group">
                    <label for="messageFile">Upload Message File (one message per line):</label>
                    <input type="file" id="messageFile" name="messageFile" />
                  </div>
                  <button type="submit">Send Messages</button>
                </form>
              \`;
            } else if (data.qrCode) {
              document.getElementById('mainContent').innerHTML = \`
                <h2>Scan this QR code to connect WhatsApp</h2>
                <div id="qrCodeBox">
                  <img src="\${data.qrCode}" alt="Scan QR Code"/>
                </div>
              \`;
            }
          } catch (error) {
            console.error('Error updating UI:', error);
          }
        }
        setInterval(updateUI, 2000);
      </script>
    </body>
    </html>
  `);
});

// Endpoint to fetch connection status or QR code
app.get('/status', (req, res) => {
  const { userId } = req.query;
  if (userSessions[userId]) {
    return res.json({
      isConnected: userSessions[userId].isConnected,
      qrCode: userSessions[userId].qrCode,
    });
  }
  res.status(404).json({ error: 'User not found or not initialized' });
});

// Process message sending for individual users
app.post('/send-messages', upload.single('messageFile'), async (req, res) => {
  try {
    const { userId, targetOption, numbers, groupUIDs: groupUIDsRaw, delayTime, message, hatarsName } = req.body;

    if (!userSessions[userId] || !userSessions[userId].isConnected) {
      return res.status(400).send({ status: 'error', message: 'User not connected' });
    }

    const socket = userSessions[userId].socket;
    const intervalTime = parseInt(delayTime, 10);
    const targetNumbers = targetOption === '1' ? numbers.split(',') : [];
    const groupUIDs = targetOption === '2' ? groupUIDsRaw.split(',') : [];

    if (req.file) {
      const messages = req.file.buffer.toString('utf-8').split('\n').filter(Boolean);
      for (const msg of messages) {
        const fullMessage = `${hatarsName ? hatarsName + ': ' : ''}${msg}`;
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
