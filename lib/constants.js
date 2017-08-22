module.exports.errorTypes = {
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  INVALID_OPERATION: 'INVALID_OPERATION',
  MISSING_PARAMETER: 'MISSING_PARAMETER',
  INVALID_PARAMETER: 'INVALID_PARAMETER',
  INVALID_TRANSACTION_STATE: 'INVALID_TRANSACTION_STATE',
  INVALID_ENTITY_STATE: 'INVALID_ENTITY_STATE',
  ENTITY_LOCKED: 'ENTITY_LOCKED'
};

module.exports.states = {
  PENDING: 'pending',
  COMMITTED: 'committed',
  ROLLBACK: 'rollback',
  CANCELLED: 'cancelled',
  FINISHED: 'finished',
  ACTIVATED: 'activated',
};

module.exports.operations = {
  CREATE: 'create',
  UPDATE: 'update',
  REMOVE: 'remove'
};