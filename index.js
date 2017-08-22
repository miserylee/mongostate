const mongoose = require('mongoose');
const Schema = mongoose.Schema;
const ObjectId = mongoose.Types.ObjectId;
const timestamp = require('mongoose-timestamp');
const debug = require('debug')('mongostate');
const Joi = require('joi');
const lockSchema = require('./lib/schemas/lock');
const transactionSchema = require('./lib/schemas/transaction');
const { errorTypes, states, operations } = require('./lib/constants');
const MError = require('./lib/MError');
const co = require('co');

if (!mongoose.plugins.some(plugin => plugin[0] === timestamp)) {
  transactionSchema.plugin(timestamp);
  lockSchema.plugin(timestamp);
}

const optionsSchema = Joi.object({
  id: Joi.alternatives().try(Joi.string().empty(''), Joi.object().type(ObjectId)).allow(null),
  connection: Joi.object().required(),
  transactionCollectionName: Joi.string().default('transaction'),
  lockCollectionName: Joi.string().default('lock'),
  subStateCollectionPrefix: Joi.string().default('sub_state_'),
  biz: Joi.object()
}).unknown();

class Transaction {
  constructor (options) {
    const { value, error } = Joi.validate(options, optionsSchema);
    if (error) throw error;
    this._id = value.id || new ObjectId;
    this._options = value;
    this._usedModels = {};
  }

  get id () {
    return this._id;
  }

  get TransactionModel () {
    const { connection, transactionCollectionName } =  this._options;
    return connection.model(transactionCollectionName, transactionSchema);
  }

  get LockModel () {
    const { connection, lockCollectionName } = this._options;
    return connection.model(lockCollectionName, lockSchema);
  }

  async _findTransaction () {
    return await this.TransactionModel.findById(this.id);
  }

  async _initSubStateData (SSModel, doc) {
    // Bind the transaction id to the sub-state doc and save it.
    doc.__t = this.id;
    return await SSModel.create(doc);
  }

  async _lock (entity, Model) {
    if (!entity) throw new MError(`Entity [${Model.modelName}:${entity._id}] is not exists`, errorTypes.INVALID_ENTITY_STATE);
    /**
     * Try to find the lock, if not, try to create the lock.
     */
    const lock = {
      transaction: this.id,
      model: Model.modelName,
      entity: entity._id
    };
    const otherLock = await this.LockModel.findOne({
      model: Model.modelName,
      entity: entity._id,
      transaction: { $ne: this.id }
    });
    let isNew = false;
    if (otherLock) throw new MError(`Entity [${Model.modelName}:${entity.id}] is locked!`, errorTypes.ENTITY_LOCKED);
    try {
      if (!(await this.LockModel.findOne(lock))) {
        await this.LockModel.create(lock);
        isNew = true;
      }
    } catch (err) {
      if (err.name === 'MongoError' && err.code === 11000) {
        throw new MError(`Entity [${Model.modelName}:${entity.id}] is locked!`, errorTypes.ENTITY_LOCKED);
      } else throw err;
    }
    return isNew;
  }

  async _pushAction (action) {
    await this.TransactionModel.findByIdAndUpdate(this.id, {
      $push: { actions: action }
    });
  }

  async _addUsedModel (Model, SSModel) {
    const modelName = Model.modelName;
    if (!this._usedModels[modelName]) {
      this._usedModels[modelName] = { Model, SSModel };
      await this.TransactionModel.findByIdAndUpdate(this.id, {
        $addToSet: {
          usedModelNames: modelName
        }
      });
    }
  }

  forceUseModel (Model, SSModel) {
    const modelName = Model.modelName;
    if (!this._usedModels[modelName]) {
      this._usedModels[modelName] = { Model, SSModel };
    }
  }

  async _initTransaction () {
    const TransactionModel = this.TransactionModel;
    let transaction = await TransactionModel.findById(this.id);
    if (!transaction) {
      transaction = await TransactionModel.create({
        _id: this.id,
        biz: JSON.parse(JSON.stringify(this._options.biz || {}))
      });
    } else {
      if ([states.CANCELLED, states.FINISHED].includes(transaction.state)) {
        throw new MError(`The transaction [${transaction.id}] has [${transaction.state}].`, errorTypes.INVALID_TRANSACTION_STATE);
      }
    }
    return transaction;
  }

