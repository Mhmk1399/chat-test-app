import jwt from 'jsonwebtoken';

export const extractUserFromToken = (token) => {
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        return {
            userId: decoded.userId || decoded.id,
            name: decoded.name,
            role: decoded.role || 'user'
        };
    } catch (error) {
        return null;
    }
};

export const socketAuth = (socket, next) => {
    const token = socket.handshake.auth.token;
    
    if (token) {
        const user = extractUserFromToken(token);
        if (user) {
            socket.userId = user.userId;
            socket.userName = user.name;
            socket.userRole = user.role;
            socket.isGuest = false;
        } else {
            // Invalid token, treat as guest
            socket.userId = `guest_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            socket.userName = 'Guest';
            socket.userRole = 'guest';
            socket.isGuest = true;
        }
    } else {
        // No token, guest user
        socket.userId = `guest_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        socket.userName = 'Guest';
        socket.userRole = 'guest';
        socket.isGuest = true;
    }
    
    next();
};