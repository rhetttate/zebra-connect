// Registers the offline worker — only the built site includes this script.
(function () {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('./sw.js').then((reg) => {
    const announce = () => window.dispatchEvent(new CustomEvent('zc-update-ready'));
    if (reg.waiting && navigator.serviceWorker.controller) announce();
    reg.addEventListener('updatefound', () => {
      const worker = reg.installing;
      if (!worker) return;
      worker.addEventListener('statechange', () => {
        if (worker.state === 'installed' && navigator.serviceWorker.controller) announce();
      });
    });
    window.addEventListener('zc-update-apply', () => {
      reg.waiting?.postMessage('skip-waiting');
    });
  }).catch(() => { /* offline use just won't be available */ });
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading) return;
    reloading = true;
    location.reload();
  });
})();
