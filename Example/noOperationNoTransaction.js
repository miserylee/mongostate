const co = require('co');
const Transaction = require('../');
const connection = require('./connection');

co(function * () {
  yield connection.dropDatabase();
  const t = new Transaction({ connection });
  yield t.try(function * () {
    console.log('do nothing!');
  });
  console.log('There is no transaction in database!');
}).catch(console.error);