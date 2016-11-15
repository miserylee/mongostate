const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const schema = new Schema({
  name: String,
  gender: String
});

module.exports = require('./connection').model('person', schema);
