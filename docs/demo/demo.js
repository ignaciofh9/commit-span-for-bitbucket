// A small stand-in for a Bitbucket pull request page, so Commit Span for Bitbucket can be
// tried without a server. All content goes in as text. sw.js answers the API requests.
(async function () {
  const base = location.pathname.split('/projects/')[0];

  if (!navigator.serviceWorker.controller) {
    const reload = () => location.reload();
    navigator.serviceWorker.addEventListener('controllerchange', reload, { once: true });
    await navigator.serviceWorker.register(`${base}/sw.js`, { scope: `${base}/` });
    return;
  }

  // Answers the extension's data requests. POST, because the extension must see the real
  // data here, and it only narrows the GETs that this page's own viewer makes.
  window.addEventListener('message', async (event) => {
    if (event.source !== window || event.data?.type !== 'bpd-demo-request') return;
    const { id, url } = event.data;
    const response = await fetch(url, { method: 'POST' });
    window.postMessage({ type: 'bpd-demo-reply', id, status: response.status, body: await response.text() }, location.origin);
  });

  const API = `${base}/rest/api/latest/projects/DEMO/repos/invoice-service`;
  const pageType = location.pathname.includes('/commits') ? 'Commits' : 'Diff';
  const prPath = `${base}/projects/DEMO/repos/invoice-service/pull-requests/1`;

  function el(tag, props = {}, ...children) {
    const node = Object.assign(document.createElement(tag), props);
    node.append(...children);
    return node;
  }

  const getJson = async (url) => (await fetch(url)).json();
  const pr = await getJson(`${API}/pull-requests/1`);
  const { values: commits } = await getJson(`${API}/pull-requests/1/commits?limit=100&start=0`);
  const when = (commit) => new Date(commit.authorTimestamp).toISOString().slice(0, 10);

  const help = el('p', { id: 'help' });
  const notice = el(
    'div',
    { className: 'notice' },
    el('strong', { textContent: 'Demo page for testing Commit Span for Bitbucket. ' }),
    "This isn't Bitbucket: it's a stand-in with a made-up pull request, and nothing here is saved. ",
    help
  );

  function tabs() {
    const list = el('ul', { className: 'tabs' });
    for (const label of ['Overview', 'Diff', 'Commits', 'Builds']) {
      const href = { Diff: `${prPath}/diff/`, Commits: `${prPath}/commits/` }[label] || '#';
      const link = el('a', { href, textContent: label });
      if (href === '#') link.addEventListener('click', (event) => event.preventDefault());
      list.append(el('li', { className: label === pageType ? 'active' : '' }, link));
    }
    return list;
  }

  const commitHref = (commit) => `${prPath}/commits/${commit.id}`;
  const inert = (event) => event.preventDefault();

  function commitsPage() {
    help.textContent = 'Tick two commits in the table, then click Review in Diff tab in the bar that appears.';
    const body = el('tbody');
    for (const commit of commits) {
      body.append(
        el(
          'tr',
          {},
          el('td', { textContent: commit.author.displayName }),
          el('td', {}, Object.assign(el('a', { href: commitHref(commit), className: 'hash', textContent: commit.displayId }), { onclick: inert })),
          el('td', {}, commit.parents.length > 1 ? el('span', { className: 'badge', textContent: 'M' }) : '', ` ${commit.message}`),
          el('td', { textContent: when(commit) })
        )
      );
    }
    const head = el('tr', {}, ...['Author', 'Commit', 'Message', 'Commit date'].map((textContent) => el('th', { textContent })));
    return el('table', { className: 'commits' }, el('thead', {}, head), body);
  }

  function menuRow({ title, meta, commit, selected }) {
    const label = el(
      'div',
      { className: 'commit-option-label' },
      el('div', { className: 'message-wrapper', textContent: title }),
      el('div', { className: 'meta' }, ...meta)
    );
    const inner = commit ? el('a', { href: commitHref(commit), onclick: inert }, label) : el('div', {}, label);
    return el('div', { className: `menu-row${selected ? ' selected' : ''}` }, el('div', { className: 'menu-option' }, inner));
  }

  function diffPage() {
    help.textContent = 'Open the menu above the file list, tick two commits, then click Review in Diff tab in the bar that appears. Only the changes those commits made stay on the page.';
    const countText = `${commits.length} commits`;
    const trigger = el(
      'button',
      { className: 'trigger', type: 'button' },
      el('span', { className: 'trigger-title', textContent: 'All changes in this pull request' }),
      el('span', { className: 'trigger-sub', textContent: countText })
    );
    const menu = el('div', { className: 'menu', hidden: true });

    function openMenu() {
      const rows = [menuRow({ title: 'All changes in this pull request', meta: [countText], selected: true })];
      for (const commit of commits) {
        const meta = [`${commit.author.displayName} committed `, el('code', { textContent: commit.displayId })];
        if (commit.parents.length > 1) meta.push(' ', el('span', { className: 'badge', textContent: 'M' }));
        meta.push(` ${when(commit)}`);
        rows.push(menuRow({ title: commit.message, meta, commit }));
      }
      menu.replaceChildren(el('div', { className: 'menu-list' }, ...rows));
      menu.hidden = false;
    }

    trigger.addEventListener('click', () => (menu.hidden ? openMenu() : (menu.hidden = true)));
    document.addEventListener('click', (event) => {
      if (!menu.hidden && !trigger.contains(event.target)) menu.hidden = true;
    });

    const files = el('div', { className: 'files' });
    const viewer = el('div', { className: 'viewer' });

    function renderDiff(path, data) {
      const rows = [];
      (data.diffs?.[0]?.hunks || []).forEach((hunk, index) => {
        if (index) rows.push(el('tr', { className: 'gap' }, el('td', { colSpan: 3, textContent: '⋯' })));
        for (const segment of hunk.segments) {
          for (const line of segment.lines) {
            rows.push(
              el(
                'tr',
                { className: segment.type },
                el('td', { className: 'num', textContent: segment.type === 'ADDED' ? '' : line.source }),
                el('td', { className: 'num', textContent: segment.type === 'REMOVED' ? '' : line.destination }),
                el('td', { className: 'code', textContent: `${{ ADDED: '+', REMOVED: '-', CONTEXT: ' ' }[segment.type]} ${line.line}` })
              )
            );
          }
        }
      });
      viewer.replaceChildren(el('div', { className: 'file-name', textContent: path }), el('table', { className: 'diff' }, el('tbody', {}, ...rows)));
    }

    async function showFile(path) {
      const encoded = path.split('/').map(encodeURIComponent).join('/');
      renderDiff(path, await getJson(`${API}/commits/${pr.fromRef.latestCommit}/diff/${encoded}?contextLines=10&since=${pr.toRef.latestCommit}&whitespace=&withComments=true`));
    }

    getJson(`${API}/commits/${pr.fromRef.latestCommit}/changes?since=${pr.toRef.latestCommit}&limit=1000`).then(({ values }) => {
      const paths = values.map((change) => change.path.components.join('/'));
      files.replaceChildren(...paths.map((path) => el('button', { type: 'button', className: 'file', textContent: path, onclick: () => showFile(path) })));
      if (paths.length) showFile(paths[0]);
    });

    return el('div', { className: 'columns' }, el('div', { className: 'side' }, trigger, menu, files), viewer);
  }

  document.body.append(
    notice,
    el('main', {}, el('h1', { textContent: pr.title }), tabs(), pageType === 'Commits' ? commitsPage() : diffPage())
  );

  setTimeout(() => {
    if (!document.getElementById('bitbucket-pr-diff')) {
      help.textContent = 'The extension doesn\'t seem to be running on this page. Install Commit Span for Bitbucket, then reload.';
    }
  }, 3000);
})();
