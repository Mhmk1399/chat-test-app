import express from 'express';
import jwt from 'jsonwebtoken';
import '../models/user.js';
import mongoose from 'mongoose';

const router = express.Router();

// Login endpoint
router.post('/login', async (req, res) => {
    try {
        const { phone, password } = req.body;
        
        const User = mongoose.model('User');
        const user = await User.findOne({ phone });
        if (!user || user.password !== password) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        
        const token = jwt.sign(
            { 
                userId: user._id,
                name: user.name,
                role: user.role
            },
            process.env.JWT_SECRET,
            { expiresIn: '24h' }
        );
        
        res.json({ token, user: { id: user._id, name: user.name, role: user.role } });
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
});

export default router;