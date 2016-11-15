const mongoose = require('mongoose');
mongoose.Promise = Promise;
const Schema = mongoose.Schema;
const ObjectId = mongoose.Types.ObjectId;
const timestamp = require('mongoose-timestamp');
const debug = require('debug')('mongostate');

const states = {
  INIT: 'init',
  PENDING: 'pending',
  COMMITTED: 'committed',
  ROLLBACK: 'rollback',
  CANCELLED: 'cancelled'
};

const operations = {
  CREATE: 'create',
  UPDATE: 'update',
  REMOVE: 'remove'
};

const transactionSchema = new Schema({
  state: {
    type: String,
    enums: [states.INIT, states.PENDING, states.COMMITTED, states.ROLLBACK, states.CANCELLED],
    default: states.INIT,
    required: true
  },
  actions: [{
    operation: {
      type: String, required: true, enums: [
        operations.CREATE,
        operations.UPDATE,
        operations.REMOVE
      ]
    },
    model: { type: String, required: true },
    entity: { type: String, required: true }
  }],
  error: {
    message: String,
    stack: String
  }
});
transactionSchema.plugin(timestamp);

const lockSchema = new Schema({
  transaction: { type: Schema.ObjectId, required: true, index: true },
  model: { type: String, required: true },
  entity: { type: String, required: true }
});

lockSchema.index({ model: 1, entity: 1 }, { unique: true });
lockSchema.plugin(timestamp);

class Transaction {
  constructor ({
    connection,
    transactionModel,
    lockModel,
    id
  }) {
    this.id = id;
    this.transactionModel = transactionModel;
    this.lockModel = lockModel;
    this.connection = connection;
    this.usedModel = {};
  }

  static * init ({
    connection,
    id,
    transactionCollectionName = 'transaction',
    lockCollectionName = 'lock'
  } = {}) {
    if (!connection) throw new Error('connection is required!');
    const transactionModel = connection.model(transactionCollectionName, transactionSchema);
    const lockModel = connection.model(lockCollectionName, lockSchema);
    let t;
    if (id) t = yield transactionModel.findById(id);
    if (!t) {
      id = id || new ObjectId;
      yield transactionModel.create({ _id: id });
    } else {
      if ([states.CANCELLED, states.COMMITTED].includes(t.state)) throw new Error(`The transaction [${t.id}] has [${t.state}].`);
    }
    return new this({
      connection,
      transactionModel,
      lockModel,
      id
    });
  }

  * 'try' (wrapper = function * () {
  }) {
    if (wrapper.constructor.name !== 'GeneratorFunction') throw new Error('wrapper should be a generator function.');
    const transaction = yield this.findTransaction();
    if(transaction.state === states.INIT) {
      yield this.transactionModel.findByIdAndUpdate(this.id, {
        $set: { state: states.PENDING }
      });
    }
    try {
      const transaction = yield this.findTransaction();
      if (transaction.state === states.PENDING) {
        yield wrapper.bind(this)();
        yield this.commit();
      } else {
        yield this.cancel(new Error('Transaction is not pending!'));
      }
    } catch (err) {
      yield this.cancel(err);
      throw err;
    }
  }

  use (Model) {
    const modelName = Model.modelName;
    const SSModel = this.connection.model(`sub_state_${modelName}`, Model.schema);
    this.usedModel[modelName] = { Model, SSModel };
    return {
      create: function * (...params) {
        return yield this.create.bind(this)(Model, SSModel, params);
      }.bind(this),
      findOneAndUpdate: function * (...params) {
        return yield this.findOneAndUpdate.bind(this)(Model, SSModel, params);
      }.bind(this),
      findByIdAndUpdate: function * (...params) {
        return yield this.findByIdAndUpdate.bind(this)(Model, SSModel, params);
      }.bind(this),
      findByIdAndRemove: function * (...params) {
        return yield this.findByIdAndRemove.bind(this)(Model, SSModel, params);
      }.bind(this),
      findOneAndRemove: function * (...params) {
        return yield this.findOneAndRemove.bind(this)(Model, SSModel, params);
      }.bind(this),
      findOne: function * (...params) {
        return yield this.findOne.bind(this)(Model, SSModel, params);
      }.bind(this),
      findById: function * (...params) {
        return yield this.findById.bind(this)(Model, SSModel, params);
      }.bind(this)
    };
  }

  * create (Model, SSModel, [doc]) {
    if (!doc._id) {
      doc._id = new ObjectId;
    } else {
      const entity = yield this.findById(Model, SSModel, [doc._id]);
      if (entity) throw new Error('entity has already exists!');
    }
    yield this.pushAction({
      operation: operations.CREATE,
      model: Model.modelName,
      entity: doc._id
    });
    yield this.lock({id: doc._id}, Model);
    return yield SSModel.create(doc);
  }

