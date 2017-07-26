const Person = require('./Person');
const co = require('co');
const Transaction = require('../');
const connection = require('./connection');
const ObjectId = require('mongoose').Types.ObjectId;

co(function * () {
  yield connection.dropDatabase();
  const t = new Transaction({ connection });
  const result = yield t.try(function * () {
    const TPerson = t.use(Person);
    return yield TPerson.findOne({
      _id: { $ne: new ObjectId }
    });
  });
  console.log(result);
}).catch(console.error);