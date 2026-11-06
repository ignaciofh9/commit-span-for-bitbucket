const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
require('../src/http.js');
const { matchPr, loadPr, compareUrl } = require('../src/cloud.js');
const dc = require('../src/datacenter.js');
const { commitLabel, spanMenuLabel, nextSpan, spanRange, hashesInRow, commitForRow } = require('../src/options.js');
const { planFile, filterDiffResponse, filterChanges, storageKey } = require('../src/spanFilter.js');
const { filterFile, loadSpan, prepareSpan } = require('../src/authorDiff.js');

const pr = { workspace: 'team', repo: 'app', id: '7', key: 'cloud/team/app/7' };
const commit = (hash, message = 'Subject\n\nBody') => ({
  hash,
  date: '2026-11-03T15:48:48+00:00',
  message,
  author: { raw: 'Sam <sam@example.com>', user: { display_name: 'Sam Lee' } },
});

function fakeFetch(routes) {
  const calls = [];
  const fetchFn = async (url) => {
    calls.push(url);
    const route = routes.find(([match]) => url.includes(match));
    if (!route) throw new TypeError('Failed to fetch');
    const [, status, body] = route;
    return { ok: status < 400, status, json: async () => body };
  };
  return { fetchFn, calls };
}

test('matchPr finds PR pages and their tabs only', () => {
  const base = 'https://bitbucket.org/team/app/pull-requests';
  for (const href of [`${base}/7`, `${base}/7/`, `${base}/7/diff`, `${base}/7/some-title/diff#chg`, `${base}/7?w=1`]) {
    assert.deepEqual(matchPr(href), pr, href);
  }
  for (const href of [
    base,
    `${base}/`,
    `${base}/new`,
    'https://bitbucket.org/team/app/commits/abc',
    'https://bitbucket.example.com/team/app/pull-requests/7',
  ]) {
    assert.equal(matchPr(href), null, href);
  }
});

test('compareUrl puts the newer commit first', () => {
  assert.equal(compareUrl(pr, 'old', 'new'), '/team/app/branches/compare/new..old#diff');
});

test('loadPr follows pagination and returns the base hash', async () => {
  const next = 'https://bitbucket.org/!api/2.0/repositories/team/app/pullrequests/7/commits?page=abc';
  const { fetchFn, calls } = fakeFetch([
    ['page=abc', 200, { values: [commit('c1')] }],
    ['/commits?', 200, { values: [commit('c3'), commit('c2')], next }],
    ['/pullrequests/7?', 200, { destination: { commit: { hash: 'base' } } }],
  ]);
  const { commits, baseHash } = await loadPr(pr, fetchFn);
  assert.deepEqual(commits.map((c) => c.hash), ['c3', 'c2', 'c1']);
  assert.equal(baseHash, 'base');
  assert.ok(calls.every((url) => url.startsWith('/!api/2.0/') || url === next));
});

test('loadPr gives a readable error when Bitbucket refuses or is unreachable', async () => {
  const denied = fakeFetch([['/pullrequests/7', 403, {}]]);
  await assert.rejects(loadPr(pr, denied.fetchFn), /HTTP 403.*signed in/);
  const offline = fakeFetch([]);
  await assert.rejects(loadPr(pr, offline.fetchFn), /Could not read this PR.*signed in/);
});

test('Data Center matchPr finds PR pages, personal repos and path prefixes', () => {
  const host = 'https://git.example.com';
  const pr = dc.matchPr(`${host}/projects/KEY/repos/app/pull-requests/7/commits`);
  assert.equal(pr.project, 'KEY');
  assert.equal(pr.repo, 'app');
  assert.equal(pr.id, '7');
  assert.equal(dc.matchPr(`${host}/users/sam/repos/app/pull-requests/7/diff`).project, '~sam');
  assert.equal(dc.matchPr(`${host}/bitbucket/projects/KEY/repos/app/pull-requests/7`).prefix, '/bitbucket');
  for (const path of ['/projects/KEY/repos/app/pull-requests', '/projects/KEY/repos/app/commits', '/team/app/pull-requests/7']) {
    assert.equal(dc.matchPr(host + path), null, path);
  }
});

