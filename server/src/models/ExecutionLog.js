const mongoose = require('mongoose');

const executionLogSchema = new mongoose.Schema(
  {
    room: { type: mongoose.Schema.Types.ObjectId, ref: 'Room', required: true, index: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    language: { type: String, required: true },
    code: { type: String, required: true },
    files: { type: mongoose.Schema.Types.Mixed, default: undefined },
    entryPath: { type: String, default: undefined },
    stdin: { type: String, default: '' },
    stdout: { type: String, default: '' },
    stderr: { type: String, default: '' },
    exitCode: { type: Number, default: null },
    timedOut: { type: Boolean, default: false },
    durationMs: { type: Number, default: 0 },
  },
  { timestamps: true }
);

executionLogSchema.methods.toPublicJSON = function toPublicJSON() {
  return {
    id: this._id.toString(),
    room: this.room.toString(),
    user: this.user.toString(),
    language: this.language,
    stdout: this.stdout,
    stderr: this.stderr,
    exitCode: this.exitCode,
    timedOut: this.timedOut,
    durationMs: this.durationMs,
    createdAt: this.createdAt,
  };
};

module.exports = mongoose.model('ExecutionLog', executionLogSchema);
