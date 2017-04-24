const mongoose = require('mongoose');
mongoose.Promise = Promise;
const Schema = mongoose.Schema;
const ObjectId = mongoose.Types.ObjectId;
const timestamp = require('mongoose-timestamp');
const debug = require('debug')('mongostate');
const jsondiffpatch = require('jsondiffpatch').create();
const Errrr = require('errrr');

class Error extends Errrr {
  constructor (message, type) {
    super(message);
    this.type = type;
    this.wrongdoer = 'mongostate';
  }
}

const errorTypes = {
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  INVALID_OPERATION: 'INVALID_OPERATION',
  MISSING_PARAMETER: 'MISSING_PARAMETER',
  INVALID_PARAMETER: 'INVALID_PARAMETER',
  INVALID_TRANSACTION_STATE: 'INVALID_TRANSACTION_STATE',
  INVALID_ENTITY_STATE: 'INVALID_ENTITY_STATE',
  ENTITY_LOCKED: 'ENTITY_LOCKED'
};

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
  usedModelNames: [String],
  actions: [{
    operation: {
      type: String, required: true, enums: [
        operations.CREATE,
        operations.UPDATE,
        operations.REMOVE
      ]
    },
    model: { type: String, required: true },
    entity: { type: String, required: true },
    enableHistory: { type: Boolean, default: false }
  }],
  error: {
    message: String,
    stack: String
  },
  biz: {}
});

const lockSchema = new Schema({
  transaction: { type: Schema.ObjectId, required: true, index: true },
  model: { type: String, required: true },
  entity: { type: String, required: true }
});

lockSchema.index({ model: 1, entity: 1 }, { unique: true });

const historySchema = new Schema({
  transaction: { type: Schema.ObjectId, required: true, index: true },
  entity: { type: String, required: true, index: true },
  biz: {},
  prev: {},
  diff: {},
  reverted: { type: Boolean, default: false }
});

historySchema.virtual('current').get(function () {
  return jsondiffpatch.patch(this.prev, this.diff);
});

historySchema.set('toJSON', { virtuals: true });

if (!mongoose.plugins.some(plugin => plugin[0] === timestamp)) {
  transactionSchema.plugin(timestamp);
  lockSchema.plugin(timestamp);
  historySchema.plugin(timestamp);
}

class Transaction {
  constructor ({
    connection,
    transactionModel,
    lockModel,
    id,
    historyConnection
  }) {
    this.id = id;
    this.transactionModel = transactionModel;
    this.lockModel = lockModel;
    this.connection = connection;
    this.usedModel = {};
    this.historyConnection = historyConnection;
  }

  static getTransactionModel (connection, transactionCollectionName = 'transaction') {
    if (!connection) throw new Error('connection is required!', errorTypes.MISSING_PARAMETER);
    return connection.model(transactionCollectionName, transactionSchema);
  }

  static getLockModel (connection, lockCollectionName = 'lock') {
    if (!connection) throw new Error('connection is required!', errorTypes.MISSING_PARAMETER);
    return connection.model(lockCollectionName, lockSchema);
  }

  static async init ({
    connection,
    id,
    transactionCollectionName,
    lockCollectionName,
    historyConnection,
    biz = {}
  } = {}) {
    const transactionModel = this.getTransactionModel(connection, transactionCollectionName);
    const lockModel = this.getLockModel(connection, lockCollectionName);
    let t;
    if (id) t = await transactionModel.findById(id);
    if (!t) {
      id = id || new ObjectId;
      await transactionModel.create({ _id: id, biz: JSON.parse(JSON.stringify(biz)) });
    } else {
      if ([states.CANCELLED, states.COMMITTED].includes(t.state)) throw new Error(`The transaction [${t.id}] has [${t.state}].`, errorTypes.INVALID_TRANSACTION_STATE);
    }
    return new this({
      connection,
      transactionModel,
      lockModel,
      id,
      historyConnection
    });
  }

