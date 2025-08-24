import express from "express";
import { Server } from "socket.io";
import path from "path";
import { fileURLToPath } from "url";
import http from "http";
import minimist from "minimist";
import mongoose from "mongoose";
import dotenv from "dotenv";
import jwt from "jsonwebtoken";
import { socketAuth } from "./middleware/auth.js";

dotenv.config();

// Import models
import "./models/message.js";
import "./models/room.js";
import "./models/chatSession.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const argv = minimist(process.argv.slice(2));
const PORT = argv.p || process.env.PORT || 3500;
const HOST = argv.H || "0.0.0.0";
const ADMIN = "WhatsApp";

// Connect to MongoDB
if (process.env.MONGODB_URI) {
  mongoose
    .connect(process.env.MONGODB_URI)
    .then(() => console.log("Connected to MongoDB"))
    .catch((err) => console.error("MongoDB connection error:", err));
}

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// Add CORS middleware for API routes
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', process.env.NODE_ENV === 'production' 
    ? 'https://chat-test-app-flame.vercel.app' 
    : 'http://localhost:3000');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  if (req.method === 'OPTIONS') {
    res.sendStatus(200);
  } else {
    next();
  }
});

// Import auth routes
import authRoutes from "./routes/auth.js";
app.use("/api/auth", authRoutes);

// API route to get all rooms that have messages
app.get("/api/rooms", async (req, res) => {
  try {
    const Message = mongoose.model("Message");
    const rooms = await Message.distinct("room").exec();
    res.json(rooms.filter((room) => room));
  } catch (error) {
    console.error("Error fetching rooms:", error);
    res.status(500).json({ error: "Failed to fetch rooms" });
  }
});

// API route to get recent chat sessions (last 24 hours)
app.get("/api/chat-sessions/recent", async (req, res) => {
  try {
    const { limit = 5 } = req.query;
    const ChatSession = mongoose.model("ChatSession");
    const twentyFourHoursAgo = new Date();
    twentyFourHoursAgo.setHours(twentyFourHoursAgo.getHours() - 24);
    
    const sessions = await ChatSession.find({
      lastActivity: { $gte: twentyFourHoursAgo }
    })
    .sort({ lastActivity: -1 })
    .limit(parseInt(limit))
    .exec();
    
    res.json(sessions);
  } catch (error) {
    console.error("Error fetching recent chat sessions:", error);
    res.status(500).json({ error: "Failed to fetch recent chat sessions" });
  }
});

// API route to get chat session history with pagination
app.get("/api/chat-sessions/history", async (req, res) => {
  try {
    const { skip = 0, limit = 5 } = req.query;
    const ChatSession = mongoose.model("ChatSession");
    
    const sessions = await ChatSession.find({})
    .sort({ lastActivity: -1 })
    .skip(parseInt(skip))
    .limit(parseInt(limit))
    .exec();
    
    res.json(sessions);
  } catch (error) {
    console.error("Error fetching chat session history:", error);
    res.status(500).json({ error: "Failed to fetch chat session history" });
  }
});

// API route to get current user's message history
app.get("/api/messages/current", async (req, res) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) {
      return res.status(401).json({ error: "No token provided" });
    }
    
    const decoded = jwt.decode(token);
    if (!decoded || !decoded.sessionId) {
      return res.status(401).json({ error: "Invalid token" });
    }
    
    const Message = mongoose.model("Message");
    const messages = await Message.find({ room: decoded.sessionId })
      .sort({ createdAt: 1 })
      .limit(100)
      .exec();
    
    res.json(messages);
  } catch (error) {
    console.error("Error fetching current user messages:", error);
    res.status(500).json({ error: "Failed to fetch messages" });
  }
});

// API route to get room message history
app.get("/api/messages/:room", async (req, res) => {
  try {
    const { room } = req.params;
    const Message = mongoose.model("Message");
    const messages = await Message.find({ room })
      .sort({ createdAt: 1 })
      .limit(100)
      .exec();

    res.json(messages);
  } catch (error) {
    console.error("Error fetching messages:", error);
    res.status(500).json({ error: "Failed to fetch messages" });
  }
});

