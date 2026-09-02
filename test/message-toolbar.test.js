'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('message toolbar is only placed below when it fully fits in the chat feed', () => {
  const appSource = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');

  assert.match(appSource, /const toolbarFitsBelow = spaceBelow >= toolbarClearance;/);
  assert.match(
    appSource,
    /classList\.toggle\('toolbar-below', spaceAbove < toolbarClearance && toolbarFitsBelow\)/
  );
});