  async 'try' (wrapper = async function() {}) {
    if (wrapper.constructor.name !== 'AsyncFunction') throw new Error('wrapper should be a async function.', errorTypes.INVALID_PARAMETER);
    const transaction = await this.findTransaction();
    if (transaction.state === states.INIT) {
      await this.transactionModel.findByIdAndUpdate(this.id, {
        $set: { state: states.PENDING }
      });
    }
    let result;
    try {
      const transaction = await this.findTransaction();
      if (transaction.state === states.PENDING) {
        result = await wrapper.bind(this)();
        await this.commit();
      } else {
        await this.cancel(new Error('Transaction is not pending!', errorTypes.INVALID_TRANSACTION_STATE));
      }
    } catch (err) {
      await this.cancel(err);
      throw err;
    }
    return result;
  }

  use (Model, enableHistory = true) {
    const modelName = Model.modelName;
    let SSModel;
    const SSModelName = `sub_state_${modelName}`;
    try {
      SSModel = this.connection.model(SSModelName);
    } catch (err) {
      if (err.name === 'MissingSchemaError') {
        const schema = Model.schema;
        schema.add({
          __t: { type: Schema.ObjectId },
        });
        SSModel = this.connection.model(SSModelName, schema);
      } else throw err;
    }
    if (!SSModel) throw new Error(`SSModel [${SSModelName}] has not registed!`, errorTypes.INTERNAL_ERROR);
    if (!this.usedModel[modelName]) {
      this.usedModel[modelName] = { Model, SSModel };
      this.transactionModel.findOneAndUpdate({
        _id: this.id,
        usedModelNames: { $ne: modelName }
      }, {
        $push: {
          usedModelNames: modelName
        }
      }).exec();
    }
    let History;
    if (this.historyConnection) {
      History = this.historyConnection.model(`${modelName}_history`, historySchema);
    }
    return {
      create: async function (...params) {
        return await this.create.bind(this)(Model, SSModel, params, enableHistory);
      }.bind(this),
      findOneAndUpdate: async function (...params) {
        return await this.findOneAndUpdate.bind(this)(Model, SSModel, params, enableHistory);
      }.bind(this),
      findByIdAndUpdate: async function (...params) {
        return await this.findByIdAndUpdate.bind(this)(Model, SSModel, params, enableHistory);
      }.bind(this),
      findByIdAndRemove: async function (...params) {
        return await this.findByIdAndRemove.bind(this)(Model, SSModel, params, enableHistory);
      }.bind(this),
      findOneAndRemove: async function (...params) {
        return await this.findOneAndRemove.bind(this)(Model, SSModel, params, enableHistory);
      }.bind(this),
      findOne: async function (...params) {
        return await this.findOne.bind(this)(Model, SSModel, params);
      }.bind(this),
      findById: async function (...params) {
        return await this.findById.bind(this)(Model, SSModel, params);
      }.bind(this),
      findHistories: async function (...params) {
        if (!History) return [];
        return await History.find(...params);
      },
      findLatestHistory: async function (...params) {
        if (!History) return null;
        return await History.findOne(...params).sort({ _id: -1 });
      },
      revertTo: async function (historyId) {
        if (!Transaction.noWarning) {
          console.warn('The `revertTo` method is dangerous, only use it when you know why!');
        }
        if (!History) return null;
        const transaction = await this.findTransaction();
        const history = await History.findById(historyId);
        if (!history) throw new Error(`The history [${historyId}] is not exists!`, errorTypes.INVALID_OPERATION);
        const doc = history.toJSON().prev;
        const prevEntity = await Model.findById(history.entity);
        let prev;
        if (prevEntity) {
          prev = prevEntity.toJSON();
          delete prev.__v;
        }
        const diff = jsondiffpatch.diff(prev, doc);
        await History.create({
          transaction: this.id,
          entity: history.entity,
          biz: transaction.biz,
          prev,
          diff,
          reverted: true
        });
        if (doc) {
          return await Model.findByIdAndUpdate(history.entity, doc, { upsert: true, new: true });
        } else {
          await Model.findByIdAndRemove(history.entity);
          return null;
        }
      }.bind(this)
    };
  }

