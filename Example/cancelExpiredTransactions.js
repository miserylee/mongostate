require('tlan');
const co = require('co');
const Transaction = require('../');
const connection = require('./connection');
const Person = require('./Person');

co(function * () {
  const transaction = new Transaction({ connection });
  const Model = transaction.TransactionModel;
  const transactions = yield Model.find({
    state: {
      $nin: [
        Transaction.states.CANCELLED,
        Transaction.states.FINISHED
      ]
    },
    createdAt: {
      $lte: '2 seconds'.before(new Date())
    }
  });

  console.log(transactions);

  transactions.forEach(co.wrap(function * (transaction) {
    const t = new Transaction({
      connection,
      id: transaction._id,
    });
    t.use(Person, true);
    if(transaction.state === Transaction.states.COMMITTED) {
      yield t.finish();
    } else {
      console.log(`取消事务[${transaction._id}]`);
      const error = new Error('未完成事务取消');
      error.type = 'CANCEL_PENDING_TRANSACTION';
      yield t.cancel(error);
    }
  }));

}).catch(console.error);