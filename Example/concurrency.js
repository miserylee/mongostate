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
      const t = yield Transaction.init({
        connection
      });

      yield t.try(function * () {
        const TPerson = this.use(Person);
        yield TPerson.findByIdAndUpdate(person.id, {
          $set: { 'profile.nickname': 'Luna' }
        });
      });
    }).catch(error => console.error(error.message));
  });

}).catch(console.error);

function * createAPerson () {
  const t = yield Transaction.init({
    connection
  });

  const p = yield t.try(function * () {
    const TPerson = this.use(Person);
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