  async create (Model, SSModel, [doc], enableHistory) {
    if (!doc._id) {
      doc._id = new ObjectId;
    }
    const entity = await this.findById(Model, SSModel, [doc._id]);
    if (entity) throw new Error(`Entity [${Model.modelName}:${doc._id}] has already exists!`, errorTypes.INVALID_ENTITY_STATE);
    await this.pushAction({
      operation: operations.CREATE,
      model: Model.modelName,
      entity: doc._id,
      enableHistory
    });
    if (doc.constructor.name === 'model') {
      doc = doc.toJSON();
    }
    return await this.initSubStateData(SSModel, doc);
  }

  async findOneAndUpdate (Model, SSModel, [query, doc, options], enableHistory) {
    const entity = await this.findOne(Model, SSModel, [query]);
    if (!entity) throw new Error(`Entity [${Model.modelName}:${JSON.stringify(query)}] is not exists`, errorTypes.INVALID_ENTITY_STATE);
    await this.pushAction({
      operation: operations.UPDATE,
      model: Model.modelName,
      entity: entity.id,
      enableHistory
    });
    if (doc.$unset) {
      Object.keys(doc.$unset).forEach(key => {
        doc.$set = doc.$set || {};
        doc.$set[key] = null;
      });
      delete doc.$unset;
    }
    return await SSModel.findOneAndUpdate(query, doc, options);
  }

  async findByIdAndUpdate (Model, SSModel, [id, doc, options], enableHistory) {
    return await this.findOneAndUpdate(Model, SSModel, [{ _id: id }, doc, options], enableHistory);
  }

  async findOneAndRemove (Model, SSModel, [query], enableHistory) {
    const entity = await this.findOne(Model, SSModel, [query]);
    await this.pushAction({
      operation: operations.REMOVE,
      model: Model.modelName,
      entity: entity.id,
      enableHistory
    });
    await SSModel.findOneAndRemove(query);
  }

  async findByIdAndRemove (Model, SSModel, [id], enableHistory) {
    await this.findOneAndRemove(Model, SSModel, [{ _id: id }], enableHistory);
  }

  async findOne (Model, SSModel, [criteria]) {
    const srcEntity = await Model.findOne(criteria);
    await this.lock(srcEntity || { _id: criteria._id || new ObjectId }, Model);
    const entity = await SSModel.findOne(criteria);
    if (!entity) {
      if (srcEntity) {
        const doc = srcEntity.toJSON();
        delete doc.__v;
        await this.initSubStateData(SSModel, doc);
      }
      return srcEntity;
    }
    return entity;
  }

  async findById (Model, SSModel, [id]) {
    return await this.findOne(Model, SSModel, [{ _id: id }]);
  }

  async lock (entity, Model) {
    if (!entity) throw new Error(`Entity [${Model.modelName}:${entity._id}] is not exists`, errorTypes.INVALID_ENTITY_STATE);
    try {
      const lock = await this.lockModel.findOne({
        transaction: this.id,
        model: Model.modelName,
        entity: entity._id
      });
      if (!lock) {
        await this.lockModel.create({
          transaction: this.id,
          model: Model.modelName,
          entity: entity._id
        });
      }
    } catch (err) {
      if (err.name === 'MongoError' && err.code === 11000) {
        throw new Error(`Entity [${Model.modelName}:${entity.id}] is locked!`, errorTypes.ENTITY_LOCKED);
      } else throw err;
    }
  }

  async initSubStateData (SSModel, doc) {
    doc.__t = this.id;
    return await SSModel.create(doc);
  }

