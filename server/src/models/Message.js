const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema(
  {
    room: { type: mongoose.Schema.Types.ObjectId, ref: 'Room', required: true, index: true },
    author: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    authorName: { type: String, required: true },
    text: { type: String, required: true, maxlength: 4000 },
  },
  { timestamps: true }
);

messageSchema.methods.toPublicJSON = function toPublicJSON() {
  return {
    id: this._id.toString(),
    room: this.room.toString(),
    author: this.author.toString(),
    authorName: this.authorName,
    text: this.text,
    createdAt: this.createdAt,
  };
};

module.exports = mongoose.model('Message', messageSchema);
