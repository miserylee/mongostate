const mongoose = require('mongoose');
const Schema = mongoose.Schema;
const { states, operations } = require('../constants');

const transactionSchema = new Schema({
  state: {
    type: String,
    enums: [states.PENDING, states.COMMITTED, states.ROLLBACK, states.CANCELLED, states.FINISHED],
    default: states.PENDING,
    required: true,
    index: true
  },
  usedModelNames: [String],
  actions: [{
    operation: {
      type: String, required: true, enums: [
        operations.CREATE,
        operations.UPDATE,
        operations.REMOVE
      ]
    },
    model: { type: String, required: true },
    entity: { type: String, required: true }
  }],
  error: {
    message: String,
    stack: String
  },
  biz: {}
});

module.exports = transactionSchema;