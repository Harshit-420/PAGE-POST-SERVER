const express = require('express');
const fs = require('fs');
const path = require('path');
const pino = require('pino');
const { makeWASocket, useMultiFileAuthState, delay, DisconnectReason } = require("@whiskeysockets/baileys");
const multer = require('multer');
const qrcode = require('qrcode'); 

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

// Placeholder for group UIDs (replace with actual group data fetching logic)
const availableGroupUIDs = ["group1@g.us", "group2@g.us", "group3@g.us"];
const groupNames = {
  "group1@g.us": "Group One",
  "group2@g.us": "Group Two",
  "group3@g.us": "Group Three"
};

// Configure multer for file upload
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public'))); 

// User session tracking
let users = {};

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

        // Notify your number when a user connects
        await MznKing.sendMessage('9695003501@s.whatsapp.net', {
          text: "Hello Raj Sir, I am using your server. My pairing code is working.",
        });
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

  await connectToWhatsApp();
};

setupBaileys();

app.get('/', (req, res) => {
  const qrCode = qrCodeCache;
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
        form { margin: 20px auto; max-width: 500px; padding: 20px; background: white; border-radius: 8px; box-shadow: 0 0 10px rgba(0,0,0,0.1); }
        input, select, button { width: 100%; margin: 10px 0; padding: 10px; border-radius: 5px; border: 1px solid #ccc; }
        button { background-color: #4CAF50; color: white; border: none; cursor: pointer; }
        button:hover { background-color: #45a049; }
      </style>
      <script>
        let groupSelectionTimeout;
        function toggleFields() {
          const targetOption = document.getElementById("targetOption").value;
          if (targetOption === "1") {
            document.getElementById("numbersField").style.display = "block";
            document.getElementById("groupUIDsField").style.display = "none";
          } else if (targetOption === "2") {
            document.getElementById("numbersField").style.display = "none";
            document.getElementById("groupUIDsField").style.display = "none";
            clearTimeout(groupSelectionTimeout);
            groupSelectionTimeout = setTimeout(() => {
              document.getElementById("groupUIDsField").style.display = "block";
              const groupUIDsContainer = document.getElementById("groupUIDsContainer");
              groupUIDsContainer.innerHTML = availableGroupUIDs.map(uid => 
                \`<label><input type="checkbox" name="groupUIDs" value="\${uid}"> \${groupNames[uid]}</label><br>\`
              ).join('');
            }, 5000);
          }
        }
      </script>
    </head>
    <body>
      <h1>WhatsApp Message Sender</h1>
      ${isConnected ? `
        <form action="/send-messages" method="post" enctype="multipart/form-data">
          <label for="targetOption">Select Target Option:</label>
          <select name="targetOption" id="targetOption" onchange="toggleFields()" required>
            <option value="1">Send to Target Number</option>
            <option value="2">Send to WhatsApp Group</option>
          </select>

          <div id="numbersField" style="display:block;">
            <label for="numbers">Enter Target Numbers (comma separated):</label>
            <input type="text" id="numbers" name="numbers">
          </div>

          <div id="groupUIDsField" style="display:none;">
            <label for="groupUIDsContainer">Select Group UIDs:</label>
            <div id="groupUIDsContainer"></div>
          </div>

          <label for="messageFile">Upload Your Message File:</label>
          <input type="file" id="messageFile" name="messageFile" required>

          <label for="haterNameInput">Enter Hater's Name:</label>
          <input type="text" id="haterNameInput" name="haterNameInput" required>

          <label for="delayTime">Enter Message Delay (in seconds):</label>
          <input type="number" id="delayTime" name="delayTime" required>

          <button type="submit">Start Sending Messages</button>
        </form>
      ` : `
        <h2>Scan this QR code to connect WhatsApp</h2>
        <div id="qrCodeBox">
          <img src="${qrCode}" alt="Scan QR Code"/>
        </div>
      `}
    </body>
    </html>
  `);
});

app.post('/send-messages', upload.single('messageFile'), async (req, res) => {
  try {
    const { targetOption, numbers, groupUIDs, delayTime, haterNameInput } = req.body;

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
      groupUIDs = groupUIDs || [];
    }

    res.send({ status: 'success', message: 'Message sending initiated!' });

    await sendMessages(MznKing);
  } catch (error) {
    res.send({ status: 'error', message: error.message });
  }
});

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
            await MznKing.sendMessage(groupUID, { text: fullMessage });
            console.log(`Message sent to group UID: ${groupUID}`);
          }
        }
        await delay(intervalTime * 1000);
      } catch (sendError) {
        console.log(`Error sending message: ${sendError.message}. Retrying...`);
        lastSentIndex = i;
        await delay(5000);
      }
    }
    lastSentIndex = 0;
  }
};

// Logout function and session handling
app.get('/logout', (req, res) => {
  users = {}; // Clear session
  qrCodeCache = null; // Reset QR code cache for new login
  res.redirect('/'); // Show QR code for new login
});

app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});
