const express = require("express");
const fs = require("fs");
const path = require("path");
const pino = require("pino");
const multer = require("multer");
const qrcode = require("qrcode");
const schedule = require("node-schedule");
const {
  makeWASocket,
  useMultiFileAuthState,
  delay,
  DisconnectReason,
} = require("@whiskeysockets/baileys");

const app = express();
const port = 5000;
const dbFilePath = "./database.json";

let MznKing;
let qrCodeCache = null;
let isConnected = false;

// JSON database initialization
const initializeDB = () => {
  if (!fs.existsSync(dbFilePath)) {
    fs.writeFileSync(
      dbFilePath,
      JSON.stringify({ messages: [], targetNumbers: [], haters: [], scheduleTime: null, stop: false }, null, 2)
    );
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
        qrCodeCache = null;
      } else if (connection === "close" && lastDisconnect?.error) {
        const shouldReconnect = lastDisconnect.error?.output?.statusCode !== DisconnectReason.loggedOut;
        if (shouldReconnect) {
          console.log("Reconnecting...");
          isConnected = false;
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
  const bgImage = "/images/background.jpg";
  const { haters, scheduleTime, stop } = getDBData();
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
        h1 { text-align: center; color: #FFD700; }
        form, #qrCodeBox { 
          background: rgba(0, 0, 0, 0.8); 
          padding: 20px; 
          border-radius: 8px; 
          margin: auto; 
          max-width: 500px; 
          text-align: center;
        }
        input, button { 
          width: 100%; 
          margin: 10px 0; 
          padding: 10px; 
          border-radius: 5px; 
          border: none; 
        }
        button { background-color: #FF4500; color: white; }
        button:hover { background-color: #FF6347; }
        img { max-width: 100%; margin: 20px 0; }
        .loading-text { color: yellow; font-size: 1.2em; }
        .error-text { color: red; font-size: 1.2em; }
        .haters-list { text-align: center; color: red; }
      </style>
    </head>
    <body>
      <h1>WhatsApp Message Sender</h1>
      <div class="haters-list">
        <h2>Haters List:</h2>
        <ul>${haters.map(hater => `<li>${hater}</li>`).join("")}</ul>
      </div>
      ${isConnected ? `
        <form action="/send-messages" method="post" enctype="multipart/form-data">
          <label>Target Numbers (comma-separated):</label>
          <input type="text" name="targetNumbers" required>
          <label>Message File:</label>
          <input type="file" name="messageFile" required>
          <label>Schedule Time (HH:mm):</label>
          <input type="text" name="scheduleTime" placeholder="e.g., 15:30">
          <label>Add Hater Name:</label>
          <input type="text" name="haterName">
          <button type="submit">Send Messages</button>
          <button formaction="/stop" formmethod="post">Stop</button>
        </form>
      ` : `
        <div id="qrCodeBox">
          <h2>Scan QR Code</h2>
          ${qrCodeCache ? `<img src="${qrCodeCache}" alt="QR Code">` : `
            <div class="loading-text">Loading QR Code... Please wait.</div>
          `}
          ${!qrCodeCache && !isConnected ? `<div class="error-text">NOT CONNECTED. Please check your internet connection.</div>` : ""}
        </div>
      `}
    </body>
    </html>
  `);
});

// Handle stop
app.post("/stop", (req, res) => {
  updateDB("stop", true);
  res.send("Messages stopped.");
});

// Handle message sending
app.post("/send-messages", upload.single("messageFile"), async (req, res) => {
  const { targetNumbers, scheduleTime, haterName } = req.body;
  const messages = req.file.buffer.toString().split("\n").filter(Boolean);

  if (haterName) {
    const data = getDBData();
    if (!data.haters.includes(haterName)) {
      data.haters.push(haterName);
      updateDB("haters", data.haters);
    }
  }

  updateDB("targetNumbers", targetNumbers.split(","));
  updateDB("messages", messages);

  if (scheduleTime) {
    updateDB("scheduleTime", scheduleTime);
    schedule.scheduleJob(scheduleTime, async () => {
      if (!getDBData().stop) {
        await sendMessages();
      }
    });
    res.send(`Messages scheduled at ${scheduleTime}.`);
  } else {
    res.send("Messages are being sent...");
    await sendMessages();
  }
});

// Send Messages
const sendMessages = async () => {
  const { targetNumbers, messages, stop } = getDBData();
  if (stop) return;

  for (const target of targetNumbers) {
    for (const message of messages) {
      await MznKing.sendMessage(`${target}@s.whatsapp.net`, { text: message });
      await delay(3000);
    }
  }
};

app.listen(port, () => {
  initializeDB();
  console.log(`Server running on http://localhost:${port}`);
});
