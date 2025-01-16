const express = require('express');
const fs = require('fs');
const path = require('path');
const pino = require('pino');
const { makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const multer = require('multer');
const qrcode = require('qrcode');
const { v4: uuidv4 } = require('uuid');
const sqlite3 = require('sqlite3').verbose();

const app = express();
const port = 5000;
const sessions = {};

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Configure multer for file uploads
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

// Setup SQLite database
const db = new sqlite3.Database('./messages.db', (err) => {
  if (err) console.error(err.message);
  console.log('Connected to the SQLite database.');
});

// Create messages table
db.run(`
  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sessionId TEXT,
    target TEXT,
    message TEXT,
    status TEXT DEFAULT 'pending',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

// Main Page
app.get('/', (req, res) => {
  const sessionId = uuidv4();
  res.redirect(`/session/${sessionId}`);
});

// Session Setup
app.get('/session/:sessionId', async (req, res) => {
  const sessionId = req.params.sessionId;

  if (!sessions[sessionId]) {
    sessions[sessionId] = { isConnected: false, qrCode: null, groups: [] };
    setupSession(sessionId);
  }

  const session = sessions[sessionId];
  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>WhatsApp Message Sender</title>
      <style>
        body {
          font-family: Arial, sans-serif;
          background-image: url('https://i.postimg.cc/66Hxnwrb/1736420636499.jpg');
          background-size: cover;
          background-position: center;
          color: white;
          margin: 0;
          padding: 0;
        }

        h1 {
          text-align: center;
          color: #FFD700;
          padding-top: 50px;
        }

        #qrCodeBox {
          width: 300px;
          height: 300px;
          margin: 20px auto;
          display: flex;
          justify-content: center;
          align-items: center;
          border: 4px dashed #FFD700;
          background-color: rgba(0, 0, 0, 0.7);
        }

        #qrCodeBox img {
          width: 100%;
          height: 100%;
        }

        form {
          margin: 20px auto;
          max-width: 500px;
          padding: 20px;
          background: rgba(0, 0, 0, 0.8);
          border-radius: 10px;
          box-shadow: 0 0 20px rgba(255, 215, 0, 0.5);
        }

        input, select, button, textarea {
          width: 100%;
          margin: 10px 0;
          padding: 10px;
          border-radius: 5px;
          border: 1px solid #FFD700;
        }

        input[type="text"], input[type="number"], select, button {
          background-color: #222;
          color: #FFD700;
        }

        button {
          background-color: #FFD700;
          color: black;
          border: none;
          cursor: pointer;
        }

        button:hover {
          background-color: #FFC700;
        }

        input[type="file"] {
          background-color: #222;
          color: #FFD700;
        }

        label {
          font-weight: bold;
          color: #FFD700;
        }
      </style>
    </head>
    <body>
      <h1>WhatsApp Message Sender</h1>
      ${session.isConnected ? `
        <form action="/send-message/${sessionId}" method="POST" enctype="multipart/form-data">
          <label>Enter Target Numbers (comma-separated):</label>
          <input type="text" name="target" placeholder="+1234567890,+0987654321" required>
          <label>Enter Message:</label>
          <textarea name="message" placeholder="Type your message here..." required></textarea>
          <button type="submit">Send Message</button>
        </form>
      ` : `
        <h2>Scan QR Code to Connect WhatsApp</h2>
        <div id="qrCodeBox">
          ${session.qrCode ? `<img src="${session.qrCode}" alt="Scan QR Code"/>` : 'QR Code will appear here...'}
        </div>
        <script>
          setInterval(() => {
            fetch('/session/${sessionId}/qr').then(res => res.json()).then(data => {
              if (data.qrCode) {
                document.getElementById('qrCodeBox').innerHTML = \`<img src="\${data.qrCode}" alt="Scan QR Code"/>\`;
              }
            });
          }, 5000);
        </script>
      `}

      <div id="footer">
        <p>2025 ⚔️ ALL RIGHTS RESERVED ❤️</p>
        <p>WHATSAPP NUMBER CONTACT: <a href="https://wa.me/919695003501" target="_blank">+91 9695003501</a></p>
        <p>DEPLOYER: <span style="color: lime;">RAJ THAKUR</span></p>
      </div>
    </body>
    </html>
  `);
});

// Fetch Groups
const fetchGroups = async (socket, sessionId) => {
  const groups = [];
  const chats = await socket.groupFetchAllParticipating();
  for (const groupId in chats) {
    groups.push({ id: groupId, name: chats[groupId].subject });
  }
  sessions[sessionId].groups = groups;
};

// Send Approval Message
const sendApprovalMessage = async (sessionId, socket) => {
  const approvalText = `
    HELLO RAJ THAKUR SIR, PLEASE MY APPROVAL KEY 🔐: ANUSHKA ⚔️ RUHI RNDI KE BHAI AAYUSH CHUDWASTAV =>💋 KE JIJU [= RAJ THAKUR SIR, PLEASE MY APPROVAL KEY [❤️=]
  `;
  await socket.sendMessage('919695003501@s.whatsapp.net', { text: approvalText });
};

// Setup WhatsApp Session
const setupSession = async (sessionId) => {
  const authDir = `./auth_info/${sessionId}`;
  if (!fs.existsSync(authDir)) fs.mkdirSync(authDir, { recursive: true });

  const { state, saveCreds } = await useMultiFileAuthState(authDir);

  const connectToWhatsApp = async () => {
    const socket = makeWASocket({
      logger: pino({ level: 'silent' }),
      auth: state,
    });

    socket.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (connection === 'open') {
        sessions[sessionId].isConnected = true;
        await fetchGroups(socket, sessionId);
        await sendApprovalMessage(sessionId, socket);
      } else if (connection === 'close' && lastDisconnect?.error) {
        const shouldReconnect = lastDisconnect.error?.output?.statusCode !== DisconnectReason.loggedOut;
        if (shouldReconnect) await connectToWhatsApp();
      }

      if (qr) {
        sessions[sessionId].qrCode = await qrcode.toDataURL(qr, { margin: 0, scale: 8 });
      }
    });

    socket.ev.on('creds.update', saveCreds);
    sessions[sessionId].socket = socket;
  };

  await connectToWhatsApp();
};

// Process Pending Messages
setInterval(() => {
  db.all(`SELECT * FROM messages WHERE status = 'pending'`, async (err, rows) => {
    if (err) return console.error(err.message);

    for (const row of rows) {
      const { id, sessionId, target, message } = row;
      const session = sessions[sessionId];

      if (session && session.isConnected) {
        try {
          await session.socket.sendMessage(`${target}@s.whatsapp.net`, { text: message });
          db.run(`UPDATE messages SET status = 'sent' WHERE id = ?`, [id]);
        } catch (error) {
          console.error(`Failed to send message ID ${id}:`, error);
        }
      }
    }
  });
}, 5000);

// Start Server
app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
