const mongoose = require('mongoose');

const roomSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    members: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    language: { type: String, default: 'python', enum: ['python'] },
    ydocSnapshots: { type: Map, of: Buffer, default: () => new Map() },
    gitRemote: {
      url: { type: String, default: null },
      encryptedToken: { type: String, default: null },
    },
  },
  { timestamps: true }
);

roomSchema.methods.toPublicJSON = function toPublicJSON() {
  return {
    id: this._id.toString(),
    name: this.name,
    owner: this.owner.toString(),
    members: this.members.map((m) => m.toString()),
    language: this.language,
    gitRemoteUrl: this.gitRemote?.url || null,
    createdAt: this.createdAt,
  };
};

module.exports = mongoose.model('Room', roomSchema);
