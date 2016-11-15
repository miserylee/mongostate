const Person = require('./Person');
const Wallet = require('./Wallet');
const co = require('co');
const Transaction = require('../');
const connection = require('./connection');

co(function * () {
  yield connection.dropDatabase();
  const t = yield Transaction.init({ connection });
  yield t.try(function * () {
    yield createPersonAndRecharge.bind(this)({
      name: 'Misery',
      gender: 'male',
      amount: 100
    })
  });
  const person = yield Person.find();
  const wallet = yield Wallet.find();
  console.log(person, wallet);
}).catch(console.error);

function * createPersonAndRecharge ({ name, gender, amount }) {
  const TPerson = this.use(Person);
  const TWallet = this.use(Wallet);
  const person = yield TPerson.create({ name, gender });
  const wallet = yield TWallet.create({ person: person.id });
  yield TWallet.findByIdAndUpdate(wallet.id, { $inc: { money: amount } });
}