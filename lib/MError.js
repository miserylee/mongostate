class MError extends Error {
  constructor (message, type) {
    super(message);
    this.type = type;
    this.wrongdoer = 'mongostate';
  }
}

module.exports = MError;