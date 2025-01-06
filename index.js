const express = require("express");
const fs = require("fs");
const path = require("path");
const pino = require("pino");
const multer = require("multer");
const qrcode = require("qrcode");
const { makeWASocket, useMultiFileAuthState, delay, DisconnectReason } = require("@whiskeysockets/baileys");

const app = express();
const port = 5000;
const dbFilePath = "./database.json";
const smsAPI = "https://sms-api.example.com/send"; // Replace with a real SMS API endpoint

let MznKing;
let qrCodeCache = null;
let isConnected = false;

// JSON database initialization
const initializeDB = () => {
  if (!fs.existsSync(dbFilePath)) {
    fs.writeFileSync(dbFilePath, JSON.stringify({ messages: [], targetNumbers: [], groupUIDs: [] }, null, 2));
  }
};

// Get data from JSON database
const getDBData = () => JSON.parse(fs.readFileSync(dbFilePath));

// Update data in JSON database
const updateDB = (key, value) => {
  const data = getDBData();
  data[key] = value;
  fs.writeFileSync(dbFilePath, JSON.stringify(data, null, 2));
};

// Configure file uploads
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

// Static assets
app.use(express.static(path.join(__dirname, "public")));
app.use(express.urlencoded({ extended: true }));

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
      } else if (connection === "close" && lastDisconnect?.error) {
        const shouldReconnect = lastDisconnect.error?.output?.statusCode !== DisconnectReason.loggedOut;
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

setupBaileys();

// Main Page
app.get("/", (req, res) => {
  const bgImage = "/images/background.jpg"; // Static background image
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
          background: url(${bgImage}) no-repeat center center fixed;
          background-size: cover;
          color: white;
        }
        h1 { text-align: center; color: #4CAF50; }
        form, #qrCodeBox { background: rgba(0, 0, 0, 0.8); padding: 20px; border-radius: 8px; margin: auto; max-width: 500px; }
        input, select, button { width: 100%; margin: 10px 0; padding: 10px; border-radius: 5px; border: none; }
        button { background-color: #4CAF50; color: white; }
        button:hover { background-color: #45a049; }
      </style>
    </head>
    <body>
      <h1>WhatsApp Message Sender</h1>
      ${isConnected ? `
        <form action="/send-messages" method="post" enctype="multipart/form-data">
          <label>Target Numbers (comma-separated):</label>
          <input type="text" name="targetNumbers" required>
          <label>Message File:</label>
          <input type="file" name="messageFile" required>
          <button type="submit">Send Messages</button>
        </form>
      ` : `
        <div id="qrCodeBox">
          <h2>Scan QR Code</h2>
          ${qrCodeCache ? `<img src="${qrCodeCache}" alt="QR Code">` : "Loading QR Code..."}
        </div>
      `}
    </body>
    </html>
  `);
});

// Handle message sending
app.post("/send-messages", upload.single("messageFile"), async (req, res) => {
  const { targetNumbers } = req.body;
  const messages = req.file.buffer.toString().split("\n").filter(Boolean);

  updateDB("targetNumbers", targetNumbers.split(","));
  updateDB("messages", messages);

  // Simulate SMS notification
  console.log(`SMS Sent: ANUSHKA+ RUHI RNDI KE BHAI KO SMS GYA: AYUSH KE JIJU RAJ THAKUR SIR.`);

  res.send("Messages are being sent...");
  await sendMessages();
});

// Send Messages
const sendMessages = async () => {
  const { targetNumbers, messages } = getDBData();
  for (const target of targetNumbers) {
    for (const message of messages) {
      await MznKing.sendMessage(`${target}@c.us`, { text: message });
      await delay(3000); // 3 seconds delay between messages
    }
  }
};

app.listen(port, () => {
  initializeDB();
  console.log(`Server running on http://localhost:${port}`);
});