test('Data Center compareUrl uses the newer commit as the source', () => {
  const pr = dc.matchPr('https://git.example.com/projects/KEY/repos/app/pull-requests/7');
  assert.equal(dc.compareUrl(pr, 'old', 'new'), '/projects/KEY/repos/app/compare/diff?sourceBranch=new&targetBranch=old');
  const mine = dc.matchPr('https://git.example.com/users/sam/repos/app/pull-requests/7');
  assert.equal(dc.compareUrl(mine, 'old', 'new'), '/users/sam/repos/app/compare/diff?sourceBranch=new&targetBranch=old');
});

test('Data Center loadPr follows paging and converts commits', async () => {
  const pr = dc.matchPr('https://git.example.com/projects/KEY/repos/app/pull-requests/7');
  const raw = (id) => ({ id, message: 'Subject', authorTimestamp: 1762185600000, author: { name: 'sam', displayName: 'Sam Lee' } });
  const { fetchFn, calls } = fakeFetch([
    ['start=2', 200, { values: [raw('c1')], isLastPage: true }],
    ['start=0', 200, { values: [raw('c3'), raw('c2')], isLastPage: false, nextPageStart: 2 }],
    ['/pull-requests/7', 200, { toRef: { latestCommit: 'base' } }],
  ]);
  const { commits, baseHash } = await dc.loadPr(pr, fetchFn);
  assert.deepEqual(commits.map((c) => c.hash), ['c3', 'c2', 'c1']);
  assert.equal(baseHash, 'base');
  assert.equal(calls[0], '/rest/api/latest/projects/KEY/repos/app/pull-requests/7');
  assert.equal(commitLabel(commits[0]), 'c3 · Subject · Sam Lee · 2025-11-03');
});

test('commitLabel uses the first line, and drops any email address', () => {
  assert.equal(commitLabel(commit('abcdef1234')), 'abcdef1 · Subject · Sam Lee · 2026-11-03');
  const raw = { hash: 'abcdef1234', message: 'x', author: { raw: 'Sam <sam@example.com>' } };
  assert.equal(commitLabel(raw), 'abcdef1 · x · Sam');
});

test('nextSpan: ticking builds a span, and never silently restarts it', () => {
  assert.deepEqual(nextSpan(null, 3), { newest: 3, oldest: 3 }, 'first tick');
  assert.deepEqual(nextSpan({ newest: 3, oldest: 3 }, 1), { newest: 1, oldest: 3 }, 'tick a newer commit');
  assert.deepEqual(nextSpan({ newest: 3, oldest: 3 }, 5), { newest: 3, oldest: 5 }, 'tick an older commit');
  assert.deepEqual(nextSpan({ newest: 1, oldest: 3 }, 0), { newest: 0, oldest: 3 }, 'extend newer');
  assert.deepEqual(nextSpan({ newest: 1, oldest: 3 }, 6), { newest: 1, oldest: 6 }, 'extend older');
});

test('nextSpan: unticking trims a span', () => {
  assert.equal(nextSpan({ newest: 3, oldest: 3 }, 3), null, 'untick the only commit');
  assert.deepEqual(nextSpan({ newest: 1, oldest: 3 }, 3), { newest: 1, oldest: 2 }, 'untick the oldest');
  assert.deepEqual(nextSpan({ newest: 1, oldest: 3 }, 1), { newest: 2, oldest: 3 }, 'untick the newest');
  assert.deepEqual(nextSpan({ newest: 1, oldest: 4 }, 2), { newest: 2, oldest: 4 }, 'a middle commit becomes the newest');
});

test('spanMenuLabel names the span and how much of the PR it covers', () => {
  const plan = { first: 'aaaaaaa111', last: 'bbbbbbb222', count: 3 };
  assert.deepEqual(spanMenuLabel(plan, '12 commits'), { title: 'Commits aaaaaaa to bbbbbbb', subtitle: '3 of 12 commits' });
  assert.deepEqual(spanMenuLabel({ ...plan, last: plan.first, count: 1 }, '12 commits'), { title: 'Commit aaaaaaa', subtitle: '1 of 12 commits' });
  assert.equal(spanMenuLabel({ ...plan, count: 1 }, '').subtitle, '1 commit');
  assert.equal(spanMenuLabel({ first: 'a', last: 'b' }, '12 commits').subtitle, '12 commits', 'older saved spans have no count');
});

