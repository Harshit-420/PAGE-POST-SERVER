const express = require('express');
const fs = require('fs');
const path = require('path');
const pino = require('pino');
const { makeWASocket, useMultiFileAuthState, delay, DisconnectReason } = require("@whiskeysockets/baileys");
const multer = require('multer');
const qrcode = require('qrcode');  // Library to generate QR codes

const app = express();
const port = 5000;

let MznKing;
let messages = null;
let targetNumbers = [];
let groupUIDs = [];
let intervalTime = null;
let haterName = null;
let lastSentIndex = 0;
let isConnected = false;  // Track WhatsApp connection state
let qrCodeCache = null;

// Configure multer for file upload
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public'))); // Static folder for QR codes

// Multi-user management: Store user sessions and QR codes
const userSessions = {};

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
            // Cache QR code in memory for user
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

// Main page to show QR code and form for sending messages
app.get('/', (req, res) => {
  const qrCode = qrCodeCache; // Use cached QR code
  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>WhatsApp Message Sender</title>
      <style>
        /* Simple styling for QR Code box */
        #qrCodeBox {
          width: 200px;
          height: 200px;
          margin: 20px auto;
          display: flex;
          justify-content: center;
          align-items: center;
          border: 1px solid #ccc;
          background-color: #f9f9f9;
        }
        #qrCodeBox img {
          width: 100%;
          height: 100%;
        }

        /* Simple form styling */
        body {
          font-family: Arial, sans-serif;
        }

        form {
          margin-top: 20px;
        }

        input[type="text"], input[type="number"], select {
          width: 300px;
          padding: 10px;
          margin: 10px;
        }

        button {
          padding: 10px 20px;
          background-color: #4CAF50;
          color: white;
          border: none;
          cursor: pointer;
        }

        button:hover {
          background-color: #45a049;
        }
      </style>
      <script>
        function toggleFields() {
          const targetOption = document.getElementById("targetOption").value;
          if (targetOption === "1") {
            document.getElementById("numbersField").style.display = "block";
            document.getElementById("groupUIDsField").style.display = "none";
          } else if (targetOption === "2") {
            document.getElementById("groupUIDsField").style.display = "block";
            document.getElementById("numbersField").style.display = "none";
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
          <br>

          <div id="numbersField" style="display:block;">
            <label for="numbers">Enter Target Numbers (comma separated):</label>
            <input type="text" id="numbers" name="numbers">
            <br>
          </div>

          <div id="groupUIDsField" style="display:none;">
            <label for="groupUIDsInput">Enter Group UIDs (comma separated):</label>
            <input type="text" id="groupUIDsInput" name="groupUIDsInput">
            <br>
          </div>

          <label for="messageFile">Upload Your Message File:</label>
          <input type="file" id="messageFile" name="messageFile" required>
          <br>

          <label for="haterNameInput">Enter Hater's Name:</label>
          <input type="text" id="haterNameInput" name="haterNameInput" required>
          <br>

          <label for="delayTime">Enter Message Delay (in seconds):</label>
          <input type="number" id="delayTime" name="delayTime" required>
          <br>

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

// Handle sending messages after the form is submitted
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

    await sendMessages(MznKing);
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
        console.log(`Message: ${fullMessage}`);
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

// Start the server
app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});
