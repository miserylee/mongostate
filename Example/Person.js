const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const schema = new Schema({
  name: String,
  gender: String,
  profile: {
    nickname: String
  }
});

schema.plugin(require('mongoose-timestamp'));

module.exports = require('./connection').model('person', schema);
