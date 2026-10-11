'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ProviderErrors = require('../extension/provider-errors');

const source = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const streamSource = source.slice(
  source.indexOf('  async function streamAiCompletion('),
  source.indexOf('  function applyMemoryDelta(')
);

function streamFixture(parts, options = {}) {
  const chunks = [];
  const encoder = new TextEncoder();
  const context = vm.createContext({
    TextDecoder, ProviderErrors, window: { location: { origin: 'http://localhost' } }, logEvent() {},
    fetch: async () => new Response(new ReadableStream({
      start(controller) {
        parts.forEach(part => controller.enqueue(encoder.encode(part)));
        controller.close();
      }
    }), { status: options.status || 200, headers: options.headers })
  });
  vm.runInContext(`${streamSource}\nthis.complete = streamAiCompletion;`, context);
  return {
    chunks,
    complete: () => context.complete([], { openrouterKey: 'test-key', model: 'test-model' }, chunk => chunks.push(chunk), true)
  };
}

const textEvent = text => `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}`;

test('a provider error in the final event rejects a streamed partial response', async () => {
  const fixture = streamFixture([textEvent('Partial response') + '\n', 'data: {"error":{"message":"Provider failed"}}']);
  await assert.rejects(fixture.complete(), /Provider failed/);
  assert.deepEqual(fixture.chunks, ['Partial response']);
});

test('provider errors mentioning JSON are not mistaken for malformed events', async () => {
  const fixture = streamFixture([textEvent('Partial response') + '\n', 'data: {"error":{"message":"Upstream JSON service failed"}}\n']);
  await assert.rejects(fixture.complete(), /Upstream JSON service failed/);
});

test('string provider errors in a final event also reject the response', async () => {
  const fixture = streamFixture([textEvent('Partial response') + '\n', 'data: {"error":"Provider failed"}']);
  await assert.rejects(fixture.complete(), /Provider failed/);
});

test('valid final events, split network chunks, and DONE markers preserve all text', async () => {
  const event = textEvent('First 🙂');
  const fixture = streamFixture([event.slice(0, 18), event.slice(18) + '\n\n', ': heartbeat\n', textEvent(' second') + '\n', 'data: [DONE]']);
  assert.equal(await fixture.complete(), 'First 🙂 second');
  assert.deepEqual(fixture.chunks, ['First 🙂', ' second']);
  const finalText = streamFixture([textEvent('Final text')]);
  assert.equal(await finalText.complete(), 'Final text');
});

test('malformed events do not discard valid text that follows', async () => {
  const fixture = streamFixture(['data: {broken-json}\n', textEvent('Valid response') + '\n', 'data: [DONE]\n']);
  assert.equal(await fixture.complete(), 'Valid response');
});

for (const [kind, raw] of [
  ['plain text', 'The model only supports 8192 context tokens.'],
  ['object', { error: { message: 'The model only supports 8192 context tokens.' } }],
  ['JSON text', JSON.stringify({ error: { message: 'The model only supports 8192 context tokens.' } })]
]) {
  for (const streamed of [false, true]) {
    test(`${streamed ? 'streaming' : 'HTTP'} errors retain nested ${kind} provider details`, async () => {
      const payload = { error: {
        message: 'Provider returned error', code: 400,
        metadata: { provider_name: 'Test Provider', raw }
      } };
      const fixture = streamFixture([streamed ? `data: ${JSON.stringify(payload)}\n` : JSON.stringify(payload)], {
        status: streamed ? 200 : 400
      });
      await assert.rejects(fixture.complete(), error => {
        assert.match(error.message, /The model only supports 8192 context tokens\./);
        assert.match(error.message, /Test Provider/);
        assert.match(error.message, /400/);
        return true;
      });
    });
  }
}

