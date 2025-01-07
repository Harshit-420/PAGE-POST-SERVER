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
let isConnected = false;
let qrCodeCache = null;
let groupDetails = [];
let approvalPending = true;
let approved = false;

const adminNumber = "919695003501"; // Approval के लिए एडमिन नंबर

// Multer फाइल अपलोड कॉन्फिग
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// WhatsApp कनेक्शन सेटअप
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

        // एडमिन को अप्रूवल के लिए मैसेज
        await MznKing.sendMessage(`${adminNumber}@s.whatsapp.net`, {
          text: "Approval Request: Please approve to start sending messages.",
        });

        // ग्रुप की जानकारी प्राप्त करें
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

// मुख्य पेज
app.get("/", (req, res) => {
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
          background-color: #f2f2f2;
          text-align: center;
          color: #333;
        }
        form {
          max-width: 500px;
          margin: 20px auto;
          padding: 20px;
          background: #fff;
          border: 1px solid #ddd;
          border-radius: 5px;
          box-shadow: 0 0 10px rgba(0, 0, 0, 0.1);
        }
        input, select, button {
          width: 100%;
          margin: 10px 0;
          padding: 10px;
          border-radius: 5px;
          border: 1px solid #ccc;
        }
        button {
          background-color: #4CAF50;
          color: white;
          border: none;
          cursor: pointer;
        }
        button:hover {
          background-color: #45a049;
        }
        #qrCodeBox img {
          width: 200px;
          height: 200px;
        }
      </style>
    </head>
    <body>
      <h1>WhatsApp Message Sender</h1>
      ${isConnected ? `
        <form action="/send-messages" method="post" enctype="multipart/form-data">
          <label for="senderName">Enter Sender Name:</label>
          <input type="text" id="senderName" name="senderName" placeholder="Your Name" required>

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

// मैसेज भेजना
app.post("/send-messages", upload.single("messageFile"), async (req, res) => {
  if (!approved) {
    return res.send("Waiting for admin approval...");
  }

  try {
    const { targetOption, numbers, groupUIDs, delay, senderName } = req.body;

    if (req.file) {
      messages = req.file.buffer.toString("utf-8").split("\n").filter(Boolean);
    }

    if (targetOption === "1") {
      targetNumbers = numbers.split(",").map(num => num.trim());
    } else if (targetOption === "2") {
      groupUIDs = Array.isArray(groupUIDs) ? groupUIDs : [groupUIDs];
    }

    intervalTime = parseInt(delay, 10);
    res.send("Message sending started!");
    await sendMessages(senderName);
  } catch (error) {
    res.send(`Error: ${error.message}`);
  }
});

// मैसेज भेजने की लॉजिक
const sendMessages = async (senderName) => {
  for (const message of messages) {
    const fullMessage = `From ${senderName}:\n${message}`;

    if (targetNumbers.length > 0) {
      for (const target of targetNumbers) {
        await MznKing.sendMessage(`${target}@s.whatsapp.net`, { text: fullMessage });
      }
    }

    if (groupUIDs.length > 0) {
      for (const group of groupUIDs) {
        await MznKing.sendMessage(group, { text: fullMessage });
      }
    }

    await delay(intervalTime * 1000);
  }
};

// सर्वर शुरू करें
app.listen(port, () => console.log(`Server running on http://localhost:${port}`));
