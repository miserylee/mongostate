const Person = require('./Person');
const co = require('co');
const Transaction = require('../');
const connection = require('./connection');
Transaction.noWarning = true;
const assert = require('assert');

co(function * () {
  yield connection.dropDatabase();
  const t = new Transaction({ connection });

  const person = yield t.try(function * () {
    const TPerson = this.use(Person);
    return yield TPerson.create({
      name: 'Misery',
      gender: 'male',
      profile: {
        nickname: 'Mis'
      }
    });
  });

  const actualCreatedAt = person.createdAt;
  console.log(actualCreatedAt);

  yield new Promise(resolve => setTimeout(resolve, 1000));

  const t2 = new Transaction({ connection });
  const updatedPerson = yield t2.try(function * () {
    const TPerson = this.use(Person);
    yield TPerson.findByIdAndUpdate(person._id, {
      $set: {
        name: 'Luna'
      }
    });
    yield new Promise(resolve => setTimeout(resolve, 10000));
    return Person.findById(person._id);
  });

  const newCreatedAt = updatedPerson.createdAt;
  console.log(newCreatedAt);
  assert(actualCreatedAt.getTime() ===  newCreatedAt.getTime());
}).catch(console.error);