  async _findOneAndLock (Model, SSModel, [criteria = {}]) {
    if (!this._trying) throw new MError('Do not execute dangerous operation outside try method of transaction!', errorTypes.INVALID_OPERATION);
    const srcEntity = await Model.findOne(criteria);
    // Init transaction data if transaction is not exists.
    let transaction = await this._findTransaction();
    if (!transaction) transaction = await this._initTransaction();
    if (transaction.state !== states.PENDING) {
      throw new MError('Transaction is not pending!', errorTypes.INVALID_TRANSACTION_STATE);
    }
    // Record usedModel
    await this._addUsedModel(Model, SSModel);
    // Lock entity
    const query = srcEntity || { _id: (!criteria._id || criteria._id.constructor.name === 'Object') ? new ObjectId : criteria._id };
    const isNew = await this._lock(query, Model);
    // Try to find the entity from the sub-state model,
    // if not, find it from src model and copy it to sub-state model.
    // if lock is new, clear the sub-state data.
    if (isNew) {
      await SSModel.remove(query);
    }
    let entity = await SSModel.findOne(criteria);
    if (!entity && srcEntity) {
      const doc = srcEntity.toJSON();
      Reflect.deleteProperty(doc, '__v');
      entity = await this._initSubStateData(SSModel, doc);
    }
    return entity;
  }

  async _findById (Model, SSModel, [id]) {
    return await this._findOneAndLock(Model, SSModel, [{ _id: id }]);
  }

  async _findOneAndRemove (Model, SSModel, [query]) {
    const entity = await this._findOneAndLock(Model, SSModel, [query]);
    // Record the action for rollback.
    await this._pushAction({
      operation: operations.REMOVE,
      model: Model.modelName,
      entity: entity._id
    });
    return await SSModel.findOneAndRemove(query);
  }

  async _findByIdAndRemove (Model, SSModel, [id]) {
    return await this._findOneAndRemove(Model, SSModel, [{ _id: id }]);
  }

  async _findOneAndUpdate (Model, SSModel, [query, doc, options]) {
    const entity = await this._findOneAndLock(Model, SSModel, [query]);
    if (!entity) return null;
    await this._pushAction({
      operation: operations.UPDATE,
      model: Model.modelName,
      entity: entity._id,
    });
    // $unset is not support, so covert it to $set;
    if (doc.$unset) {
      doc.$set = doc.$set || {};
      Object.keys(doc.$unset).forEach(key => {
        doc.$set[key] = null;
      });
      Reflect.deleteProperty(doc, '$unset');
    }
    return await SSModel.findOneAndUpdate(query, doc, options);
  }

  async _findByIdAndUpdate (Model, SSModel, [id, doc, options]) {
    return await this._findOneAndUpdate(Model, SSModel, [{ _id: id }, doc, options]);
  }

  async _create (Model, SSModel, [doc]) {
    if (!doc._id) doc._id = new ObjectId;
    const entity = await this._findById(Model, SSModel, [doc._id]);
    if (entity) throw new MError(`Entity [${Model.modelName}:${doc._id}] has already exists!`, errorTypes.INVALID_ENTITY_STATE);
    await this._pushAction({
      operation: operations.CREATE,
      model: Model.modelName,
      entity: doc._id,
    });
    // if doc is an entity, covert it to json doc.
    if (doc.constructor.name === 'model') {
      doc = doc.toJSON();
    }
    // Create the new doc in sub-state model.
    return await this._initSubStateData(SSModel, doc);
  }

  // Wrapper original Model to TModel to support transaction.
  use (Model, force = false) {
    const modelName = Model.modelName;
    const SSModelName = `${this._options.subStateCollectionPrefix}${modelName}`;
    let SSModel;
    try {
      SSModel = this._options.connection.model(SSModelName);
    } catch (err) {
      if (err.name === 'MissingSchemaError') {
        const schema = Model.schema;
        // Bind the transaction to the sub-state Model for searching it later.
        schema.add({
          __t: { type: Schema.ObjectId, index: true },
        });
        SSModel = this._options.connection.model(SSModelName, schema);
      } else throw err;
    }
    if (!SSModel) throw new MError(`SSModel [${SSModelName}] has not registered!`, errorTypes.INTERNAL_ERROR);
    if (force) {
      this.forceUseModel(Model, SSModel);
    }

    return {
      create: async (...params) => await this._create(Model, SSModel, params),
      findOneAndUpdate: async (...params) => await this._findOneAndUpdate(Model, SSModel, params),
      findByIdAndUpdate: async (...params) => await this._findByIdAndUpdate(Model, SSModel, params),
      findOneAndRemove: async (...params) => await this._findOneAndRemove(Model, SSModel, params),
      findByIdAndRemove: async (...params) => await this._findByIdAndRemove(Model, SSModel, params),
      findOne: async (...params) => await this._findOneAndLock(Model, SSModel, params),
      findById: async (...params) => await this._findById(Model, SSModel, params),
    };
  }

  async 'try' (wrapper = async _ => _) {
    if (this._tried) throw new MError('The transaction has tried, do not try it again!', errorTypes.INVALID_OPERATION);
    if (!['AsyncFunction', 'GeneratorFunction'].includes(wrapper.constructor.name)) {
      throw new MError('wrapper should be a async or generator function.', errorTypes.INVALID_PARAMETER);
    }
    let result;
    try {
      this._trying = true;
      result = await co(function * () {
        return yield wrapper.bind(this)()
      }.bind(this));
      await this.finish();
      this._trying = false;
    } catch (err) {
      await this.cancel(err);
      throw err;
    }
    this._tried = true;
    return result;
  }

