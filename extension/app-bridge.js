(() => {
  if (!document.querySelector('meta[name="persona-chat-app"]')) return;

  const APP_SOURCE = 'persona-chat-app';
  const EXTENSION_SOURCE = 'persona-chat-extension';
  let port;

  function postToPage(message) {
    window.postMessage({ source: EXTENSION_SOURCE, ...message }, window.location.origin);
  }

  function getPort() {
    if (port) return port;
    port = chrome.runtime.connect({ name: 'persona-chat-app' });
    port.onMessage.addListener(postToPage);
    port.onDisconnect.addListener(() => {
      port = null;
    });
    return port;
  }

  window.addEventListener('message', event => {
    const message = event.data;
    if (event.source !== window || message?.source !== APP_SOURCE) return;

    if (message.type === 'ping') {
      postToPage({ type: 'pong', requestId: message.requestId });
      return;
    }

    if (message.type === 'open-login') {
      chrome.runtime.sendMessage({
        type: 'open-login',
        provider: message.provider
      });
      return;
    }

    if (message.type === 'generate') {
      getPort().postMessage({
        type: 'generate',
        requestId: message.requestId,
        provider: message.provider,
        model: message.model,
        messages: message.messages,
        threadId: message.threadId,
        messageId: message.messageId,
        memory: message.memory,
        instructionRevision: message.instructionRevision,
        mode: message.mode
      });
    }
  });

  postToPage({ type: 'ready' });
})();