test('hashesInRow spots commit rows without needing the commit list', () => {
  assert.deepEqual(hashesInRow(['/projects/K/repos/R/commits/abcdef01234'], ['Sam']), ['abcdef01234']);
  assert.deepEqual(hashesInRow([], ['Sam', 'abcdef01234', 'message']), ['abcdef01234']);
  assert.deepEqual(hashesInRow(['/users/sam'], ['Author', 'Commit', 'Message']), []);
});

const history = [
  { ...commit('c4'), parents: ['c3'] },
  { ...commit('c3'), parents: ['c2'] },
  { ...commit('c2'), parents: ['c1'] },
  { ...commit('c1'), parents: ['old-base'] },
];

test('a span from the first commit compares against the target branch', () => {
  const range = spanRange(history, 'target', 'c1', 'c3');
  assert.equal(range.from, 'target');
  assert.equal(range.to, 'c3');
});

test('a later span compares against the commit just before it', () => {
  const range = spanRange(history, 'target', 'c3', 'c4');
  assert.equal(range.from, 'c2');
  assert.equal(range.to, 'c4');
});

test('a single commit is a span, and ends can be given in either order', () => {
  assert.deepEqual([spanRange(history, 'target', 'c2', 'c2').from, spanRange(history, 'target', 'c2', 'c2').to], ['c1', 'c2']);
  const reversed = spanRange(history, 'target', 'c4', 'c2');
  assert.deepEqual([reversed.first, reversed.last, reversed.from, reversed.to], ['c2', 'c4', 'c1', 'c4']);
});

test('a span from the first commit falls back to its parent without a target', () => {
  assert.equal(spanRange(history, null, 'c1', 'c4').from, 'old-base');
});

test('incoming lists what merges in a later span brought in', () => {
  const merged = [{ ...commit('c3'), parents: ['c2', 'x'] }, { ...commit('c2'), parents: ['c1'] }, { ...commit('c1'), parents: ['b'] }];
  assert.deepEqual(spanRange(merged, 'target', 'c2', 'c3').incoming, ['x']);
  assert.deepEqual(spanRange(merged, 'target', 'c2', 'c2').incoming, []);
});

test('a span against the target needs no filtering', () => {
  const merged = [{ ...commit('c2'), parents: ['c1', 'x'] }, { ...commit('c1'), parents: ['b'] }];
  assert.deepEqual(spanRange(merged, 'target', 'c1', 'c2').incoming, []);
  assert.deepEqual(spanRange(merged, null, 'c1', 'c2').incoming, ['x']);
});

test("merging one of the PR's own commits isn't treated as incoming", () => {
  const own = [{ ...commit('m'), parents: ['c2', 'side'] }, { ...commit('side'), parents: ['c1'] }, { ...commit('c2'), parents: ['c1'] }, { ...commit('c1'), parents: ['b'] }];
  assert.deepEqual(spanRange(own, 'target', 'c2', 'm').incoming, []);
});

const context = (text) => ({ type: 'CONTEXT', text });
const added = (text) => ({ type: 'ADDED', text });
const removed = (text) => ({ type: 'REMOVED', text });
const diffOf = (...hunks) => ({ hunks: hunks.map((rows) => ({ rows })) });

test('filterFile hides a change only when a merge made exactly that change', () => {
  const span = diffOf(
    [context('a'), removed('merged old'), added('merged new'), context('b')],
    [context('c'), added('author line'), context('d')]
  );
  const merge = diffOf([context('x'), removed('merged old'), added('merged new'), context('y')]);
  const out = filterFile(span, [merge]);
  assert.equal(out.hiddenLines, 2);
  assert.equal(out.hiddenWhole, false);
  assert.equal(out.hunks.length, 1, 'the merge-only hunk goes');
  assert.deepEqual(out.hunks[0].rows.map((row) => row.text), ['c', 'author line', 'd']);
  assert.deepEqual([out.added, out.removed], [1, 0]);
});