  async pushAction (action) {
    await this.transactionModel.findByIdAndUpdate(this.id, {
      $push: {
        actions: action
      }
    });
  }

  async findTransaction () {
    return await this.transactionModel.findById(this.id);
  }

  async commit () {
    const transaction = await this.findTransaction();
    if (transaction.state !== states.PENDING) throw new Error(`Expected the transaction [${this.id}] to be pending, but got ${transaction.state}`, errorTypes.INVALID_TRANSACTION_STATE);

    const entitiesActivated = [];

    for (let action of transaction.actions.reverse()) {
      const { model, entity, enableHistory, operation } = action;
      if (entitiesActivated.includes(`${model}:${entity}`)) continue;
      entitiesActivated.push(`${model}:${entity}`);
      const { Model, SSModel } = this.usedModel[model] || {};
      if (!Model) throw new Error(`Model ${model} has not used, please use the model first`, errorTypes.INVALID_OPERATION);
      const subStateEntity = await SSModel.findById(entity);
      let doc;
      if (subStateEntity) {
        doc = subStateEntity.toJSON();
        delete doc.__v;
        delete doc.__t;
      }
      const prevEntity = await Model.findById(entity);
      // Record histories
      if (this.historyConnection && enableHistory) {
        const History = this.historyConnection.model(`${model}_history`, historySchema);
        let prev;
        if (prevEntity) {
          prev = prevEntity.toJSON();
          delete prev.__v;
        }
        const diff = jsondiffpatch.diff(prev, doc);
        await History.create({
          transaction: this.id,
          entity,
          biz: transaction.biz,
          prev,
          diff,
        });
      }
      if (doc) {
        const doc = subStateEntity.toJSON();
        delete doc.__v;
        delete doc.__t;
        if (prevEntity) {
          await Model.findByIdAndUpdate(entity, doc);
        } else {
          await Model.create(doc);
        }
      } else {
        await Model.findByIdAndRemove(entity);
      }
    }
    await this.clearSubStateData();
    await this.unlock();
    await this.transactionModel.findByIdAndUpdate(this.id, {
      $set: {
        state: states.COMMITTED
      }
    });
    debug(`Transaction [${this.id}] committed!`);
  }

  async rollback () {
    const transaction = await this.findTransaction();
    if (![states.PENDING, states.ROLLBACK].includes(transaction.state)) throw new Error(`Expected the transaction [${this.id}] to be pending/rollback, but got ${transaction.state}`, errorTypes.INVALID_TRANSACTION_STATE);
    await this.transactionModel.findByIdAndUpdate(this.id, {
      $set: {
        state: states.ROLLBACK
      }
    });
    await this.clearSubStateData();
    debug(`Transaction [${this.id}] rollback success!`);
  }

  async cancel (error) {
    const transaction = await this.findTransaction();
    if (![states.PENDING, states.ROLLBACK].includes(transaction.state)) throw new Error(`Expected the transaction [${this.id}] to be pending/rollback, but got ${transaction.state}`, errorTypes.INVALID_TRANSACTION_STATE);
    await this.rollback();
    await this.unlock();
    await this.transactionModel.findByIdAndUpdate(this.id, {
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

  async clearSubStateData () {
    const usedModelNames = Object.keys(this.usedModel);
    const t = await this.findTransaction();
    if (t.usedModelNames.some(modelName => !usedModelNames.includes(modelName))) {
      throw new Error(`${t.usedModelNames} should be used first!`, errorTypes.INVALID_OPERATION);
    }
    for (let modelName of usedModelNames) {
      const { SSModel } = this.usedModel[modelName];
      await SSModel.remove({ __t: this.id });
    }
  }

  async unlock () {
    await this.lockModel.remove({ transaction: this.id });
  }

}

module.exports = Transaction;
module.exports.errorTypes = errorTypes;
module.exports.states = states;
module.exports.Error = Error;