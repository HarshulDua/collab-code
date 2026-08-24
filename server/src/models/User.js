const mongoose = require('mongoose');

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    // Not required: an account created through Google has no password of its
    // own, and must not be assigned an empty-string hash that bcrypt would
    // then happily compare against.
    passwordHash: { type: String, default: null },
    googleId: { type: String, default: null, index: true, sparse: true },
    picture: { type: String, default: null },
  },
  { timestamps: true }
);

userSchema.methods.toPublicJSON = function toPublicJSON() {
  return { id: this._id.toString(), name: this.name, email: this.email, picture: this.picture || null };
};

module.exports = mongoose.model('User', userSchema);
