## mongostate ![NPM version](https://img.shields.io/npm/v/mongostate.svg?style=flat)

Data state machine. Support transaction in mongoose.

[中文文档](https://github.com/miserylee/mongostate/blob/master/README_zh.md)

### Installation
```bash
$ npm install mongostate --save
```

### Example
```js
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
```

### API

`init` the transaction with mongoose `connection` and other options params like:
* `transactionCollectionName`  `default: 'transaction'`, where to save the transaction data.
* `lockCollectionName`  `default: 'lock'`, where to save the lock data.
* `id`  If `id` is passed, the transaction will init by the certain id and if there is a transaction with the same id in the collection, it will be used the continue.
* `historyConnection` If `historyConnection` is passed, you can use `this.use(Person, true)` to enable Person model to record histories.

Make all unsafe operations in `try` method, and they will be automatic rollback when some error thrown in the closure.

These methods can be used as mongoose methods.

* `* create`
* `* findByIdAndUpdate`
* `* findOneAndUpdate`
* `* findByIdAndRemove`
* `* findOneAndRemove`
* `* findOne`
* `* findById`

These methods are for history supporting. Check example for detail usage.

* `* findHistories`
* `* findLatestHistory`
* `* revertTo`

These static methods are for more advanced usage.

* `getTransactionModel`
* `getLockModel`

### Contributing
- Fork this Repo first
- Clone your Repo
- Install dependencies by `$ npm install`
- Checkout a feature branch
- Feel free to add your features
- Make sure your features are fully tested
- Publish your local branch, Open a pull request
- Enjoy hacking <3

### MIT license
Copyright (c) 2016 Misery Lee &lt;miserylee@foxmail.com&gt;

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the &quot;Software&quot;), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED &quot;AS IS&quot;, WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.

---
built upon love by [docor](git+https://github.com/turingou/docor.git) v0.3.0
