import mongoose from 'mongoose';

const messageSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true
  },
  text: {
    type: String,
    required: true
  },
  room: {
    type: String,
    required: true
  },
  userId: {
    type: String,
    required: true
  },
  time: {
    type: String,
    required: true
  }
}, {
  timestamps: true
});

export default mongoose.models.Message || mongoose.model('Message', messageSchema);