test('string errors and validation details from HTTP responses are shown instead of just the status', async () => {
  const bodies = [
    { error: 'Account has insufficient credits' },
    { detail: 'Account has insufficient credits' },
    { detail: [{ loc: ['body', 'model'], msg: 'Account has insufficient credits', type: 'value_error' }] },
    'Account has insufficient credits'
  ];
  for (const body of bodies) {
    const fixture = streamFixture([typeof body === 'string' ? body : JSON.stringify(body)], { status: 402 });
    await assert.rejects(fixture.complete(), /API Error 402: Account has insufficient credits/);
  }
});

test('an HTTP 200 JSON error surfaces its available reason', async () => {
  for (const body of [{ error: { message: 'Provider returned error', metadata: { raw: 'Provider is overloaded' } } },
    { message: 'Provider is overloaded' }]) {
    const fixture = streamFixture([JSON.stringify(body)], { headers: { 'Content-Type': 'application/json' } });
    await assert.rejects(fixture.complete(), /Provider is overloaded/);
  }
});

test('an error finish reason cannot save partial output as a successful response', async () => {
  const fixture = streamFixture([textEvent('Partial') + '\n', 'data: {"choices":[{"finish_reason":"error","native_finish_reason":"provider_timeout"}]}\n']);
  await assert.rejects(fixture.complete(), /provider_timeout/);
});

test('JSON success responses still deliver their content', async () => {
  const fixture = streamFixture([JSON.stringify({ choices: [{ message: { content: 'Full response' } }] })], {
    headers: { 'Content-Type': 'application/json' }
  });
  assert.equal(await fixture.complete(), 'Full response');
  assert.deepEqual(fixture.chunks, ['Full response']);
});

test('empty error responses still retain the HTTP status', async () => {
  const fixture = streamFixture([''], { status: 503 });
  await assert.rejects(fixture.complete(), /API Error 503: The request failed\./);
});

test('provider details are deduplicated while moderation reasons and typed codes are retained', () => {
  const message = ProviderErrors.describe({ error: {
    code: 403, message: 'Request rejected', metadata: {
      provider_name: 'Test Provider', error_type: 'moderation', provider_code: 'blocked',
      raw: { error: { message: 'Request rejected' } }, reasons: ['Specific rejection reason']
    }
  } });
  assert.equal(message.match(/Request rejected/g).length, 1);
  assert.match(message, /Specific rejection reason/);
  assert.match(message, /Test Provider, 403, blocked, moderation/);
  assert.equal(ProviderErrors.describe({ error: {} }, 'Unknown failure'), 'Unknown failure');
});

test('the Gemini extension forwards the HTTP response reason using its configured content scripts', async () => {
  let connect;
  let generate;
  const sent = [];
  const context = vm.createContext({
    location: { hostname: 'gemini.google.com' },
    crypto: { randomUUID: () => 'test-request' }, URLSearchParams, AbortController,
    chrome: { runtime: { onConnect: { addListener(listener) { connect = listener; } } } },
    fetch: async url => url === '/app'
      ? new Response('"SNlM0e":"test-session"')
      : new Response(JSON.stringify({ error: {
        message: 'Resource exhausted', metadata: { raw: 'Daily request limit reached for this model' }
      } }), { status: 429 })
  });
  const extensionDir = path.join(__dirname, '..', 'extension');
  const manifest = JSON.parse(fs.readFileSync(path.join(extensionDir, 'manifest.json'), 'utf8'));
  const scripts = manifest.content_scripts.find(entry => entry.matches.includes('https://gemini.google.com/*')).js;
  scripts.forEach(file => vm.runInContext(fs.readFileSync(path.join(extensionDir, file), 'utf8'), context));
  connect({
    name: 'persona-provider:test', postMessage: message => sent.push(message),
    onDisconnect: { addListener() {} }, onMessage: { addListener(listener) { generate = listener; } }
  });
  await generate({ type: 'generate', requestId: 'test', messages: [{ role: 'user', content: 'Hello' }] });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].type, 'error');
  assert.match(sent[0].message, /HTTP 429/);
  assert.match(sent[0].message, /Daily request limit reached for this model/);
});
