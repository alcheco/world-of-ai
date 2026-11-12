import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSavedVariables, toLua } from '../src/lua.js';

test('parsea SavedVariables como las escribe WoW', () => {
  const src = `
WoAI_DB = {
["outbox"] = {
{
["prompt"] = "hola \\"mundo\\"\\n|cff ñandú",
["agent"] = "claude",
["id"] = "1731-1-1234",
["createdAt"] = 1731430000,
}, -- [1]
},
["counter"] = 1,
["settings"] = {
},
}
`;
  const { WoAI_DB } = parseSavedVariables(src);
  assert.equal(WoAI_DB.counter, 1);
  assert.equal(WoAI_DB.outbox.length, 1);
  assert.equal(WoAI_DB.outbox[0].prompt, 'hola "mundo"\n|cff ñandú');
  assert.deepEqual(WoAI_DB.settings, []);
});

test('escapes decimales como bytes UTF-8', () => {
  const { X } = parseSavedVariables('X = "\\195\\177"');
  assert.equal(X, 'ñ');
});

test('ida y vuelta toLua → parse', () => {
  const data = {
    a: 'línea 1\nlínea "2" \\ fin\u0001x9',
    list: [1, 2, { k: true }],
    'key-with-dash': { n: -3.5 },
  };
  const back = parseSavedVariables(`D = ${toLua(data)}`).D;
  assert.deepEqual(back, data);
});