const server = http.createServer(app);

server.listen(PORT, HOST, () => {
  console.log(`Server running at http://${HOST}:${PORT}/`);
});

// Users State
const UsersState = {
  users: [],
  setUsers(newUsersArray) {
    this.users = newUsersArray;
  },
};

const io = new Server(server, {
  cors: {
    origin:
      process.env.NODE_ENV === "production"
        ? ["https://chat-test-app-flame.vercel.app"]
        : ["http://localhost:3000", "http://localhost:3500", "http://127.0.0.1:3000", "http://127.0.0.1:3500"],
  },
});

// Apply JWT authentication middleware
io.use(socketAuth);

io.on("connection", (socket) => {
  console.log(`User ${socket.userName} (${socket.sessionId}) connected`);
  
  // For authenticated users, always join their existing session
  if (socket.userRole !== "guest") {
    // Check for existing user with same session
    const existingUser = UsersState.users.find(user => user.userId === socket.userId);
    if (existingUser) {
      console.log(`Existing session found for ${socket.userName}, updating connection`);
      userLeavesApp(existingUser.id);
    }
    
    // Auto-join user to their session room
    const user = activateUser(socket.id, socket.userName, socket.sessionId, socket.userId, socket.userRole);
    socket.join(socket.sessionId);
    
    // Ensure chat session exists in database
    createChatSession(socket.sessionId, socket.userId, socket.userName, socket.userRole);
    
    // Send welcome message only if no previous messages exist
    checkAndSendWelcome(socket);
    
    // Notify admins of active user
    io.emit("roomList", { rooms: getAllActiveRooms() });
  }

  socket.on("disconnect", () => {
    const user = getUser(socket.id);
    if (user && socket.userName !== "Admin") {
      userLeavesApp(socket.id);
      
      // If guest user, remove from admin chat list immediately
      if (socket.userRole === "guest") {
        io.emit("removeGuestRoom", { room: socket.sessionId });
      } else {
        // For authenticated users, just update room list but keep session in DB
        io.emit("roomList", { rooms: getAllActiveRooms() });
      }
    } else if (socket.userName === "Admin") {
      userLeavesApp(socket.id);
    }
    console.log(`User ${socket.id} disconnected`);
  });

  socket.on("message", async ({ text }) => {
    const room = socket.sessionId;
    if (room && text) {
      // Check if user already exists in UsersState
      const existingUser = UsersState.users.find(user => user.id === socket.id);
      
      if (!existingUser) {
        // First message - create session for all user types
        if (socket.userRole === "guest") {
          const user = activateUser(socket.id, socket.userName, socket.sessionId, socket.userId, socket.userRole);
          socket.join(socket.sessionId);
        } else {
          // For authenticated users - should already be connected
          const user = activateUser(socket.id, socket.userName, socket.sessionId, socket.userId, socket.userRole);
          socket.join(socket.sessionId);
          createChatSession(socket.sessionId, socket.userId, socket.userName, socket.userRole);
        }
        
        // Notify admins of new user
        io.emit("roomList", { rooms: getAllActiveRooms() });
      }
      
      const messageData = buildMsg(socket.userName, text);
      messageData.room = room;
      messageData.userId = socket.userId;
      messageData.messageType = socket.userRole === 'admin' ? 'admin' : 'user';

      // Save to database
      try {
        const Message = mongoose.model("Message");
        await new Message(messageData).save();
        if (socket.userRole !== "guest") {
          updateSessionActivity(socket.sessionId);
        }
        console.log("Message saved to DB:", messageData);
      } catch (error) {
        console.error("Error saving message:", error);
      }

      io.to(room).emit("message", messageData);
      
      // Notify admins of new user message (including reactivated sessions)
      if (messageData.messageType === 'user') {
        socket.broadcast.emit("newUserMessage", {
          room: room,
          userName: socket.userName,
          preview: text.substring(0, 50),
          sessionId: socket.sessionId
        });
      }
      
      // Broadcast to all admins for real-time updates
      socket.broadcast.emit("adminMessageUpdate", messageData);
    }
  });

  socket.on("adminJoinRoom", ({ room }) => {
    console.log("Admin silently joining room:", room);
    socket.join(room);
  });

  socket.on("adminMessage", async ({ room, text }) => {
    if (room && text) {
      const messageData = buildMsg("Admin", text);
      messageData.room = room;
      messageData.userId = "admin";
      messageData.messageType = "admin";

      try {
        const Message = mongoose.model("Message");
        await new Message(messageData).save();
        console.log("Admin message saved to DB:", messageData);
      } catch (error) {
        console.error("Error saving admin message:", error);
      }

      io.to(room).emit("message", messageData);
      // Broadcast to all admins for real-time updates
      socket.broadcast.emit("adminMessageUpdate", messageData);
    }
  });
});

