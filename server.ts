import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import mongoose from "mongoose";
import dotenv from "dotenv";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// MongoDB Setup
const MONGODB_URI = process.env.MONGODB_URI;

const isValidMongoUri = (uri: string | undefined): boolean => {
  if (!uri) return false;
  return uri.startsWith("mongodb://") || uri.startsWith("mongodb+srv://");
};

if (isValidMongoUri(MONGODB_URI)) {
  mongoose.connect(MONGODB_URI!)
    .then(() => console.log("Connected to MongoDB"))
    .catch(err => console.error("MongoDB connection error:", err));
} else {
  if (MONGODB_URI) {
    console.error("MongoDB connection error: Invalid scheme, expected connection string to start with 'mongodb://' or 'mongodb+srv://'. Please check your MONGODB_URI secret.");
  } else {
    console.warn("MONGODB_URI not found. Chat history will not be persisted. To enable persistence, add a valid MONGODB_URI to your secrets.");
  }
}

const chatSchema = new mongoose.Schema({
  userId: String,
  subject: String,
  messages: Array,
  timestamp: { type: Date, default: Date.now }
});

const ChatHistory = mongoose.model("ChatHistory", chatSchema);

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // API routes
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  app.post("/api/chat/save", async (req, res) => {
    try {
      const { userId, subject, messages } = req.body;
      if (!isValidMongoUri(MONGODB_URI)) return res.status(200).json({ status: "skipped" });
      
      await ChatHistory.findOneAndUpdate(
        { userId, subject },
        { messages, timestamp: new Date() },
        { upsert: true }
      );
      res.json({ status: "success" });
    } catch (error) {
      res.status(500).json({ error: "Failed to save chat" });
    }
  });

  app.get("/api/chat/history/:userId", async (req, res) => {
    try {
      if (!isValidMongoUri(MONGODB_URI)) return res.json([]);
      const history = await ChatHistory.find({ userId: req.params.userId }).sort({ timestamp: -1 });
      res.json(history);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch history" });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(__dirname, "dist")));
    app.get("*", (req, res) => {
      res.sendFile(path.join(__dirname, "dist", "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
