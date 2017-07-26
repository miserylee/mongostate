const Person = require('./Person');
const co = require('co');
const Transaction = require('../');
const connection = require('./connection');
Transaction.noWarning = true;

co(function * () {
  yield connection.dropDatabase();

  const person = yield createAPerson();

  new Array(100).fill('').forEach(function () {
    co(function * () {
      const t = new Transaction({ connection });

      const TPerson = t.use(Person);
      yield t.try(function * () {
        yield TPerson.findByIdAndUpdate(person.id, {
          $set: { 'profile.nickname': 'Luna' }
        });
      });
    }).catch(error => console.error(error.message, error.type, error.wrongdoer, error.name));
  });

}).catch(console.error);

function * createAPerson () {
  const t = new Transaction({ connection });

  const TPerson = t.use(Person);
  const p = yield t.try(function * () {
    return yield TPerson.create({
      name: 'Misery',
      gender: 'male',
      profile: {
        nickname: 'Mis'
      }
    });
  });

  return yield Person.findById(p.id);
}