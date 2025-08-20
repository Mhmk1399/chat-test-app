import express from "express";
import { Server } from "socket.io";
import path from "path";
import { fileURLToPath } from "url";
import http from "http";
import minimist from "minimist";
import mongoose from "mongoose";
import dotenv from "dotenv";
import { socketAuth } from "./middleware/auth.js";

dotenv.config();

// Import models
import "./models/message.js";
import "./models/room.js";

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

// Import auth routes
import authRoutes from "./routes/auth.js";
app.use("/api/auth", authRoutes);

// API route to get all rooms that have messages
app.get("/api/rooms", async (req, res) => {
  try {
    const Message = mongoose.model("Message");
    const rooms = await Message.distinct("room").exec();
    res.json(rooms.filter((room) => room)); // Filter out null/undefined rooms
  } catch (error) {
    console.error("Error fetching rooms:", error);
    res.status(500).json({ error: "Failed to fetch rooms" });
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

// ✅ This is the actual HTTP server for both Express and Socket.IO
const server = http.createServer(app);

server.listen(PORT, HOST, () => {
  console.log(`Server running at http://${HOST}:${PORT}/`);
});

// --------- Users State ----------
const UsersState = {
  users: [],
  setUsers(newUsersArray) {
    this.users = newUsersArray;
  },
};

// ✅ FIX: use the `server` here instead of `expressServer`
const io = new Server(server, {
  cors: {
    origin:
      process.env.NODE_ENV === "production"
        ? ["https://chat-test-app-flame.vercel.app"]
        : ["http://localhost:3500", "http://127.0.0.1:3500"],
  },
});

// Apply JWT authentication middleware
io.use(socketAuth);

io.on("connection", (socket) => {
  console.log(`User ${socket.userName} (${socket.userId}) connected`);
  socket.emit("message", buildMsg(ADMIN, `Welcome ${socket.userName}! 🎉`));

  socket.on("enterRoom", async ({ room, guestName, userToken }) => {
    console.log("User entering room:", {
      room,
      guestName,
      userToken,
      socketId: socket.id,
      userName: socket.userName,
    });
    const prevRoom = getUser(socket.id)?.room;

    // Handle token-based room creation
    if (userToken) {
      try {
        const payload = JSON.parse(
          Buffer.from(userToken.split(".")[1], "base64").toString()
        );
        const tokenUserId = payload.userId || payload.id;
        const tokenUserName = payload.name || "User";

        // Override room and user info with token data
        room = `user_${tokenUserId}`;
        socket.userName = tokenUserName;
        socket.userId = tokenUserId;
        socket.isGuest = false;

        console.log("Token user:", {
          userId: tokenUserId,
          userName: tokenUserName,
          room,
        });
      } catch (error) {
        console.error("Invalid token:", error);
        socket.emit("error", "Invalid token");
        return;
      }
    }

    // Update guest name if provided
    if (socket.isGuest && guestName && !userToken) {
      socket.userName = guestName;
      console.log("Updated guest name to:", guestName);
    }

    if (prevRoom) {
      socket.leave(prevRoom);
      io.to(prevRoom).emit(
        "message",
        buildMsg(ADMIN, `${socket.userName} left the chat 👋`)
      );
    }

    const user = activateUser(
      socket.id,
      socket.userName,
      room,
      socket.userId,
      socket.userRole
    );
    console.log("User activated:", user);

    if (prevRoom) {
      io.to(prevRoom).emit("userList", {
        users: getUsersInRoom(prevRoom),
      });
    }

    socket.join(user.room);

    // Load chat history for token users
    if (userToken) {
      try {
        const Message = mongoose.model("Message");
        const messages = await Message.find({ room: user.room })
          .sort({ createdAt: 1 })
          .limit(100)
          .exec();

        // Send chat history to user
        messages.forEach((msg) => {
          socket.emit("message", {
            name: msg.name,
            text: msg.text,
            time: msg.time,
            room: msg.room,
          });
        });

        if (messages.length > 0) {
          socket.emit(
            "message",
            buildMsg(
              ADMIN,
              `Welcome back! Your chat history has been restored.`
            )
          );
        } else {
          socket.emit(
            "message",
            buildMsg(ADMIN, `Welcome to your personal chat!`)
          );
        }
      } catch (error) {
        console.error("Error loading chat history:", error);
        socket.emit("message", buildMsg(ADMIN, `You joined "${user.room}" 👋`));
      }
    } else {
      socket.emit("message", buildMsg(ADMIN, `You joined "${user.room}" 👋`));
    }
    socket.broadcast
      .to(user.room)
      .emit(
        "message",
        buildMsg(ADMIN, `${socket.userName} joined the chat 👋`)
      );

    io.to(user.room).emit("userList", {
      users: getUsersInRoom(user.room),
    });

    // Send room list to all connected clients including admin
    io.emit("roomList", {
      rooms: getAllActiveRooms(),
    });
  });

  socket.on("disconnect", () => {
    const user = getUser(socket.id);

    // Only handle disconnect for non-admin users
    if (user && socket.userName !== "Admin") {
      userLeavesApp(socket.id);

      io.to(user.room).emit(
        "message",
        buildMsg(ADMIN, `${socket.userName} left the chat 👋`)
      );

      io.to(user.room).emit("userList", {
        users: getUsersInRoom(user.room),
      });

      // Send updated room list to all clients
      io.emit("roomList", {
        rooms: getAllActiveRooms(),
      });
    } else if (socket.userName === "Admin") {
      // Admin disconnected - just remove from users list but don't announce
      userLeavesApp(socket.id);
    }

    console.log(`User ${socket.id} disconnected`);
  });

  socket.on("message", async ({ text }) => {
    const room = getUser(socket.id)?.room;
    if (room && text) {
      const messageData = buildMsg(socket.userName, text);
      messageData.room = room;
      messageData.userId = socket.userId;

      // Save to database
      try {
        const Message = mongoose.model("Message");
        await new Message(messageData).save();
        console.log("Message saved to DB:", messageData);
      } catch (error) {
        console.error("Error saving message:", error);
      }

      io.to(room).emit("message", messageData);
    }
  });

  socket.on("activity", () => {
    const room = getUser(socket.id)?.room;
    if (room) {
      socket.broadcast.to(room).emit("activity", socket.userName);
    }
  });

  socket.on("stopActivity", () => {
    const room = getUser(socket.id)?.room;
    if (room) {
      socket.broadcast.to(room).emit("stopActivity");
    }
  });

  // Admin silent room join (doesn't announce or affect user count)
  socket.on("adminJoinRoom", ({ room }) => {
    console.log("Admin silently joining room:", room);
    socket.join(room);
    // Don't add admin to users list or announce join
  });

  // Admin message handler
  socket.on("adminMessage", async ({ room, text }) => {
    console.log("Admin message received:", { room, text, socketId: socket.id });
    if (room && text) {
      const messageData = buildMsg("Admin", text);
      messageData.room = room;
      messageData.userId = "admin";

      // Save admin message to database
      try {
        const Message = mongoose.model("Message");
        await new Message(messageData).save();
        console.log("Admin message saved to DB:", messageData);
      } catch (error) {
        console.error("Error saving admin message:", error);
      }

      console.log("Emitting admin message to room:", room);
      io.to(room).emit("message", messageData);
    }
  });
});

// --------- Utility Functions ----------
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
  const user = { id, name, room, userId, role };
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

function getUsersInRoom(room) {
  return UsersState.users.filter((user) => user.room === room);
}

function getAllActiveRooms() {
  return Array.from(new Set(UsersState.users.map((user) => user.room)));
}