// Session cleanup - runs every 5 minutes
setInterval(() => {
  const inactiveTime = 30 * 60 * 1000; // 30 minutes
  UsersState.users = UsersState.users.filter(user => {
    return Date.now() - (user.lastActivity || Date.now()) < inactiveTime;
  });
  console.log(`Cleaned up inactive sessions. Active users: ${UsersState.users.length}`);
}, 5 * 60 * 1000);

// Database cleanup - runs daily - 30 days for ALL chats
setInterval(async () => {
  try {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    
    const Message = mongoose.model("Message");
    const ChatSession = mongoose.model("ChatSession");
    
    // Delete ALL messages older than 30 days (regardless of role)
    const deletedMessages = await Message.deleteMany({
      createdAt: { $lt: thirtyDaysAgo }
    });
    
    // Delete ALL chat sessions older than 30 days
    const deletedSessions = await ChatSession.deleteMany({
      createdAt: { $lt: thirtyDaysAgo }
    });
    
    console.log(`Database cleanup completed: ${deletedMessages.deletedCount} messages, ${deletedSessions.deletedCount} sessions deleted`);
  } catch (error) {
    console.error("Database cleanup error:", error);
  }
}, 24 * 60 * 60 * 1000); // Run every 24 hours

// Utility Functions
function buildMsg(name, text) {
  return {
    name,
    text,
    time: new Intl.DateTimeFormat("default", {
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
    }).format(new Date()),
  };
}

function activateUser(id, name, room, userId, role = "user") {
  const user = { id, name, room, userId, role, lastActivity: Date.now() };
  UsersState.setUsers([
    ...UsersState.users.filter((user) => user.id !== id),
    user,
  ]);
  return user;
}

function userLeavesApp(id) {
  UsersState.setUsers(UsersState.users.filter((user) => user.id !== id));
}

function getUser(id) {
  return UsersState.users.find((user) => user.id === id);
}

function getAllActiveRooms() {
  return Array.from(new Set(UsersState.users.map((user) => user.room)));
}

async function createChatSession(sessionId, userId, userName, userRole) {
  try {
    // Skip database storage for guest users
    if (userRole === "guest") {
      return;
    }
    
    const ChatSession = mongoose.model("ChatSession");
    await ChatSession.findOneAndUpdate(
      { sessionId },
      {
        sessionId,
        userId,
        userName,
        status: 'active',
        lastActivity: new Date(),
        hasUnreadMessages: false
      },
      { upsert: true, new: true }
    );
  } catch (error) {
    console.error("Error creating chat session:", error);
  }
}

async function updateSessionActivity(sessionId) {
  try {
    const ChatSession = mongoose.model("ChatSession");
    await ChatSession.findOneAndUpdate(
      { sessionId },
      { lastActivity: new Date(), hasUnreadMessages: true }
    );
  } catch (error) {
    console.error("Error updating session activity:", error);
  }
}

async function checkAndSendWelcome(socket) {
  try {
    const Message = mongoose.model("Message");
    const existingMessages = await Message.find({ room: socket.sessionId }).limit(1);
    
    // Only send welcome if no messages exist
    if (existingMessages.length === 0) {
      socket.emit("message", buildMsg(ADMIN, `Welcome! How can we help you today?`));
    }
  } catch (error) {
    console.error("Error checking existing messages:", error);
    // Send welcome anyway if there's an error
    socket.emit("message", buildMsg(ADMIN, `Welcome! How can we help you today?`));
  }
}