  async _activate () {
    const transaction = await this._findTransaction();
    if (!transaction) return;
    if (![states.ACTIVATED, states.COMMITTED].includes(transaction.state)) {
      throw new MError(`Expected the transaction [${this.id}] to be activated/committed, but got ${transaction.state}`, errorTypes.INVALID_TRANSACTION_STATE);
    }
    if (transaction.state === states.ACTIVATED) return;
    debug(`Transaction [${this.id}] committed! Start to copy entities.`);
    const entitiesActivated = [];
    const actions = transaction.actions.reverse();
    for (let { model, entity, operation } of actions) {
      const entityName = `${model}:${entity}`;
      if (entitiesActivated.includes(entityName)) continue;
      entitiesActivated.push(entityName);
      const { Model, SSModel } = this._usedModels[model] || {};
      if (!Model) throw new MError(`Model ${model} has not used, please use the model first`, errorTypes.INVALID_OPERATION);
      const subStateEntity = await SSModel.findById(entity);
      let doc;
      if (subStateEntity) {
        doc = subStateEntity.toJSON();
        Reflect.deleteProperty(doc, '__v');
        Reflect.deleteProperty(doc, '__t');
      }
      if (doc) {
        const prevEntity = await Model.findById(entity);
        if (prevEntity) {
          await Model.findByIdAndUpdate(entity, doc);
        } else {
          await Model.create(doc);
        }
      } else if (operation === operations.REMOVE) {
        await Model.findByIdAndRemove(entity);
      }
    }
    await this.TransactionModel.findByIdAndUpdate(this.id, {
      $set: {
        state: states.ACTIVATED
      }
    });
  }

  async _commit () {
    const transaction = await this._findTransaction();
    if (!transaction) return;
    if (![states.PENDING, states.COMMITTED].includes(transaction.state)) {
      throw new MError(`Expected the transaction [${this.id}] to be pending/committed, but got ${transaction.state}`, errorTypes.INVALID_TRANSACTION_STATE);
    }
    await this.TransactionModel.findByIdAndUpdate(this.id, {
      $set: {
        state: states.COMMITTED,
      }
    });
    await this._activate();
    await this._clearSubStateData();
  }

  async finish () {
    const transaction = await this._findTransaction();
    if (!transaction) return;
    if (![states.COMMITTED, states.PENDING].includes(transaction.state)) {
      throw new MError(`Expected the transaction [${this.id}] to be committed/pending, but got ${transaction.state}`, errorTypes.INVALID_TRANSACTION_STATE);
    }
    await this._commit();
    await this._unlock();
    await this.TransactionModel.findByIdAndUpdate(this.id, {
      $set: {
        state: states.FINISHED
      }
    });
    debug(`Transaction [${this.id}] finished.`);
  }

  async _rollback () {
    const transaction = await this._findTransaction();
    if (![states.PENDING, states.ROLLBACK].includes(transaction.state)) {
      throw new MError(`Expected the transaction [${this.id}] to be pending/rollback, but got ${transaction.state}`, errorTypes.INVALID_TRANSACTION_STATE);
    }
    await this.TransactionModel.findByIdAndUpdate(this.id, {
      $set: {
        state: states.ROLLBACK
      }
    });
    await this._clearSubStateData();
    debug(`Transaction [${this.id}] rollback success!`);
  }

  async _clearSubStateData () {
    const usedModelNames = Object.keys(this._usedModels);
    const t = await this._findTransaction();
    if (t.usedModelNames.some(modelName => !usedModelNames.includes(modelName))) {
      throw new MError(`${t.usedModelNames} should be used first!`, errorTypes.INVALID_OPERATION);
    }
    for (let modelName of usedModelNames) {
      const { SSModel } = this._usedModels[modelName];
      await SSModel.remove({ __t: this.id });
    }
  }

  async cancel (error) {
    debug(error.message);
    const transaction = await this._findTransaction();
    if (!transaction) return;
    if (![states.PENDING, states.ROLLBACK].includes(transaction.state)) {
      throw new MError(`Expected the transaction [${this.id}] to be pending/rollback, but got ${transaction.state}`, errorTypes.INVALID_TRANSACTION_STATE);
    }
    await this._rollback();
    await this._unlock();
    await this.TransactionModel.findByIdAndUpdate(this.id, {
      $set: {
        state: states.CANCELLED
      },
      error: {
        message: error.message,
        stack: error.stack
      }
    });
    debug(`Transaction [${this.id}] cancelled.`);
  }

  async _unlock () {
    await this.LockModel.remove({ transaction: this.id });
  }

}

module.exports = Transaction;
module.exports.errorTypes = errorTypes;
module.exports.states = states;
module.exports.MError = MError;