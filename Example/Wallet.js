const mongoose = require('mongoose');
const Schema = mongoose.Schema;
const ObjectId = Schema.Types.ObjectId;

const schema = new Schema({
  person: { type: ObjectId, ref: 'person' },
  money: { type: Number, default: 0, min: 0 }
});

module.exports = require('./connection').model('wallet', schema);