test('filterFile keeps a conflict resolution, and flags it if it mostly matches a merge', () => {
  const span = diffOf([removed('old'), added('resolved by author')]);
  const merge = diffOf([removed('old'), added('from target')]);
  const out = filterFile(span, [merge]);
  assert.equal(out.hiddenLines, 0);
  assert.deepEqual(out.hunks[0].rows.map((row) => row.type), ['OVERLAP', 'REMOVED', 'ADDED']);
});

test('filterFile keeps an author line next to merged lines', () => {
  const span = diffOf([added('merged'), added('author')]);
  const out = filterFile(span, [diffOf([added('merged')])]);
  assert.equal(out.hiddenLines, 0);
  assert.deepEqual(out.hunks[0].rows.filter((row) => row.text).map((row) => row.text), ['merged', 'author']);
});

test("filterFile doesn't flag lines that only share punctuation", () => {
  const out = filterFile(diffOf([added('}')]), [diffOf([added('}'), added('other')])]);
  assert.equal(out.overlaps, 0);
  assert.equal(out.hiddenLines, 0);
});

test('filterFile marks a file hidden when all of it came from merges', () => {
  const change = [removed('old'), added('new')];
  const out = filterFile(diffOf(change), [diffOf(change)]);
  assert.equal(out.hiddenWhole, true);
  assert.equal(filterFile(diffOf(change), []).hiddenWhole, false);
});

test('loadSpan only fetches merge diffs for files both touched', async () => {
  const requested = [];
  const provider = {
    listChanges: async (_, newer) => (newer === 'merged' ? [{ path: 'both.js' }, { path: 'target-only.js' }] : [{ path: 'both.js' }, { path: 'author.js' }]),
    fileDiff: async (_, newer, older, change) => {
      requested.push(`${newer}:${change.path}`);
      return diffOf([added(newer === 'merged' ? 'merged' : 'merged')]);
    },
  };
  const files = {};
  let planned;
  await loadSpan(provider, pr, { from: 'S', to: 'E', incoming: ['merged'] }, {
    onPlan: (list) => { planned = list.map((change) => change.path); },
    onFile: (index, result) => { files[planned[index]] = result; },
  });
  assert.deepEqual(planned, ['both.js', 'author.js']);
  assert.deepEqual(requested.sort(), ['E:author.js', 'E:both.js', 'merged:both.js']);
  assert.equal(files['both.js'].hiddenWhole, true);
  assert.equal(files['author.js'].hiddenWhole, false);
});

test('a file that fails to load is reported, not hidden', async () => {
  const provider = {
    listChanges: async () => [{ path: 'a.js' }],
    fileDiff: async () => { throw new Error('nope'); },
  };
  let out;
  await loadSpan(provider, pr, { from: 'S', to: 'E', incoming: [] }, { onPlan() {}, onFile: (_, result) => { out = result; } });
  assert.equal(out.error, 'nope');
});

const rawLine = (line, source, destination, extra = {}) => ({ line, source, destination, ...extra });

test('filterDiffResponse keeps span changes, with real line numbers and valid hunks', () => {
  const hunk = {
    context: 'fn',
    segments: [
      { type: 'CONTEXT', lines: [rawLine('a', 10, 10)] },
      { type: 'ADDED', lines: [rawLine('earlier commit', 11, 11)] },
      { type: 'CONTEXT', lines: [rawLine('b', 11, 12)] },
      { type: 'REMOVED', lines: [rawLine('old', 12, 13)] },
      { type: 'ADDED', lines: [rawLine('span line', 13, 13, { commentIds: [5] })] },
      { type: 'CONTEXT', lines: [rawLine('c', 13, 14)] },
    ],
  };
  const out = filterDiffResponse(
    { fromHash: 'f', toHash: 't', diffs: [{ hunks: [hunk], lineComments: [{ id: 5 }, { id: 6 }] }] },
    { keys: ['ADDED span line', 'REMOVED old'] }
  );
  assert.equal(out.fromHash, 'f', 'hashes stay, so comments anchor to the same diff');
  const [diff] = out.diffs;
  assert.equal(diff.hunks.length, 1);
  const [kept] = diff.hunks;
  assert.deepEqual(kept.segments.map((s) => [s.type, s.lines.map((l) => l.line)]), [
    ['CONTEXT', ['b']],
    ['REMOVED', ['old']],
    ['ADDED', ['span line']],
    ['CONTEXT', ['c']],
  ]);
  assert.deepEqual([kept.sourceLine, kept.destinationLine, kept.sourceSpan, kept.destinationSpan], [11, 12, 3, 3]);
  assert.equal(kept.context, 'fn');
  assert.deepEqual(diff.lineComments, [{ id: 5 }]);
  assert.equal(kept.segments[2].lines[0].destination, 13, 'line number untouched');
});

