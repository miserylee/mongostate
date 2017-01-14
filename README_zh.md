## mongostate ![NPM version](https://img.shields.io/npm/v/mongostate.svg?style=flat)

数据状态机，让mongoose支持事务。

### 安装
```bash
$ npm install mongostate --save
```

### 示例
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
使用mongoose连接和其他可选参数初始化`init`事务，可选参数如下:

* `transactionCollectionName`  `默认值: 'transaction'`, 存储事务数据的collection.
* `lockCollectionName`  `默认值: 'lock'`, 存储锁数据的collection.
* `id`  如果传入了`id`，会生成该id的事务对象，如果事务数据中有相同id的事务，后续操作将会基于该事务。
* `historyConnection` 如果传入了`historyConnection`，你可以使用`this.use(Person, true)`来使Person数据支持历史记录。

注意：所有的不安全的操作应该放在`try`方法内，在这个闭包内如果发生了错误，所有的这些操作将会自动回滚。

以下方法可以和mongoose的方法一样的使用（带 * 表示该方法为generator）：

* `* create`
* `* findByIdAndUpdate`
* `* findOneAndUpdate`
* `* findByIdAndRemove`
* `* findOneAndRemove`
* `* findOne`
* `* findById`

以下方法是对历史记录的支持，请在示例代码中查看详细的使用方法：

* `* findHistories`
* `* findLatestHistory`
* `* revertTo`

以下静态方法，可以适用更多高级的使用方式：

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
