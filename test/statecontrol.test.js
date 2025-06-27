const assert = require('assert');
const { generateUniqueId } = require('../statecontrol.js');

const prefix = 'test_';
const id1 = generateUniqueId(prefix);
const id2 = generateUniqueId(prefix);

assert.notStrictEqual(id1, id2, 'IDs should be unique');
assert.ok(id1.startsWith(prefix), 'First ID should start with prefix');
assert.ok(id2.startsWith(prefix), 'Second ID should start with prefix');

console.log('All tests passed.');
