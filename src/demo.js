// Lets the extension be tried on the demo page, without a Bitbucket server. On a page
// marked as the demo, the Data Center provider gets its data through the page, whose
// service worker plays the server. A content script's own requests wouldn't reach that
// worker. Nothing else changes, and no other page uses this.
(function (root) {
  const dataCenter = root.PrDiff.providers.find((provider) => provider.prChanges);
  let nextId = 0;

  function fetchThroughPage(url) {
    const id = `bpd-demo-${nextId++}`;
    return new Promise((resolve) => {
      function onReply(event) {
        if (event.source !== window || event.data?.type !== 'bpd-demo-reply' || event.data.id !== id) return;
        window.removeEventListener('message', onReply);
        const { status, body } = event.data;
        resolve({ ok: status === 200, status, json: async () => JSON.parse(body) });
      }
      window.addEventListener('message', onReply);
      window.postMessage({ type: 'bpd-demo-request', id, url }, location.origin);
    });
  }

  const provider = {
    ...dataCenter,
    matchPr: (href) => (document.querySelector('meta[name="commit-span-demo"]') ? dataCenter.matchPr(href) : null),
    loadPr: (pr) => dataCenter.loadPr(pr, fetchThroughPage),
    listChanges: (pr, newer, older) => dataCenter.listChanges(pr, newer, older, fetchThroughPage),
    fileDiff: (pr, newer, older, change) => dataCenter.fileDiff(pr, newer, older, change, fetchThroughPage),
    prChanges: (pr) => dataCenter.prChanges(pr, fetchThroughPage),
    prFileDiff: (pr, change) => dataCenter.prFileDiff(pr, change, fetchThroughPage),
    // There's no compare page in the demo.
    compareUrl: (pr) => dataCenter.diffTabUrl(pr),
  };

  root.PrDiff.providers.unshift(provider);
})(globalThis);