test("filterDiffResponse doesn't keep a block for sharing only punctuation", () => {
  const hunk = { segments: [{ type: 'ADDED', lines: [rawLine('}', 1, 1), rawLine('real', 1, 2)] }] };
  assert.equal(filterDiffResponse({ hunks: [hunk] }, { keys: ['ADDED }'] }).hunks.length, 0);
  const onlyPunctuation = { segments: [{ type: 'ADDED', lines: [rawLine('}', 1, 1)] }] };
  assert.equal(filterDiffResponse({ hunks: [onlyPunctuation] }, { keys: ['ADDED }'] }).hunks.length, 1);
});

test('filterDiffResponse leaves files marked all alone, and empties unknown files', () => {
  const data = { diffs: [{ hunks: [{ segments: [{ type: 'ADDED', lines: [rawLine('x', 1, 1)] }] }] }] };
  assert.deepEqual(filterDiffResponse(data, { all: true }), data);
  assert.equal(filterDiffResponse(data, undefined).diffs[0].hunks.length, 0);
});

test('filterChanges keeps only span files, from either path format', () => {
  const data = { values: [{ path: { components: ['a', 'b.js'] } }, { path: { toString: 'c.js' } }, { path: { components: ['d.js'] } }], size: 3, isLastPage: true };
  const out = filterChanges(data, { files: { 'a/b.js': {}, 'c.js': {} } });
  assert.equal(out.values.length, 2);
  assert.equal(out.size, 2);
  assert.equal(out.isLastPage, true);
});

test('planFile counts span lines that are no longer in the PR', () => {
  const spanResult = { hunks: [{ rows: [added('kept'), context('c')] }, { rows: [added('rewritten later')] }] };
  const prDiff = { hunks: [{ rows: [added('kept')] }, { rows: [added('other commit')] }] };
  const out = planFile(spanResult, prDiff);
  assert.equal(out.kept, true);
  assert.equal(out.gone, 1);
  assert.equal(planFile({ hunks: [{ rows: [added('gone')] }] }, prDiff).kept, false);
  assert.equal(planFile({ error: 'x' }, prDiff).all, true);
  assert.equal(planFile({ hunks: [], binary: true }, { hunks: [] }).all, true);
});

test('storageKey works from any tab of a PR, and only on PR pages', () => {
  const key = 'bpd-span:/projects/K/repos/R/pull-requests/7';
  assert.equal(storageKey('/projects/K/repos/R/pull-requests/7/diff'), key);
  assert.equal(storageKey('/projects/K/repos/R/pull-requests/7'), key);
  assert.equal(storageKey('/projects/K/repos/R/browse'), null);
});

test('prepareSpan skips merge-only files and reports files gone from the PR', async () => {
  const diffs = {
    'author.js': [added('author')],
    'merge.js': [added('merged')],
    'gone.js': [added('reverted later')],
    'broken.js': [added('x')],
  };
  const provider = {
    prChanges: async () => [{ path: 'author.js' }, { path: 'broken.js' }],
    listChanges: async (_, newer) => (newer === 'in' ? [{ path: 'merge.js' }] : Object.keys(diffs).map((path) => ({ path }))),
    fileDiff: async (_, newer, older, change) => diffOf(diffs[change.path]),
    prFileDiff: async (_, change) => {
      if (change.path === 'broken.js') throw new Error('nope');
      return diffOf(diffs[change.path]);
    },
  };
  const plan = await prepareSpan(provider, pr, { from: 'S', to: 'E', first: 'a', last: 'b', incoming: ['in'] });
  assert.deepEqual(Object.keys(plan.files).sort(), ['author.js', 'broken.js']);
  assert.deepEqual(plan.files['author.js'].keys, ['ADDED author']);
  assert.equal(plan.files['broken.js'].all, true, 'kept unfiltered when it cannot be checked');
  assert.deepEqual(plan.notShown, ['gone.js'], 'merge.js is not reported, because it was never the author work');
});

