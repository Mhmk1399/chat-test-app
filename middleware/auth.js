// Replace your middleware/auth.js with this:

import jwt from "jsonwebtoken";

export const socketAuth = (socket, next) => {
  const token = socket.handshake.auth.token;
  
  if (!token || token === "guest") {
    socket.userName = "Guest";
    socket.sessionId = socket.id;
    socket.userId = socket.id;
    socket.userRole = "guest";
    return next();
  }
  
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    const validRoles = ["admin", "user", "superadmin", "consultant", "guest"];
    const userRole = validRoles.includes(decoded.role) ? decoded.role : "user";
    
    socket.userName = decoded.name || "User";
    socket.sessionId = decoded.id || socket.id;
    socket.userId = decoded.id || socket.id;
    socket.userRole = userRole;
    next();
  } catch (err) {
    socket.userName = "Guest";
    socket.sessionId = socket.id;
    socket.userId = socket.id;
    socket.userRole = "guest";
    next();
  }
};