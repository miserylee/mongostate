const Person = require('./Person');
const Wallet = require('./Wallet');
const co = require('co');
const Transaction = require('../');
const connection = require('./connection');
const assert = require('assert');

(async _ => {
  await connection.dropDatabase();
  const person = await createAPerson();
  await updateNickname(person.id);
  await unsetPersonGender(person.id);
  await createAWalletAndRecharge(person.id);
  console.log('success!')
})();

async function createAPerson () {
  const t = new Transaction({ connection });
  const TPerson = t.use(Person);
  const p = await t.try(async _ => {
    return await TPerson.create({
      name: 'Misery',
      gender: 'male',
      profile: {
        nickname: 'Mis'
      }
    });
  });

  const person = await Person.findById(p.id);

  assert(person);
  assert(person.name === 'Misery');
  assert(person.gender === 'male');
  assert(person.profile.nickname === 'Mis');
  return person;
}

async function updateNickname (id) {
  const t = new Transaction({ connection });
  const TPerson = t.use(Person);
  await t.try(async _ => {
    await TPerson.findByIdAndUpdate(id, {
      $set: { 'profile.nickname': 'Luna' }
    });
  });

  const person = await Person.findById(id);
  assert(person);
  assert(person.name === 'Misery');
  assert(person.profile.nickname === 'Luna');
}

async function unsetPersonGender (id) {
  const t = new Transaction({ connection });
  const TPerson = t.use(Person);
  await t.try(async _ => {
    await TPerson.findByIdAndUpdate(id, {
      $unset: { gender: '' }
    });
  });

  const person = await Person.findById(id);
  assert(person);
  assert(person.name === 'Misery');
  assert(!person.gender);
}

async function createAWalletAndRecharge (personId) {
  const t = new Transaction({ connection });
  const TWallet = t.use(Wallet);
  const TPerson = t.use(Person);

  const w = await t.try(async _ => {
    const person = await TPerson.findById(personId);
    assert(person);

    const wallet = await TWallet.create({
      person: person.id
    });

    return await TWallet.findByIdAndUpdate(wallet.id, {
      $set: {
        money: 100
      }
    });
  });

  const wallet = await Wallet.findById(w.id);
  assert(wallet);
  assert(wallet.person.toString() === personId.toString());
  assert(wallet.money === 100);
}