  * findOneAndUpdate (Model, SSModel, [query, doc, options]) {
    const entity = yield this.findOne(Model, SSModel, [query]);
    if (!entity) throw new Error('Entity is not exists');
    yield this.pushAction({
      operation: operations.UPDATE,
      model: Model.modelName,
      entity: entity.id
    });
    yield this.lock(entity, Model);
    return yield SSModel.findOneAndUpdate(query, doc, options);
  }

  * findByIdAndUpdate (Model, SSModel, [id, doc, options]) {
    return yield this.findOneAndUpdate(Model, SSModel, [{ _id: id }, doc, options]);
  }

  * findOneAndRemove (Model, SSModel, [query]) {
    const entity = yield this.findOne(Model, SSModel, [query]);
    yield this.pushAction({
      operation: operations.REMOVE,
      model: Model.modelName,
      entity: entity.id
    });
    yield this.lock(entity, Model);
  }

  * findByIdAndRemove (Model, SSModel, [id]) {
    yield this.findOneAndRemove(Model, SSModel, [{ _id: id }]);
  }

  * findOne (Model, SSModel, [criteria]) {
    const entity = yield SSModel.findOne(criteria);
    const lock = yield this.checkLock(entity, Model);
    if (lock) {
      return entity;
    }
    if (!entity) {
      return yield Model.findOne(criteria);
    }
    return entity;
  }

  * findById (Model, SSModel, [id]) {
    return yield this.findOne(Model, SSModel, [{ _id: id }]);
  }

  * checkLock (entity, Model) {
    if (!entity) return null;
    const lock = yield this.lockModel.findOne({
      model: Model.modelName,
      entity: entity.id
    });
    if (lock && lock.transaction.toString() !== this.id.toString()) {
      throw new Error(`entity [${entity.id}] is locked by transaction [${lock.transaction}]`);
    }
    return lock;
  }

  * lock (entity, Model) {
    if (!entity) throw new Error('Entity is not exists!');
    const lock = yield this.checkLock(entity, Model);
    if (!lock) {
      yield this.lockModel.create({
        transaction: this.id,
        model: Model.modelName,
        entity: entity.id
      });
    }
  }

  * pushAction (action) {
    yield this.transactionModel.findByIdAndUpdate(this.id, {
      $push: {
        actions: action
      }
    });
  }

  * findTransaction () {
    return yield this.transactionModel.findById(this.id);
  }

  * commit () {
    const transaction = yield this.findTransaction();
    if (transaction.state !== states.PENDING) throw new Error(`Expected the transaction [${this.id}] to be pending, but got ${transaction.state}`);
    for (let action of transaction.actions) {
      const { Model, SSModel } = this.usedModel[action.model] || {};
      if (!Model) throw new Error(`Model ${action.model} has not used, please use the model first`);
      switch (action.operation) {
        case operations.CREATE: {
          const subStateEntity = yield SSModel.findById(action.entity);
          if (!subStateEntity) break;
          const data = subStateEntity.toJSON();
          delete data.__v;
          yield Model.create(data);
          break;
        }
        case operations.UPDATE: {
          const subStateEntity = yield SSModel.findById(action.entity);
          if (!subStateEntity) break;
          const data = subStateEntity.toJSON();
          delete data.__v;
          yield Model.findByIdAndUpdate(action.entity, data);
          break;
        }
        case operations.REMOVE: {
          yield Model.findByIdAndRemove(action.entity);
          break;
        }
        default:
          break;
      }
      yield SSModel.remove({ entity: action.entity });
    }
    yield this.unlock();
    yield this.transactionModel.findByIdAndUpdate(this.id, {
      $set: {
        state: states.COMMITTED
      }
    });
    debug(`Transaction [${this.id}] committed!`);
  }

  * rollback () {
    const transaction = yield this.findTransaction();
    if (![states.PENDING, states.ROLLBACK].includes(transaction.state)) throw new Error(`Expected the transaction [${this.id}] to be pending/rollback, but got ${transaction.state}`);
    yield this.transactionModel.findByIdAndUpdate(this.id, {
      $set: {
        state: states.ROLLBACK
      }
    });
    for (let action of transaction.actions) {
      const { Model, SSModel } = this.usedModel[action.model] || {};
      if (!Model) throw new Error(`Model ${action.model} has not used, please use the model first`);
      yield SSModel.remove(action.entity);
    }
    debug(`Transaction [${this.id}] rollback success!`);
  }

  * cancel (error) {
    const transaction = yield this.findTransaction();
    if (![states.PENDING, states.ROLLBACK].includes(transaction.state)) throw new Error(`Expected the transaction [${this.id}] to be pending/rollback, but got ${transaction.state}`);
    yield this.rollback();
    yield this.unlock();
    yield this.transactionModel.findByIdAndUpdate(this.id, {
      $set: {
        state: states.CANCELLED
      },
      error: {
        message: error.message,
        stack: error.stack
      }
    });
    debug(`Transaction [${this.id}] cancelled!`);
  }

  * unlock () {
    yield this.lockModel.remove({ transaction: this.id });
  }

}

module.exports = Transaction;