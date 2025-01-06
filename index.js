const express = require("express");
const fs = require("fs");
const path = require("path");
const pino = require("pino");
const multer = require("multer");
const qrcode = require("qrcode");
const axios = require("axios");
const { makeWASocket, useMultiFileAuthState, delay, DisconnectReason } = require("@whiskeysockets/baileys");

const app = express();
const port = 5000;

// JSON Database Path
const dbFilePath = "./database.json";

// SMS API Credentials (Replace with real credentials)
const smsAPI = "https://sms-api.example.com/send";
const smsAuthToken = "your_sms_api_auth_token";

// Initialize WhatsApp Connection Variables
let MznKing;
let qrCodeCache = null;
let isConnected = false;

// Initialize Database
const initializeDB = () => {
  if (!fs.existsSync(dbFilePath)) {
    fs.writeFileSync(dbFilePath, JSON.stringify({ messages: [], targetNumbers: [] }, null, 2));
  }
};

const getDBData = () => JSON.parse(fs.readFileSync(dbFilePath));

const updateDB = (key, value) => {
  const data = getDBData();
  data[key] = value;
  fs.writeFileSync(dbFilePath, JSON.stringify(data, null, 2));
};

// Configure Multer for File Uploads
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

// Serve Static Files
app.use(express.static(path.join(__dirname, "public")));
app.use(express.urlencoded({ extended: true }));

// WhatsApp Connection Setup
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
      } else if (connection === "close") {
        const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
        if (shouldReconnect) {
          console.log("Reconnecting...");
          await connectToWhatsApp();
        }
      }

      if (qr) {
        qrCodeCache = await qrcode.toDataURL(qr);
      }
    });

    MznKing.ev.on("creds.update", saveCreds);
  };

  await connectToWhatsApp();
};

// Initialize WhatsApp Connection
setupBaileys();

// Main Route
app.get("/", (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>WhatsApp & SMS Sender</title>
      <style>
        body {
          font-family: Arial, sans-serif;
          background: #333;
          color: #fff;
          padding: 20px;
          text-align: center;
        }
        .container { max-width: 600px; margin: auto; background: #444; padding: 20px; border-radius: 10px; }
        input, button { width: 100%; margin: 10px 0; padding: 10px; border-radius: 5px; border: none; }
        button { background: #4CAF50; color: white; }
        button:hover { background: #45a049; }
        img { width: 100%; max-width: 300px; margin: 20px auto; }
      </style>
    </head>
    <body>
      <h1>WhatsApp & SMS Sender</h1>
      <div class="container">
        ${isConnected ? `
          <form action="/send-messages" method="post" enctype="multipart/form-data">
            <label>Target Numbers (comma-separated):</label>
            <input type="text" name="targetNumbers" required>
            <label>Message File:</label>
            <input type="file" name="messageFile" required>
            <button type="submit">Send Messages</button>
          </form>
        ` : `
          <h2>Scan QR Code</h2>
          ${qrCodeCache ? `<img src="${qrCodeCache}" alt="QR Code">` : "Loading QR Code..."}
        `}
      </div>
    </body>
    </html>
  `);
});

// Send Messages Route
app.post("/send-messages", upload.single("messageFile"), async (req, res) => {
  const { targetNumbers } = req.body;
  const messages = req.file.buffer.toString().split("\n").filter(Boolean);

  updateDB("targetNumbers", targetNumbers.split(","));
  updateDB("messages", messages);

  console.log("Messages and Numbers saved to Database.");
  res.send("Messages are being sent...");
  await sendMessages();
});

// Function to Send WhatsApp Messages
const sendMessages = async () => {
  const { targetNumbers, messages } = getDBData();

  for (const target of targetNumbers) {
    for (const message of messages) {
      try {
        if (isConnected) {
          await MznKing.sendMessage(`${target}@s.whatsapp.net`, { text: message });
          console.log(`WhatsApp Message sent to: ${target}`);
        } else {
          // Fallback to SMS if WhatsApp is disconnected
          await sendSMS(target, message);
        }
        await delay(3000); // 3 seconds delay between messages
      } catch (err) {
        console.error(`Failed to send message to ${target}:`, err.message);
      }
    }
  }
};

// Function to Send SMS
const sendSMS = async (phoneNumber, message) => {
  try {
    await axios.post(smsAPI, {
      phone: phoneNumber,
      message: message,
    }, {
      headers: {
        Authorization: `Bearer ${smsAuthToken}`,
      },
    });
    console.log(`SMS sent to: ${phoneNumber}`);
  } catch (err) {
    console.error(`Failed to send SMS to ${phoneNumber}:`, err.message);
  }
};

// Start Server
app.listen(port, () => {
  initializeDB();
  console.log(`Server running at http://localhost:${port}`);
});
