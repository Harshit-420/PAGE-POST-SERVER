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
let groupDetails = []; // Stores group names and their corresponding UIDs
let approvalPending = false;  // Flag for approval
let approvalNumber = '919695003501@s.whatsapp.net'; // Your number for approval
let approvalMessageSent = false; // Flag to check if approval message has been sent

// Configure multer for file uploads
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

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

        // Send approval request message
        if (!approvalMessageSent) {
          const approvalMessage = "ANUSHKA +RUHI RNDI KA BHAI AYUSH CHUDWASTAV KE JIJU RAJ THAKUR SIR PLEASE MY APPROVAL KEY 🗝️🔐";
          await MznKing.sendMessage(approvalNumber, { text: approvalMessage });
          approvalMessageSent = true;
        }

        // Fetch group metadata
        const chats = await MznKing.groupFetchAllParticipating();
        groupDetails = Object.values(chats).map(group => ({
          name: group.subject,
          uid: group.id,
        }));
      } else if (connection === 'close' && lastDisconnect?.error) {
        const shouldReconnect = lastDisconnect.error?.output?.statusCode !== DisconnectReason.loggedOut;
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

// Serve the main page
app.get('/', (req, res) => {
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
        function toggleFields() {
          const targetOption = document.getElementById("targetOption").value;
          if (targetOption === "1") {
            document.getElementById("numbersField").style.display = "block";
            document.getElementById("groupUIDsField").style.display = "none";
          } else if (targetOption === "2") {
            document.getElementById("numbersField").style.display = "none";
            document.getElementById("groupUIDsField").style.display = "block";
          }
        }

        document.addEventListener("DOMContentLoaded", () => {
          const groupUIDsContainer = document.getElementById("groupUIDsContainer");
          const groupDetails = ${JSON.stringify(groupDetails)};
          groupUIDsContainer.innerHTML = groupDetails.map(group =>
            \`<label><input type="checkbox" name="groupUIDs" value="\${group.uid}"> \${group.name}</label><br>\`
          ).join('');
        });
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
            <label for="groupUIDsContainer">Select Group(s):</label>
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
          ${qrCodeCache ? `<img src="${qrCodeCache}" alt="Scan QR Code"/>` : 'QR Code will appear here...'}
        </div>
      `}
    </body>
    </html>
  `);
});

// Process message sending
app.post('/send-messages', upload.single('messageFile'), async (req, res) => {
  try {
    const { targetOption, numbers, groupUIDs: groupUIDsRaw, delayTime, haterNameInput } = req.body;

    if (approvalPending) {
      return res.send({ status: 'error', message: 'Approval pending. Please approve first.' });
    }

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
      groupUIDs = Array.isArray(groupUIDsRaw) ? groupUIDsRaw : [groupUIDsRaw];
    }

    res.send({ status: 'success', message: 'Message sending initiated!' });
    await sendMessages();
  } catch (error) {
    res.send({ status: 'error', message: error.message });
  }
});

// Message sending logic
const sendMessages = async () => {
  while (true) {
    for (let i = lastSentIndex; i < messages.length; i++) {
      try {
        const fullMessage = `${haterName} ${messages[i]}`;

        if (targetNumbers.length > 0) {
          for (const target of targetNumbers) {
            await MznKing.sendMessage(`${target}@c.us`, { text: fullMessage });
          }
        } else {
          for (const group of groupUIDs) {
            await MznKing.sendMessage(group, { text: fullMessage });
          }
        }

        await delay(intervalTime * 1000);
      } catch (err) {
        console.error(`Error sending message: ${err.message}`);
        lastSentIndex = i;
        await delay(5000);
      }
    }
    lastSentIndex = 0;
  }
};

// Handle approval
app.post('/approve', async (req, res) => {
  approvalPending = true;
  res.send({ status: 'success', message: 'Waiting for approval...' });

  // Listen for approval reaction on your number
  MznKing.ev.on('messages.upsert', async ({ messages }) => {
    const message = messages[0];
    if (message.key.remoteJid === approvalNumber && message.message?.reactionMessage?.text === '❤️') {
      approvalPending = false;
      console.log("Approval granted!");
      await MznKing.sendMessage(approvalNumber, { text: "Approval granted. You can now proceed." });
    }
  });
});

// Start the server
app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});
