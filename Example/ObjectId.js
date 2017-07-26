const ObjectId = require('mongoose').Types.ObjectId;

console.log(typeof (new ObjectId));
console.log((new ObjectId).constructor.name);
console.log(({ $ne: '123456789' }).constructor.name);