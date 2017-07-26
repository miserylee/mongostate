const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const lockSchema = new Schema({
  transaction: { type: Schema.ObjectId, required: true, index: true },
  model: { type: String, required: true },
  entity: { type: String, required: true }
});

lockSchema.index({ model: 1, entity: 1 }, { unique: true });
lockSchema.index({ entity: 1, model: 1, transaction: 1 });

module.exports = lockSchema;