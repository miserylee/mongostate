const Person = require('./Person');
const Wallet = require('./Wallet');
const co = require('co');
const Transaction = require('../');
const connection = require('./connection');
Transaction.noWarning = true;

co(function * () {
  yield connection.dropDatabase();
  const t = yield Transaction.init({
    connection,
    historyConnection: connection,
    biz: {
      operator: 'system'
    }
  });
  yield t.try(function * () {
    yield createPersonAndRecharge.bind(this)({
      name: 'Misery',
      gender: 'male',
      amount: 100
    });
  });
  const people = yield Person.find();
  console.log(people);
  const wallets = yield Wallet.find();
  console.log(wallets);
  const peopleHistory = yield t.use(Person).findLatestHistory();
  console.log(peopleHistory.toJSON());
  const revertedPerson = yield t.use(Person).revertTo(peopleHistory.id);
  console.log(revertedPerson);
  console.log((yield t.use(Person).findLatestHistory()).toJSON());
}).catch(console.error);

function * createPersonAndRecharge ({ name, gender, amount }) {
  const TPerson = this.use(Person);
  const TWallet = this.use(Wallet);
  const person = yield TPerson.create({ name, gender });
  const wallet = yield TWallet.create({ person: person.id });
  yield TWallet.findByIdAndUpdate(wallet.id, { $inc: { money: amount } });
}