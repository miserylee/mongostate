const Person = require('./Person');
const Wallet = require('./Wallet');
const co = require('co');
const Transaction = require('../');
const connection = require('./connection');
Transaction.noWarning = true;
const assert = require('assert');

co(function * () {
  yield connection.dropDatabase();

  const person = yield createAPerson();

  yield updateNickname(person.id);

  yield unsetPersonGender(person.id);

  yield createAWalletAndRecharge(person.id);

  console.log('success!')
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

  const person = yield Person.findById(p.id);

  assert(person);
  assert(person.name === 'Misery');
  assert(person.gender === 'male');
  assert(person.profile.nickname === 'Mis');
  return person;
}

function * updateNickname (id) {
  const t = yield Transaction.init({ connection });
  yield t.try(function * () {
    const TPerson = this.use(Person);
    yield TPerson.findByIdAndUpdate(id, {
      $set: { 'profile.nickname': 'Luna' }
    });
  });

  const person = yield Person.findById(id);
  assert(person);
  assert(person.name === 'Misery');
  assert(person.profile.nickname === 'Luna');
}

function * unsetPersonGender (id) {
  const t = yield Transaction.init({ connection });
  yield t.try(function * () {
    const TPerson = this.use(Person);
    yield TPerson.findByIdAndUpdate(id, {
      $unset: { gender: '' }
    });
  });

  const person = yield Person.findById(id);
  assert(person);
  assert(person.name === 'Misery');
  assert(!person.gender);
}

function * createAWalletAndRecharge (personId) {
  const t = yield Transaction.init({ connection });
  const w = yield t.try(function * () {
    const TWallet = this.use(Wallet);
    const TPerson = this.use(Person);

    const person = yield TPerson.findById(personId);
    assert(person);

    const wallet = yield TWallet.create({
      person: person.id
    });

    return yield TWallet.findByIdAndUpdate(wallet.id, {
      $set: {
        money: 100
      }
    });
  });

  const wallet = yield Wallet.findById(w.id);
  assert(wallet);
  assert(wallet.person.toString() === personId.toString());
  assert(wallet.money === 100);
}