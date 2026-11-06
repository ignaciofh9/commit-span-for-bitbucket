// Answers the demo page's Bitbucket API requests from made-up data, in the same shapes
// as a real server, so the extension runs on it unchanged.
const REPO_API = '/rest/api/latest/projects/DEMO/repos/invoice-service/';
let dataPromise;

function loadData() {
  dataPromise ??= fetch(new URL('demo/data.json', self.registration.scope)).then((response) => response.json());
  return dataPromise;
}

const page = (values) => ({ values, size: values.length, isLastPage: true, start: 0 });

function diffOf(set, path, fromHash, toHash) {
  return { fromHash, toHash, diffs: [set?.diffs[path] || { hunks: [] }] };
}

async function answer(route, query) {
  const data = await loadData();
  const pr = 'pull-requests/1';
  if (route === pr) {
    return { id: 1, title: data.title, fromRef: { latestCommit: data.tip }, toRef: { latestCommit: data.target } };
  }
  if (route === `${pr}/commits`) return page(data.commits);
  if (route === `${pr}/changes`) return page(data.whole.changes);
  if (route.startsWith(`${pr}/diff/`)) return diffOf(data.whole, route.slice(`${pr}/diff/`.length), data.base, data.tip);

  const pair = data.compare[`${query.get('from')}|${query.get('to')}`];
  if (route === 'compare/changes') return page(pair?.changes || []);
  if (route.startsWith('compare/diff/')) return diffOf(pair, route.slice('compare/diff/'.length), query.get('to'), query.get('from'));

  // How a real server's Diff tab loads the PR's whole diff.
  if (/^commits\/[0-9a-f]+\/changes$/.test(route)) return page(data.whole.changes);
  const commitDiff = route.match(/^commits\/[0-9a-f]+\/diff\/(.+)$/);
  if (commitDiff) return diffOf(data.whole, commitDiff[1], data.base, data.tip);
  return null;
}

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  const at = url.pathname.indexOf(REPO_API);
  if (url.origin !== self.location.origin || at < 0) return;
  const route = decodeURIComponent(url.pathname.slice(at + REPO_API.length));
  event.respondWith(
    answer(route, url.searchParams).then((body) =>
      new Response(JSON.stringify(body ?? { errors: [{ message: 'Not found in the demo' }] }), {
        status: body ? 200 : 404,
        headers: { 'Content-Type': 'application/json' },
      })
    )
  );
});
