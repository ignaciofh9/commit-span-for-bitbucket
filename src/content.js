// The on-page controls. Only three things go inside Bitbucket's own page: a copied tab,
// a checkbox on each row of the Diff menu, and a checkbox on each commit table row, in a
// gap reserved before the table is painted. Everything else floats above the page from
// its own host, so the page never shifts. Bitbucket's class
// names aren't relied on: tabs are found by label and rows by commit hash, and sync()
// puts controls back after a re-render. If no tabs are found, a corner button is used.
(function () {
  const { providers, commitParts, spanMenuLabel, nextSpan, spanRange, hashesInRow, commitForRow, loadSpan, prepareSpan, storageKey, DIFF_CSS, el, fileShell, fillFile } = globalThis.PrDiff;

  const COMMITS_TAB = /^Commits(\s*\(?\d+\)?)?$/;
  const COMMITS_PAGE = /\/commits\/?$/;
  const DIFF_PAGE = /\/pull-requests\/\d+\/diff(?:\/|$)/;
  const CORNER_AFTER_MS = 5000;
  const FILTER_WARNING_AFTER_MS = 5000;
  const ALL_CHANGES = 'All changes in this pull request';
  const ALL_CHANGES_ITEM = /^All changes in this pull request\s*(\d+ commits?)?$/;
  const MENU_SEARCH_MS = 10000;
  const MENU_PAGE = /\/pull-requests\/\d+\/(diff(?:\/|$)|commits\/[0-9a-f]+)/;
  const MENU_WATCH_MS = 5000;
  const MENU_BOX_RIGHT = 4;
  const MENU_BOX_TOP = 8;
  const CHECKBOX_SIZE = 14;
  const CHECKBOX_SPACE = CHECKBOX_SIZE + 10;

  // Atlassian's theme colours, where the server provides them, so dark mode follows along.
  const CSS = `
    :host { display: block; height: 0; }
    [hidden] { display: none !important; }
    * { box-sizing: border-box; }
    section, .bar, button { font-family: inherit; font-size: 14px; line-height: 20px; }
    button { height: 32px; padding: 0 12px; cursor: pointer; white-space: nowrap; border: 0; border-radius: 3px;
      color: var(--ds-text, #42526e); background: var(--ds-background-neutral, rgba(9, 30, 66, 0.04)); }
    button:hover:not(:disabled) { background: var(--ds-background-neutral-hovered, rgba(9, 30, 66, 0.08)); }
    button:disabled { cursor: default; opacity: 0.6; }
    button.primary { color: var(--ds-text-inverse, #fff); background: var(--ds-background-brand-bold, #0052cc); }
    button.primary:hover:not(:disabled) { background: var(--ds-background-brand-bold-hovered, #0065ff); }
    button.subtle { background: transparent; }
    .launcher { position: fixed; right: 16px; bottom: 16px; z-index: 2147483000; box-shadow: var(--ds-shadow-overlay, 0 4px 12px rgba(9, 30, 66, 0.3)); }

    .picker { position: fixed; z-index: 2147483001; width: 580px; max-width: calc(100vw - 32px); overflow: hidden; border-radius: 3px;
      color: var(--ds-text, #172b4d); background: var(--ds-surface-overlay, #fff);
      box-shadow: var(--ds-shadow-overlay, 0 4px 16px rgba(9, 30, 66, 0.3)); }
    .commit-list { min-height: 72px; max-height: min(340px, 50vh); overflow-y: auto; }
    .commit { display: flex; gap: 12px; align-items: flex-start; padding: 8px 12px; cursor: pointer;
      border-bottom: 1px solid var(--ds-border, #dfe1e6); }
    .commit:hover { background: var(--ds-background-neutral-subtle-hovered, #f4f5f7); }
    .commit.selected { background: var(--ds-background-selected, #deebff); }
    .commit input { flex: none; width: ${CHECKBOX_SIZE}px; height: ${CHECKBOX_SIZE}px; margin: 3px 0 0; cursor: pointer; }
    .commit-text { min-width: 0; }
    .subject { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
    .meta { font-size: 12px; color: var(--ds-text-subtle, #5e6c84); }
    .list-message { padding: 24px 12px; text-align: center; color: var(--ds-text-subtle, #5e6c84); }
    .footer { min-height: 48px; padding: 8px 12px; display: flex; align-items: center; color: var(--ds-text-subtle, #5e6c84); }

    /* Long messages wrap within their own text, so the buttons stay on one row. */
    .actions { display: flex; flex: 1; gap: 8px; align-items: center; min-width: 0; }
    .actions button { flex: none; }
    .action-text { flex: 0 1 auto; min-width: 0; margin-right: auto; padding-right: 8px; }
    @media (max-width: 640px) { .actions { flex-wrap: wrap; } }
    .bar { position: fixed; left: 50%; bottom: 16px; z-index: 2147483000; transform: translateX(-50%); display: flex;
      width: max-content; max-width: min(800px, calc(100vw - 32px)); padding: 8px 12px; border-radius: 3px;
      color: var(--ds-text, #172b4d); background: var(--ds-surface-overlay, #fff);
      box-shadow: var(--ds-shadow-overlay, 0 4px 16px rgba(9, 30, 66, 0.3)); }
    .bar.warning { background: var(--ds-background-warning, #fffae6); }

    .panel { position: fixed; inset: 32px; z-index: 2147483002; display: flex; flex-direction: column; overflow: hidden; border-radius: 3px;
      color: var(--ds-text, #172b4d); background: var(--ds-surface-overlay, #fff);
      box-shadow: var(--ds-shadow-overlay, 0 8px 32px rgba(9, 30, 66, 0.4)); }
    .panel-head { display: flex; gap: 12px; align-items: center; justify-content: space-between; padding: 12px 16px;
      border-bottom: 1px solid var(--ds-border, #dfe1e6); }
    .panel-title { font-weight: 600; }
    .panel-body { flex: 1; min-height: 0; overflow: auto; padding: 12px 16px; }
    .status { margin: 0 0 8px; color: var(--ds-text-subtle, #42526e); }
    .panel a { font-size: 12px; color: var(--ds-link, #0052cc); }
  `;

  const launcher = el('button', { className: 'launcher', textContent: 'Commit span', hidden: true });

  const commitList = el('div', { className: 'commit-list' });
  const hint = el('span', { textContent: 'Tick the first and last commit you want to review.' });
  const footer = el('div', { className: 'footer' }, hint);
  const picker = el('section', { className: 'picker', hidden: true, tabIndex: -1 }, commitList, footer);
  picker.setAttribute('role', 'dialog');
  picker.setAttribute('aria-label', 'Pick commits to review');

  const actionText = el('span', { className: 'action-text' });
  actionText.setAttribute('role', 'status');
  const reviewButton = el('button', { className: 'primary', textContent: 'Review in Diff tab' });
  const readOnlyButton = el('button', { textContent: 'Read-only view' });
  const clearButton = el('button', { className: 'subtle', textContent: 'Clear' });
  const changeButton = el('button', { textContent: 'Change commits' });
  const showAllButton = el('button', { textContent: 'Show all changes' });
  const actions = el('div', { className: 'actions' }, actionText, reviewButton, readOnlyButton, clearButton, changeButton, showAllButton);
  const bar = el('div', { className: 'bar', hidden: true });

  const panelTitle = el('span', { className: 'panel-title' });
  const closePanelButton = el('button', { textContent: 'Close' });
  const status = el('p', { className: 'status', hidden: true });
  status.setAttribute('role', 'status');
  const summary = el('div', { className: 'summary', hidden: true });
  const link = el('a', { textContent: "Open Bitbucket's compare page (includes merged changes)", target: '_blank', rel: 'noopener' });
  const result = el('div');
  const panel = el(
    'section',
    { className: 'panel', hidden: true },
    el('div', { className: 'panel-head' }, panelTitle, closePanelButton),
    el('div', { className: 'panel-body' }, status, summary, link, result)
  );
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'Read-only view of the commits');

  const host = el('div', { id: 'bitbucket-pr-diff' });
  host.attachShadow({ mode: 'open' }).append(el('style', { textContent: CSS + DIFF_CSS }), launcher, picker, bar, panel);

  let current = null; // { provider, pr } for the PR on screen, if any
  let commits = [];
  let baseHash = null;
  let selection = null; // { oldest, newest } as commit hashes
  let loadId = 0;
  let loadRequested = false;
  let tab = null;
  let tabMissingSince = null;
  let plan = null; // the span the Diff tab is filtering to, if any
  let planChecked = false;
  let planSeenAt = null;
  let actionId = 0;
  let preparing = false;
  let actionMessage = '';
  let menuTitle = null; // the text nodes of Bitbucket's Diff menu
  let menuSubtitle = null;
  let menuNativeSubtitle = '';
  let menuList = null; // the open Diff menu's list, and its "All changes" row
  let menuAllItem = null;
  let menuWatchUntil = 0;

  const indexOf = (hash) => commits.findIndex((commit) => commit.hash === hash);

  function selectedIndexes() {
    if (!selection) return null;
    const newest = indexOf(selection.newest);
    const oldest = indexOf(selection.oldest);
    return newest < 0 || oldest < 0 ? null : { newest, oldest };
  }

  function inSelection(hash) {
    const span = selectedIndexes();
    const index = indexOf(hash);
    return Boolean(span) && index >= span.newest && index <= span.oldest;
  }

  function activePlan() {
    if (!planChecked) {
      planChecked = true;
      try {
        plan = JSON.parse(sessionStorage.getItem(storageKey(location.pathname)));
      } catch {
        plan = null;
      }
    }
    return plan;
  }

  function currentRange() {
    return spanRange(commits, baseHash, selection.oldest, selection.newest);
  }

  // Choosing commits

  function setSelection(next) {
    selection = next;
    actionId++;
    preparing = false;
    actionMessage = '';
    paintCommits();
    markRows();
    markMenu();
    renderActions();
  }

  function toggleCommit(hash) {
    const next = nextSpan(selectedIndexes(), indexOf(hash));
    setSelection(next && { newest: commits[next.newest].hash, oldest: commits[next.oldest].hash });
  }

  function renderCommits() {
    if (!commits.length) return;
    commitList.replaceChildren(
      ...commits.map((commit) => {
        const { hash, subject, author, date } = commitParts(commit);
        const box = el('input', { type: 'checkbox' });
        box.dataset.hash = commit.hash;
        box.addEventListener('change', () => toggleCommit(commit.hash));
        return el(
          'label',
          { className: 'commit' },
          box,
          el(
            'div',
            { className: 'commit-text' },
            el('div', { className: 'subject', textContent: subject, title: subject }),
            el('div', { className: 'meta', textContent: [hash, author, date].filter(Boolean).join(' · ') })
          )
        );
      })
    );
    paintCommits();
  }

  function paintCommits() {
    for (const box of commitList.querySelectorAll('input')) {
      const selected = inSelection(box.dataset.hash);
      box.checked = selected;
      box.closest('.commit').classList.toggle('selected', selected);
    }
  }

  function rowHashes(row) {
    const hrefs = [...row.querySelectorAll('a[href*="/commits/"]')].map((a) => a.getAttribute('href'));
    return { hrefs, cellTexts: [...row.cells].map((cell) => cell.textContent.trim()) };
  }

  // Widens the first column of commit tables, including the header, to make room for
  // the checkboxes. Doesn't need the commit list, so it can run before the table is
  // painted, and the checkboxes that arrive later don't move anything.
  function reserveRowSpace() {
    for (const table of document.querySelectorAll('table')) {
      const rows = [...table.rows];
      const hasCommits = rows.some((row) => {
        const { hrefs, cellTexts } = rowHashes(row);
        return hashesInRow(hrefs, cellTexts).length > 0;
      });
      if (!hasCommits) continue;
      for (const row of rows) {
        const cell = row.cells[0];
        if (!cell || cell.dataset.bpdPadding !== undefined) continue;
        const padding = parseFloat(getComputedStyle(cell).paddingLeft) || 0;
        cell.dataset.bpdPadding = String(padding);
        cell.style.paddingLeft = `${padding + CHECKBOX_SPACE}px`;
      }
    }
  }

  function addRowBox(row, commit) {
    const cell = row.cells[0];
    const box = el('input', { type: 'checkbox', className: 'bpd-check' });
    box.setAttribute('aria-label', `Include commit ${commit.hash.slice(0, 7)} in the review`);
    if (!/relative|absolute|fixed|sticky/.test(getComputedStyle(cell).position)) cell.style.position = 'relative';
    Object.assign(box.style, {
      position: 'absolute',
      left: `${Math.max(Number(cell.dataset.bpdPadding) || 0, 4)}px`,
      top: '50%',
      width: `${CHECKBOX_SIZE}px`,
      height: `${CHECKBOX_SIZE}px`,
      margin: `-${CHECKBOX_SIZE / 2}px 0 0`,
      cursor: 'pointer',
    });
    box.addEventListener('click', (event) => event.stopPropagation());
    box.addEventListener('change', () => toggleCommit(commit.hash));
    cell.prepend(box);
    return box;
  }

  function markRows() {
    if (!COMMITS_PAGE.test(location.pathname)) return;
    reserveRowSpace();
    if (!commits.length) return;
    for (const row of document.querySelectorAll('table tr')) {
      const { hrefs, cellTexts } = rowHashes(row);
      const commit = commitForRow(commits, hrefs, cellTexts);
      if (!commit) continue;
      const box = row.querySelector('.bpd-check') || addRowBox(row, commit);
      const selected = inSelection(commit.hash);
      if (box.checked !== selected) box.checked = selected;
      row.toggleAttribute('data-bpd-selected', selected);
    }
  }

  // Bitbucket's Diff menu

  function menuRowCommit(row) {
    const links = [...row.querySelectorAll('a[href*="/commits/"]')];
    if (row.matches('a[href*="/commits/"]')) links.push(row);
    const leaves = [...row.querySelectorAll('*')].filter((node) => !node.children.length);
    return commitForRow(commits, links.map((a) => a.getAttribute('href')), leaves.map((node) => node.textContent.trim()));
  }

  // Finds the open menu from its "All changes" row: the list is the first parent whose
  // children include a commit. The menu's closed label also says "All changes" until
  // it's relabelled, and it comes first on the page.
  function findMenuList() {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const matches = [];
    while (walker.nextNode()) {
      if (walker.currentNode.data.trim() === ALL_CHANGES) matches.push(walker.currentNode);
    }
    for (const text of menuTitle?.isConnected ? matches : matches.slice(1)) {
      for (let row = text.parentElement, depth = 0; row?.parentElement && row !== document.body && depth < 8; row = row.parentElement, depth++) {
        if ([...row.parentElement.children].some((sibling) => sibling !== row && menuRowCommit(sibling))) {
          return { list: row.parentElement, allItem: row };
        }
      }
    }
    return null;
  }

  // A checkbox takes clicks without Bitbucket seeing them, so the row doesn't open that
  // commit and the menu stays open. Clicking the rest of the row still does what it did.
  // It's overlaid at the end of the subject line, so the row doesn't get any wider.
  function addMenuBox(row, commit) {
    const box = el('input', { type: 'checkbox', className: 'bpd-check' });
    box.setAttribute('aria-label', `Include commit ${commit.hash.slice(0, 7)} in the review`);
    if (!/relative|absolute|fixed|sticky/.test(getComputedStyle(row).position)) row.style.position = 'relative';
    Object.assign(box.style, {
      position: 'absolute',
      right: `${MENU_BOX_RIGHT}px`,
      top: `${MENU_BOX_TOP}px`,
      zIndex: '3',
      width: `${CHECKBOX_SIZE}px`,
      height: `${CHECKBOX_SIZE}px`,
      margin: '0',
      cursor: 'pointer',
    });
    for (const type of ['pointerdown', 'pointerup', 'mouseup', 'dblclick']) {
      box.addEventListener(type, (event) => event.stopPropagation());
    }
    box.addEventListener('mousedown', (event) => {
      // Keeps focus where it is, in case the menu closes when it loses focus.
      event.preventDefault();
      event.stopPropagation();
    });
    box.addEventListener('keydown', (event) => {
      if (event.key === ' ' || event.key === 'Enter') event.stopPropagation();
    });
    box.addEventListener('click', (event) => {
      // Cancelling the click stops a link row from opening, but also undoes the tick,
      // so the tick is drawn again just after.
      event.preventDefault();
      event.stopPropagation();
      toggleCommit(commit.hash);
      setTimeout(markMenu);
    });
    row.prepend(box);
    return box;
  }

  function markMenu() {
    if (!menuList?.isConnected || !commits.length) return;
    for (const row of menuList.children) {
      if (row === menuAllItem) continue;
      const commit = menuRowCommit(row);
      if (!commit) continue;
      const box = row.querySelector('.bpd-check') || addMenuBox(row, commit);
      const selected = inSelection(commit.hash);
      if (box.checked !== selected) box.checked = selected;
      row.toggleAttribute('data-bpd-selected', selected);
    }
    // "All changes" isn't what's showing during a span, so it shouldn't look current.
    if (DIFF_PAGE.test(location.pathname) && activePlan() && menuAllItem) {
      menuAllItem.setAttribute('data-bpd-not-current', '');
      for (const node of [menuAllItem, ...menuAllItem.querySelectorAll('*')]) {
        node.removeAttribute('aria-selected');
        node.removeAttribute('aria-current');
        for (const name of [...node.classList]) {
          if (/active|selected|current/i.test(name)) node.classList.remove(name);
        }
      }
    }
  }

  // Looks for the menu only just after a click, because searching a large diff's
  // text on every change to the page would be slow.
  function syncMenu() {
    if (menuList && !menuList.isConnected) {
      menuList = null;
      menuAllItem = null;
    }
    if (!menuList && commits.length && Date.now() < menuWatchUntil) {
      const found = findMenuList();
      if (found) {
        menuList = found.list;
        menuAllItem = found.allItem;
      }
    }
    markMenu();
  }

  function watchForMenu() {
    if (!current || !MENU_PAGE.test(location.pathname)) return;
    menuWatchUntil = Date.now() + MENU_WATCH_MS;
    if (!loadRequested) load();
    scheduleSync();
  }

  async function load() {
    const { provider, pr } = current;
    const run = ++loadId;
    loadRequested = true;
    if (!commits.length) commitList.replaceChildren(el('div', { className: 'list-message', textContent: 'Loading commits…' }));
    try {
      const loaded = await provider.loadPr(pr);
      if (run !== loadId) return;
      const changed = loaded.commits.map((c) => c.hash).join() !== commits.map((c) => c.hash).join();
      commits = loaded.commits;
      baseHash = loaded.baseHash;
      if (!commits.length) {
        commitList.replaceChildren(el('div', { className: 'list-message', textContent: 'This PR has no commits yet.' }));
      } else if (changed) {
        renderCommits();
      }
      const active = activePlan();
      if (!selection && active && indexOf(active.first) >= 0 && indexOf(active.last) >= 0) {
        selection = { oldest: active.first, newest: active.last };
        paintCommits();
      }
      markRows();
      syncMenu();
      renderActions();
      if (!picker.hidden) positionPicker();
    } catch (error) {
      if (run === loadId) commitList.replaceChildren(el('div', { className: 'list-message', textContent: error.message }));
    }
  }

  // The commit dropdown

  function positionPicker() {
    const anchor = tab?.isConnected ? tab : launcher;
    const rect = anchor.getBoundingClientRect();
    const left = Math.max(16, Math.min(rect.left, innerWidth - picker.offsetWidth - 16));
    const below = rect.bottom + 4;
    const top = below + picker.offsetHeight > innerHeight - 16 ? Math.max(16, rect.top - picker.offsetHeight - 4) : below;
    picker.style.left = `${left}px`;
    picker.style.top = `${top}px`;
  }

  function setExpanded(expanded) {
    tab?.querySelector('a, button')?.setAttribute('aria-expanded', String(expanded));
  }

  // Loads on every open, so commits pushed since the last open appear.
  function openPicker() {
    picker.hidden = false;
    setExpanded(true);
    renderActions();
    positionPicker();
    picker.focus({ preventScroll: true });
    load();
  }

  function closePicker({ returnFocus = false } = {}) {
    if (picker.hidden) return;
    picker.hidden = true;
    setExpanded(false);
    renderActions();
    if (returnFocus) (tab?.querySelector('a, button') || launcher).focus({ preventScroll: true });
  }

  const togglePicker = () => (picker.hidden ? openPicker() : closePicker());

  // The actions, shown in the dropdown's footer when it's open and in a floating bar otherwise

  function planSummary() {
    const count = Object.keys(plan.files).length;
    const parts = [`Showing commits ${plan.first.slice(0, 7)} to ${plan.last.slice(0, 7)}: ${count} ${count === 1 ? 'file' : 'files'}.`];
    if (plan.gone) parts.push(`${plan.gone} ${plan.gone === 1 ? 'line is' : 'lines are'} no longer in the PR.`);
    if (plan.notShown.length) parts.push(`${plan.notShown.length} more ${plan.notShown.length === 1 ? 'file has' : 'files have'} nothing left in the PR.`);
    if (plan.truncated) parts.push(`Only the first 200 of ${plan.total} files were checked.`);
    return parts.join(' ');
  }

  // Warns straight away if a request was skipped, or after a wait if none were seen.
  function filterWarning() {
    const root = document.documentElement;
    const skippedDiff = root.getAttribute('data-bpd-skipped-diff');
    const skippedChanges = root.getAttribute('data-bpd-skipped-changes');
    const waited = planSeenAt !== null && Date.now() - planSeenAt >= FILTER_WARNING_AFTER_MS;
    if (!root.hasAttribute('data-bpd-diff') && (skippedDiff || waited)) {
      const failure = root.getAttribute('data-bpd-error');
      return `Filtering didn't apply, so this may be the full diff. Saw: ${skippedDiff || 'no other diff requests'}.${failure ? ` Error: ${failure}.` : ''}`;
    }
    if (!root.hasAttribute('data-bpd-changes') && (skippedChanges || waited)) {
      return `The file list isn't filtered, so some files may look empty. Saw: ${skippedChanges || 'no other file list requests'}.`;
    }
    return '';
  }

  function selectionSummary() {
    const span = selectedIndexes();
    if (!span) return '';
    const count = span.oldest - span.newest + 1;
    const hash = (index) => commits[index].hash.slice(0, 7);
    return count === 1 ? `1 commit: ${hash(span.oldest)}` : `${count} commits: ${hash(span.oldest)} to ${hash(span.newest)}`;
  }

  function setText(node, text) {
    if (node.textContent !== text) node.textContent = text;
  }

  function renderActions() {
    const onDiffTab = DIFF_PAGE.test(location.pathname);
    const planActive = onDiffTab && activePlan();
    const changed = planActive && selection && (selection.oldest !== plan.first || selection.newest !== plan.last);
    const showing = planActive && picker.hidden && !changed ? plan : null;
    if (onDiffTab && plan) planSeenAt ??= Date.now();
    const selected = Boolean(selectedIndexes());
    const home = picker.hidden ? bar : footer;
    if (actions.parentElement !== home) home.append(actions);

    const warning = showing ? filterWarning() : '';
    setText(actionText, actionMessage || warning || (showing ? planSummary() : selectionSummary()));
    actionText.title = showing ? 'Comments on hidden lines are hidden too, until you show all changes.' : '';
    reviewButton.hidden = Boolean(showing) || !current?.provider.prChanges;
    reviewButton.disabled = preparing;
    if (!preparing) setText(reviewButton, 'Review in Diff tab');
    readOnlyButton.hidden = Boolean(showing);
    readOnlyButton.disabled = preparing;
    clearButton.hidden = Boolean(showing);
    changeButton.hidden = !showing;
    showAllButton.hidden = !showing;

    actions.hidden = !selected && !showing && !actionMessage;
    hint.hidden = !actions.hidden;
    bar.hidden = !picker.hidden || actions.hidden;
    bar.classList.toggle('warning', Boolean(warning || actionMessage));
  }

  // Saves what to keep, then reloads into the Diff tab, where the page hook applies it.
  async function reviewInDiffTab() {
    const { provider, pr } = current;
    const range = currentRange();
    if (!range.from) {
      actionMessage = "Can't find the commit before these commits.";
      renderActions();
      return;
    }
    const run = ++actionId;
    const isStale = () => run !== actionId;
    preparing = true;
    actionMessage = '';
    reviewButton.textContent = 'Preparing…';
    renderActions();
    try {
      const prepared = await prepareSpan(provider, pr, range, {
        isStale,
        onProgress: (done, total) => {
          reviewButton.textContent = `Preparing ${done} of ${total}…`;
        },
      });
      if (isStale()) return;
      if (!Object.keys(prepared.files).length) {
        preparing = false;
        actionMessage = "None of the author's work in these commits is still in the PR.";
        renderActions();
        return;
      }
      const span = selectedIndexes();
      prepared.count = span.oldest - span.newest + 1;
      sessionStorage.setItem(storageKey(location.pathname), JSON.stringify(prepared));
      location.href = provider.diffTabUrl(pr);
    } catch (error) {
      if (isStale()) return;
      preparing = false;
      actionMessage = error.name === 'QuotaExceededError' ? 'These commits are too big to filter. Try the read-only view.' : error.message;
      renderActions();
    }
  }

  function showAllChanges() {
    sessionStorage.removeItem(storageKey(location.pathname));
    location.reload();
  }

  function findText(root, matches) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      if (matches(walker.currentNode.data.trim())) return walker.currentNode;
    }
    return null;
  }

  // Bitbucket's Diff menu says "All changes" even when a span is showing, so it's
  // relabelled while one is active. The closed menu's label comes first on the page,
  // and once it's relabelled, "All changes" only matches the item in the open menu.
  function labelDiffMenu() {
    if (!DIFF_PAGE.test(location.pathname) || !activePlan()) return;
    if (!menuTitle?.isConnected) {
      if (!menuTitle && planSeenAt !== null && Date.now() - planSeenAt > MENU_SEARCH_MS) return;
      menuTitle = findText(document.body, (text) => text === ALL_CHANGES);
      menuSubtitle = null;
      if (!menuTitle) return;
      let box = menuTitle.parentElement;
      for (let i = 0; box && box !== document.body && i < 4 && !menuSubtitle; i++, box = box.parentElement) {
        menuSubtitle = findText(box, (text) => /^\d+ commits?$/.test(text));
      }
      menuNativeSubtitle = menuSubtitle?.data ?? '';
    }
    const { title, subtitle } = spanMenuLabel(plan, menuNativeSubtitle.trim());
    if (menuTitle.data !== title) menuTitle.data = title;
    if (menuSubtitle && menuSubtitle.data !== subtitle) menuSubtitle.data = subtitle;
  }

  function restoreDiffMenu() {
    if (menuTitle?.isConnected) menuTitle.data = ALL_CHANGES;
    if (menuSubtitle?.isConnected) menuSubtitle.data = menuNativeSubtitle;
    menuTitle = null;
    menuSubtitle = null;
    menuNativeSubtitle = '';
  }

  // Choosing "All changes" in the open menu should do what it says.
  function handleAllChangesItem(event) {
    if (!menuTitle?.isConnected || !DIFF_PAGE.test(location.pathname) || !activePlan()) return;
    for (let node = event.target; node && node !== document.body && node.textContent.length < 200; node = node.parentElement) {
      if (ALL_CHANGES_ITEM.test(node.textContent.trim())) {
        event.preventDefault();
        event.stopPropagation();
        showAllChanges();
        return;
      }
    }
  }

  // The read-only view

  function setStatus(text) {
    status.textContent = text;
    status.hidden = !text;
  }

  function clearResult() {
    actionId++;
    result.replaceChildren();
    summary.replaceChildren();
    summary.hidden = true;
    setStatus('');
  }

  function closePanel() {
    if (panel.hidden) return;
    panel.hidden = true;
    clearResult();
    renderActions();
  }

  function renderSummary(shown, hiddenPaths, total, shownLimit) {
    const count = (n) => `${n} ${n === 1 ? 'file' : 'files'}`;
    let text = shown ? `${count(shown)} changed by the author.` : 'The author changed nothing here beyond what merges brought in.';
    if (total > shownLimit) text += ` Showing the first ${shownLimit} of ${total} files.`;
    summary.replaceChildren(text);
    if (hiddenPaths.length) {
      const list = el('div', { className: 'message' }, ...hiddenPaths.map((path) => el('div', { textContent: path })));
      summary.append(el('details', {}, el('summary', { textContent: `${count(hiddenPaths.length)} hidden: changed only by merges` }), list));
    }
    summary.hidden = false;
  }

  async function openReadOnly() {
    const { provider, pr } = current;
    const range = currentRange();
    const title = selectionSummary();
    closePicker();
    clearResult();
    panelTitle.textContent = title;
    panel.hidden = false;
    closePanelButton.focus({ preventScroll: true });
    if (!range.from) {
      link.hidden = true;
      setStatus("Can't find the commit before these commits.");
      return;
    }
    link.hidden = false;
    link.href = provider.compareUrl(pr, range.from, range.to);
    if (!provider.listChanges) {
      setStatus('This Bitbucket only has the compare page, which includes merged changes.');
      return;
    }

    const run = actionId;
    const isStale = () => run !== actionId;
    let shells = [];
    let paths = [];
    let total = 0;
    let done = 0;
    let shown = 0;
    const hiddenPaths = [];
    setStatus('Loading changes…');
    try {
      await loadSpan(provider, pr, range, {
        isStale,
        onPlan(files, count) {
          total = count;
          paths = files.map((change) => change.path);
          shells = files.map(fileShell);
          result.replaceChildren(...shells);
        },
        onFile(index, fileResult) {
          fillFile(shells[index], fileResult);
          done++;
          if (fileResult.hiddenWhole) hiddenPaths.push(paths[index]);
          else shown++;
          setStatus(done < shells.length ? `Loading changes… ${done} of ${shells.length} files` : '');
        },
      });
      if (isStale()) return;
      setStatus('');
      renderSummary(shown, hiddenPaths.sort(), total, shells.length);
    } catch (error) {
      if (!isStale()) setStatus(error.message);
    }
  }

  // Bitbucket's tabs

  // Finds the tab strip from the Diff tab outwards. Starting there means it finds
  // the PR's Commits tab, not the Commits link in the repo sidebar.
  function findTabs() {
    const withLabel = (pattern) =>
      [...document.querySelectorAll('a, button, [role="tab"]')].filter((node) => pattern.test(node.textContent.trim()));
    const commitsTabs = withLabel(COMMITS_TAB);
    for (const diffTab of withLabel(/^Diff$/)) {
      for (let strip = diffTab.parentElement; strip && strip !== document.body; strip = strip.parentElement) {
        const commitsTab = commitsTabs.find((node) => strip.contains(node));
        if (commitsTab) return { strip, commitsTab };
      }
    }
    return null;
  }

  // Copies the Commits tab, so the new tab picks up Bitbucket's own styling.
  function makeTab(strip, commitsTab) {
    let item = commitsTab;
    while (item.parentElement !== strip) item = item.parentElement;
    const copy = item.cloneNode(true);
    for (const node of [copy, ...copy.querySelectorAll('*')]) {
      for (const attribute of ['id', 'href', 'aria-selected', 'aria-current', 'aria-controls']) node.removeAttribute(attribute);
      for (const name of [...node.classList]) {
        if (/active|selected|current/i.test(name)) node.classList.remove(name);
      }
    }
    const target = copy.matches('a, button') ? copy : copy.querySelector('a, button');
    if (target?.tagName === 'A') target.setAttribute('href', '#');
    target?.setAttribute('aria-haspopup', 'dialog');
    target?.setAttribute('aria-expanded', 'false');
    const walker = document.createTreeWalker(copy, NodeFilter.SHOW_TEXT);
    const texts = [];
    while (walker.nextNode()) texts.push(walker.currentNode);
    texts.filter((text) => text.data.trim()).forEach((text, i) => {
      text.data = i === 0 ? 'Commit span' : '';
    });
    copy.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      togglePicker();
    });
    return copy;
  }

  function placeControls() {
    if (!host.isConnected) document.documentElement.append(host);
    if (tab?.isConnected) return;
    const tabs = findTabs();
    if (tabs) {
      tab = makeTab(tabs.strip, tabs.commitsTab);
      tabs.strip.append(tab);
      setExpanded(!picker.hidden);
      launcher.hidden = true;
      tabMissingSince = null;
      return;
    }
    tabMissingSince ??= Date.now();
    launcher.hidden = Date.now() - tabMissingSince < CORNER_AFTER_MS;
  }

  function reset() {
    loadId++;
    actionId++;
    loadRequested = false;
    commits = [];
    baseHash = null;
    selection = null;
    plan = null;
    planChecked = false;
    planSeenAt = null;
    preparing = false;
    actionMessage = '';
    tabMissingSince = null;
    restoreDiffMenu();
    picker.hidden = true;
    panel.hidden = true;
    bar.hidden = true;
    launcher.hidden = true;
    clearResult();
    commitList.replaceChildren();
    tab?.remove();
    tab = null;
    host.remove();
    menuList = null;
    menuAllItem = null;
    menuWatchUntil = 0;
    for (const box of document.querySelectorAll('.bpd-check')) box.remove();
    for (const row of document.querySelectorAll('[data-bpd-selected]')) row.removeAttribute('data-bpd-selected');
    for (const cell of document.querySelectorAll('[data-bpd-padding]')) {
      cell.style.paddingLeft = '';
      delete cell.dataset.bpdPadding;
    }
  }

  function findPr(href) {
    for (const provider of providers) {
      const pr = provider.matchPr(href);
      if (pr) return { provider, pr };
    }
    return null;
  }

  // Bitbucket can change pages without reloading, and a content script can't hook the
  // page's history calls. So this runs soon after any change to the page, and once a
  // second in case nothing else happens.
  function sync() {
    const found = findPr(location.href);
    if (found?.pr.key !== current?.pr.key) {
      current = found;
      reset();
    }
    if (!current) return;
    placeControls();
    if (COMMITS_PAGE.test(location.pathname)) {
      if (!loadRequested) load();
      markRows();
    }
    renderActions();
    labelDiffMenu();
    if (MENU_PAGE.test(location.pathname)) syncMenu();
    if (!picker.hidden && !commits.length && !loadRequested) load();
  }

  let syncPending = false;
  function scheduleSync() {
    if (syncPending) return;
    syncPending = true;
    setTimeout(() => {
      syncPending = false;
      sync();
    }, 100);
  }

  launcher.addEventListener('click', togglePicker);
  reviewButton.addEventListener('click', reviewInDiffTab);
  readOnlyButton.addEventListener('click', openReadOnly);
  clearButton.addEventListener('click', () => setSelection(null));
  changeButton.addEventListener('click', openPicker);
  showAllButton.addEventListener('click', showAllChanges);
  closePanelButton.addEventListener('click', closePanel);

  document.addEventListener(
    'click',
    (event) => {
      if (picker.hidden) return;
      const path = event.composedPath();
      if (path.includes(host) || path.includes(tab)) return;
      if (event.target.classList?.contains('bpd-check')) return;
      closePicker();
    },
    true
  );
  document.addEventListener('click', handleAllChangesItem, true);
  document.addEventListener('click', watchForMenu, true);
  document.addEventListener(
    'keydown',
    (event) => {
      if (event.key !== 'Escape' || (picker.hidden && panel.hidden)) return;
      event.stopPropagation();
      if (!panel.hidden) closePanel();
      else closePicker({ returnFocus: true });
    },
    true
  );
  addEventListener('resize', () => !picker.hidden && positionPicker());
  addEventListener('scroll', () => !picker.hidden && positionPicker(), { capture: true, passive: true });

  // This callback runs before the browser paints, so the commit table's gap is there
  // the first time it's seen. The rest can wait for the next sync.
  new MutationObserver(() => {
    if (COMMITS_PAGE.test(location.pathname) && findPr(location.href)) reserveRowSpace();
    scheduleSync();
  }).observe(document.documentElement, { childList: true, subtree: true });
  sync();
  setInterval(sync, 1000);
})();
