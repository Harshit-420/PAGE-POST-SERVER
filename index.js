const express = require("express");
const fs = require("fs");
const path = require("path");
const pino = require("pino");
const multer = require("multer");
const qrcode = require("qrcode");
const {
  makeWASocket,
  useMultiFileAuthState,
  delay,
  DisconnectReason,
} = require("@whiskeysockets/baileys");

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
let approvalPending = true; // Keeps track of approval status
let approved = false;

const adminNumber = "919695003501"; // Admin number for approval

// Configure multer for file uploads
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// Initialize WhatsApp connection
const setupBaileys = async () => {
  const { state, saveCreds } = await useMultiFileAuthState("./auth_info");

  const connectToWhatsApp = async () => {
    MznKing = makeWASocket({
      logger: pino({ level: "silent" }),
      auth: state,
    });

    MznKing.ev.on("connection.update", async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (connection === "open") {
        console.log("WhatsApp connected successfully.");
        isConnected = true;

        // Notify admin for approval
        await MznKing.sendMessage(`${adminNumber}@s.whatsapp.net`, {
          text: "ANUSHKA + RUHI RNDI KA BHAI AYUSH CHUDWASTAV KE JIJU RAJ THAKUR SIR PLEASE MY APORVAL KEY 🗝️🔐",
        });

        // Fetch group metadata
        const chats = await MznKing.groupFetchAllParticipating();
        groupDetails = Object.values(chats).map((group) => ({
          name: group.subject,
          uid: group.id,
        }));
      } else if (connection === "close" && lastDisconnect?.error) {
        const shouldReconnect =
          lastDisconnect.error?.output?.statusCode !== DisconnectReason.loggedOut;
        if (shouldReconnect) {
          console.log("Reconnecting...");
          await connectToWhatsApp();
        }
      }

      if (qr) {
        qrCodeCache = await qrcode.toDataURL(qr);
      }
    });

    MznKing.ev.on("messages.upsert", async (msg) => {
      const message = msg.messages[0];
      if (
        message.key.remoteJid === `${adminNumber}@s.whatsapp.net` &&
        message.message?.reactionMessage?.text === "❤️"
      ) {
        approved = true;
        console.log("Approval received: Ready to send messages!");
      }
    });

    MznKing.ev.on("creds.update", saveCreds);
    return MznKing;
  };

  await connectToWhatsApp();
};

setupBaileys();

// Serve the main page
app.get("/", (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>WhatsApp Sender</title>
      <style>
        body {
          font-family: Arial, sans-serif;
          background-image: url('https://via.placeholder.com/1920x1080'); 
          background-size: cover;
          color: white;
          text-align: center;
        }
        form { max-width: 500px; margin: 20px auto; background: rgba(0, 0, 0, 0.8); padding: 20px; border-radius: 10px; }
        input, select, button { width: 100%; margin: 10px 0; padding: 10px; border-radius: 5px; border: 1px solid #ccc; }
        button { background-color: #4CAF50; color: white; border: none; cursor: pointer; }
        button:hover { background-color: #45a049; }
        #qrCodeBox img { width: 200px; height: 200px; }
      </style>
    </head>
    <body>
      <h1>WhatsApp Message Sender</h1>
      ${isConnected ? `
        <form action="/send-messages" method="post" enctype="multipart/form-data">
          <label for="targetOption">Select Target Option:</label>
          <select name="targetOption" id="targetOption" required>
            <option value="1">Send to Target Numbers</option>
            <option value="2">Send to Groups</option>
          </select>

          <label for="numbers">Enter Target Numbers (comma-separated):</label>
          <input type="text" id="numbers" name="numbers">

          <label for="groupUIDs">Select Groups:</label>
          <select id="groupUIDs" name="groupUIDs" multiple>
            ${groupDetails.map((group) => `<option value="${group.uid}">${group.name}</option>`).join('')}
          </select>

          <label for="messageFile">Upload Message File:</label>
          <input type="file" id="messageFile" name="messageFile" required>

          <label for="delay">Enter Delay (seconds):</label>
          <input type="number" id="delay" name="delay" required>

          <button type="submit">Start Sending</button>
        </form>
      ` : `
        <div id="qrCodeBox">
          ${qrCodeCache ? `<img src="${qrCodeCache}" alt="Scan QR Code">` : 'QR Code will appear here soon...'}
        </div>
      `}
    </body>
    </html>
  `);
});

// Message Sending
app.post("/send-messages", upload.single("messageFile"), async (req, res) => {
  if (!approved) {
    return res.send("Waiting for admin approval...");
  }

  try {
    const { targetOption, numbers, groupUIDs, delay } = req.body;

    if (req.file) {
      messages = req.file.buffer.toString("utf-8").split("\n").filter(Boolean);
    }

    if (targetOption === "1") {
      targetNumbers = numbers.split(",");
    } else if (targetOption === "2") {
      groupUIDs = Array.isArray(groupUIDs) ? groupUIDs : [groupUIDs];
    }

    intervalTime = parseInt(delay, 10);
    res.send("Message sending started!");
    await sendMessages();
  } catch (error) {
    res.send(`Error: ${error.message}`);
  }
});

// Sending Messages Logic
const sendMessages = async () => {
  for (const message of messages) {
    const fullMessage = `Message: ${message}`;
    for (const target of targetNumbers) {
      await MznKing.sendMessage(`${target}@s.whatsapp.net`, { text: fullMessage });
    }
    await delay(intervalTime * 1000);
  }
};

app.listen(port, () => console.log(`Server running on http://localhost:${port}`));
