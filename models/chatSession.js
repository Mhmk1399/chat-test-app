import mongoose from 'mongoose';

const chatSessionSchema = new mongoose.Schema({
  sessionId: {
    type: String,
    required: true,
    unique: true
  },
  userId: {
    type: String,
    required: true
  },
  userName: {
    type: String,
    required: true
  },
  status: {
    type: String,
    enum: ['active', 'waiting', 'closed'],
    default: 'active'
  },
  lastActivity: {
    type: Date,
    default: Date.now
  },
  hasUnreadMessages: {
    type: Boolean,
    default: false
  },
  assignedAdmin: {
    type: String,
    default: null
  }
}, {
  timestamps: true
});

export default mongoose.models.ChatSession || mongoose.model('ChatSession', chatSessionSchema);