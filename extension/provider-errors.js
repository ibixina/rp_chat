(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ProviderErrors = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function parse(value) {
    if (typeof value !== 'string') return value;
    try { return JSON.parse(value); } catch (_) { return value; }
  }

  function extractMessages(value, depth = 0) {
    if (value == null || depth > 8) return [];
    if (typeof value === 'string') {
      const text = value.trim();
      if (!text) return [];
      const parsed = parse(text);
      if (parsed !== text) {
        const messages = extractMessages(parsed, depth + 1);
        if (messages.length) return messages;
      }
      return [text];
    }
    if (Array.isArray(value)) return value.flatMap(item => extractMessages(item, depth + 1));
    if (typeof value !== 'object') return [];
    return ['message', 'msg', 'detail', 'details', 'reason', 'reasons', 'description', 'error', 'errors', 'metadata', 'raw', 'choices', 'native_finish_reason']
      .flatMap(field => extractMessages(value[field], depth + 1));
  }

  function describe(value, fallback = 'Provider returned an error.') {
    const payload = parse(value);
    const error = payload?.error || payload;
    const messages = [...new Set(extractMessages(payload))];
    const provider = error?.metadata?.provider_name || payload?.provider;
    const code = error?.code ?? error?.status ?? payload?.code ?? payload?.status;
    const context = [...new Set([provider, code, error?.metadata?.provider_code, error?.metadata?.error_type]
      .filter(item => typeof item === 'string' ? item.trim() : typeof item === 'number'))];
    const message = messages.length ? messages.join('\n') : fallback;
    return context.length ? `${message}\n(${context.join(', ')})` : message;
  }

  return { describe };
});