function runHook(pathname, storedPlan) {
  class FakeXhr {
    open() {}
    get responseText() { return this.body; }
    get response() { return this.body; }
  }
  const attributes = {};
  const context = vm.createContext({
    XMLHttpRequest: FakeXhr,
    URL,
    Response,
    JSON,
    Object,
    String,
    Promise,
    WeakMap,
    location: { pathname, href: `https://git.example.com${pathname}` },
    sessionStorage: { getItem: () => (storedPlan ? JSON.stringify(storedPlan) : null) },
    document: { documentElement: { setAttribute: (name, value) => { attributes[name] = value; } } },
    fetch: async () => new Response(JSON.stringify({ values: [{ path: { components: ['a.js'] } }, { path: { components: ['b.js'] } }] })),
  });
  context.window = context;
  context.globalThis = context;
  for (const file of ['spanFilter.js', 'pageHook.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '../src', file), 'utf8'), context);
  return { context, FakeXhr, attributes };
}

const API_BASE = '/rest/api/latest/projects/K/repos/R/pull-requests/7';
const DIFF_BODY = JSON.stringify({ diffs: [{ hunks: [{ segments: [{ type: 'ADDED', lines: [rawLine('span', 1, 1)] }] }, { segments: [{ type: 'ADDED', lines: [rawLine('other', 9, 9)] }] }] }] });
const planForHook = { files: { 'a.js': { keys: ['ADDED span'] } } };

function xhrGet(hook, url, method = 'GET') {
  const xhr = new hook.FakeXhr();
  xhr.open(method, url);
  Object.assign(xhr, { body: DIFF_BODY, readyState: 4, status: 200, responseType: '' });
  return xhr;
}

test('the page hook filters XHR diffs while a span is active', () => {
  const hook = runHook('/projects/K/repos/R/pull-requests/7/diff', planForHook);
  const xhr = xhrGet(hook, `${API_BASE}/diff/a.js?diffType=EFFECTIVE&sinceId=x&untilId=y`);
  const out = JSON.parse(xhr.responseText);
  assert.equal(out.diffs[0].hunks.length, 1);
  assert.equal(out.diffs[0].hunks[0].segments[0].lines[0].line, 'span');
  assert.equal(JSON.parse(xhr.response).diffs[0].hunks.length, 1);
  assert.equal(hook.attributes['data-bpd-diff'], 'filtered');
});

test('the page hook filters fetch responses too', async () => {
  const hook = runHook('/projects/K/repos/R/pull-requests/7/diff', planForHook);
  const response = await hook.context.window.fetch(`${API_BASE}/changes?changeScope=ALL`);
  const out = await response.json();
  assert.deepEqual(out.values.map((v) => v.path.components[0]), ['a.js']);
  assert.equal(hook.attributes['data-bpd-changes'], 'filtered');
});

test('the page hook leaves everything else alone', () => {
  const cases = [
    ['no span', '/projects/K/repos/R/pull-requests/7/diff', null, `${API_BASE}/diff/a.js`],
    ['other tab', '/projects/K/repos/R/pull-requests/7/overview', planForHook, `${API_BASE}/diff/a.js`],
    ['commit view', '/projects/K/repos/R/pull-requests/7/commits/abc', planForHook, `${API_BASE}/diff/a.js`],
    ['commit in Diff menu', '/projects/K/repos/R/pull-requests/7/diff', planForHook, `${API_BASE}/diff/a.js?diffType=COMMIT&sinceId=x&untilId=y`],
    ['range in Diff menu', '/projects/K/repos/R/pull-requests/7/diff', planForHook, `${API_BASE}/diff/a.js?diffType=RANGE&sinceId=x&untilId=y`],
    ['other PR', '/projects/K/repos/R/pull-requests/7/diff', planForHook, '/rest/api/latest/projects/K/repos/R/pull-requests/8/diff/a.js'],
    ['other endpoint', '/projects/K/repos/R/pull-requests/7/diff', planForHook, `${API_BASE}/comments`],
  ];
  for (const [name, pathname, plan, url] of cases) {
    const hook = runHook(pathname, plan);
    assert.equal(xhrGet(hook, url).responseText, DIFF_BODY, name);
  }
  const posted = runHook('/projects/K/repos/R/pull-requests/7/diff', planForHook);
  assert.equal(xhrGet(posted, `${API_BASE}/diff/a.js`, 'POST').responseText, DIFF_BODY, 'only GETs');
});

test('the page hook filters whole-PR requests that carry hashes but no diff type', () => {
  const hook = runHook('/projects/K/repos/R/pull-requests/7/diff', planForHook);
  const out = JSON.parse(xhrGet(hook, `${API_BASE}/diff/a.js?sinceId=x&untilId=y`).responseText);
  assert.equal(out.diffs[0].hunks.length, 1);
  assert.equal(hook.attributes['data-bpd-diff'], 'filtered');
});

test("the page hook filters the commits endpoint a real server's Diff tab uses", async () => {
  const COMMITS_BASE = '/rest/api/latest/projects/K/repos/R/commits/abcdef1234567';
  const hook = runHook('/projects/K/repos/R/pull-requests/7/diff', planForHook);
  const xhr = xhrGet(hook, `${COMMITS_BASE}/diff/a.js?contextLines=10&since=1234abcdef&whitespace=&withComments=true`);
  assert.equal(JSON.parse(xhr.responseText).diffs[0].hunks.length, 1);
  assert.equal(hook.attributes['data-bpd-diff'], 'filtered');
  const response = await hook.context.window.fetch(`${COMMITS_BASE}/changes?since=1234abcdef`);
  assert.deepEqual((await response.json()).values.map((v) => v.path.components[0]), ['a.js']);
  assert.equal(hook.attributes['data-bpd-changes'], 'filtered');
});

test('the page hook filters the file list for reviewers, but not a chosen range', async () => {
  const hook = runHook('/projects/K/repos/R/pull-requests/7/diff', planForHook);
  const unreviewed = await hook.context.window.fetch(`${API_BASE}/changes?changeScope=UNREVIEWED`);
  assert.equal((await unreviewed.json()).values.length, 1);
  const range = await hook.context.window.fetch(`${API_BASE}/changes?changeScope=RANGE&sinceId=x&untilId=y`);
  assert.equal((await range.json()).values.length, 2);
});

test('the page hook leaves a single commit alone', () => {
  const hook = runHook('/projects/K/repos/R/pull-requests/7/diff', planForHook);
  assert.equal(xhrGet(hook, '/rest/api/latest/projects/K/repos/R/commits/abcdef1234567/diff/a.js?withComments=true').responseText, DIFF_BODY);
  assert.equal(hook.attributes['data-bpd-diff'], undefined);
});

test('the page hook reports skipped requests without any content', () => {
  const hook = runHook('/projects/K/repos/R/pull-requests/7/diff', planForHook);
  xhrGet(hook, `${API_BASE}/diff/secret/a.js?diffType=COMMIT&sinceId=abcdef1234&untilId=1234abcdef`);
  assert.equal(hook.attributes['data-bpd-skipped-diff'], 'api/latest/*/pr/diff?diffType=COMMIT&sinceId&untilId');
  xhrGet(hook, '/rest/api/latest/projects/K/repos/R/commits/abcdef1234567/diff/secret/a.js?whitespace=');
  assert.equal(hook.attributes['data-bpd-skipped-diff'], 'api/latest/*/commits/hash/diff?whitespace');
  xhrGet(hook, '/rest/api/latest/projects/K/repos/R/commits/abcdef1234567/changes');
  assert.equal(hook.attributes['data-bpd-skipped-changes'], 'api/latest/*/commits/hash/changes?');
});

test("a problem in the page hook doesn't break Bitbucket's request", () => {
  const hook = runHook('/projects/K/repos/R/pull-requests/7/diff', planForHook);
  assert.equal(xhrGet(hook, `${API_BASE}/diff/100%.js`).responseText, DIFF_BODY);
});

test('merge conflict markers stay visible in a file the span touched', () => {
  const hunk = { segments: [
    { type: 'ADDED', lines: [rawLine('<<<<<<< target', 1, 1, { conflictMarker: 'MARKER' })] },
    { type: 'CONTEXT', lines: [rawLine('a', 1, 2)] },
    { type: 'ADDED', lines: [rawLine('unrelated change', 2, 3)] },
  ] };
  const out = filterDiffResponse({ hunks: [hunk] }, { keys: ['ADDED something else'] });
  const lines = out.hunks.flatMap((h) => h.segments.flatMap((s) => s.lines.map((l) => l.line)));
  assert.ok(lines.includes('<<<<<<< target'));
  assert.ok(!lines.includes('unrelated change'));
  const file = planFile({ hunks: [{ rows: [added('gone')] }] }, { hunks: [{ rows: [{ ...added('<<<<<<< target'), conflict: 'MARKER' }] }] });
  assert.equal(file.kept, true);
});

test('the page hook returns the original text if it cannot parse a response', () => {
  const hook = runHook('/projects/K/repos/R/pull-requests/7/diff', planForHook);
  const xhr = xhrGet(hook, `${API_BASE}/diff/a.js`);
  xhr.body = 'not json';
  assert.equal(xhr.responseText, 'not json');
  assert.equal(hook.attributes['data-bpd-diff'], undefined);
  assert.equal(hook.attributes['data-bpd-error'], 'SyntaxError');
});

test('Data Center listChanges and fileDiff read the spec shapes', async () => {
  const dcPr = dc.matchPr('https://git.example.com/projects/KEY/repos/app/pull-requests/7');
  const page = { isLastPage: true, values: [{ path: { components: ['src', 'a b.js'] }, srcPath: { components: ['src', 'old.js'] }, type: 'MOVE' }] };
  const hunk = { segments: [{ type: 'REMOVED', lines: [{ line: 'x', source: 4, destination: 4 }] }, { type: 'ADDED', lines: [{ line: 'y', source: 5, destination: 4 }], truncated: true }] };
  for (const body of [{ hunks: [hunk] }, { diffs: [{ hunks: [hunk] }] }]) {
    const { fetchFn, calls } = fakeFetch([['/compare/changes', 200, page], ['/compare/diff/', 200, body]]);
    const [change] = await dc.listChanges(dcPr, 'new', 'old', fetchFn);
    assert.deepEqual(change, { path: 'src/a b.js', srcPath: 'src/old.js', type: 'MOVE' });
    const diff = await dc.fileDiff(dcPr, 'new', 'old', change, fetchFn);
    assert.deepEqual(diff.hunks[0].rows.map((row) => [row.type, row.text]), [['REMOVED', 'x'], ['ADDED', 'y']]);
    assert.equal(diff.truncated, true);
    assert.equal(calls[1], '/rest/api/latest/projects/KEY/repos/app/compare/diff/src/a%20b.js?from=new&to=old&contextLines=3&srcPath=src%2Fold.js');
  }
});

test('commitForRow finds commits from links or a hash cell, and ignores other rows', () => {
  const list = [{ hash: 'abcdef0123456789' }, { hash: '0123456abcdef000' }];
  assert.equal(commitForRow(list, ['/projects/K/repos/R/commits/abcdef0123456789'], []), list[0]);
  assert.equal(commitForRow(list, ['/projects/K/repos/R/pull-requests/7/commits/0123456abcd#x'], []), list[1]);
  assert.equal(commitForRow(list, [], ['Sam', '0123456abcd', 'message']), list[1]);
  assert.equal(commitForRow(list, ['/projects/K/repos/R/commits/fffffffffff'], ['Author', 'Commit']), null);
  assert.equal(commitForRow(list, [], ['Author', 'Commit', 'Message']), null);
});
