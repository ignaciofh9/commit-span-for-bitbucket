// The on-page controls. The Diff menu is where commits are picked: each row gets a
// checkbox, and the menu gets a footer with the actions. The Commits table gets
// checkboxes too, in a gap reserved before it's painted, with a small bar. Bitbucket's
// class names aren't relied on: the menu is found from its "All changes" row, and rows by
// commit hash, and sync() puts controls back after a re-render.
(function () {
  const { providers, spanMenuLabel, spanSummary, spanNotes, nextSpan, spanRange, hashesInRow, commitForRow, loadSpan, prepareSpan, storageKey, DIFF_CSS, el, fileShell, fillFile } = globalThis.PrDiff;

  const COMMITS_PAGE = /\/commits\/?$/;
  const DIFF_PAGE = /\/pull-requests\/\d+\/diff(?:\/|$)/;
  const FILTER_WARNING_AFTER_MS = 5000;
  const ALL_CHANGES = 'All changes in this pull request';
  const ALL_CHANGES_ITEM = /^All changes in this pull request\s*(\d+ commits?)?$/;
  const MENU_SEARCH_MS = 10000;
  const MENU_PAGE = /\/pull-requests\/\d+\/(diff(?:\/|$)|commits\/[0-9a-f]+)/;
  const MENU_WATCH_MS = 5000;
  const MENU_HIT_WIDTH = 40;
  const CHECKBOX_SIZE = 16;
  const CHECKBOX_SPACE = CHECKBOX_SIZE + 10;

  // Atlassian's theme colours, where the server provides them, so dark mode follows along.
  const SHARED_CSS = `
    [hidden] { display: none !important; }
    * { box-sizing: border-box; }
    .actions, .notice, section, button { font-family: inherit; font-size: 14px; line-height: 20px; }
    button { height: 32px; padding: 0 12px; cursor: pointer; white-space: nowrap; border: 0; border-radius: 3px;
      color: var(--ds-text, #42526e); background: var(--ds-background-neutral, rgba(9, 30, 66, 0.04)); }
    button:hover:not(:disabled) { background: var(--ds-background-neutral-hovered, rgba(9, 30, 66, 0.08)); }
    button:disabled { cursor: default; opacity: 0.6; }
    button.primary { color: var(--ds-text-inverse, #fff); background: var(--ds-background-brand-bold, #0052cc); }
    button.primary:hover:not(:disabled) { background: var(--ds-background-brand-bold-hovered, #0065ff); }
    button.subtle { background: transparent; }
    button.link { padding: 0 4px; color: var(--ds-link, #0052cc); background: transparent; }
    .actions { display: flex; flex: 1; flex-wrap: wrap; gap: 8px; align-items: center; min-width: 0; color: var(--ds-text-subtle, #42526e); }
    .actions button { flex: none; }
    .action-text { flex: 1 1 120px; min-width: 0; }
  `;
  const HOST_CSS = `
    :host { display: block; height: 0; }
    .bar { position: fixed; left: 50%; bottom: 16px; z-index: 2147483000; transform: translateX(-50%); display: flex;
      width: max-content; max-width: min(800px, calc(100vw - 32px)); padding: 8px 12px; border-radius: 3px;
      background: var(--ds-surface-overlay, #fff); box-shadow: var(--ds-shadow-overlay, 0 4px 16px rgba(9, 30, 66, 0.3)); }
    .bar .action-text { flex: 0 1 auto; margin-right: 8px; }
    /* Top right, where it can't cover the diff's comment boxes or the file list. */
    .notice { position: fixed; top: 16px; right: 16px; z-index: 2147483000; max-width: min(480px, calc(100vw - 32px)); padding: 8px 12px; border-radius: 3px;
      color: var(--ds-text, #172b4d); background: var(--ds-background-warning, #fffae6);
      box-shadow: var(--ds-shadow-overlay, 0 4px 16px rgba(9, 30, 66, 0.3)); }

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
  const FOOTER_CSS = `
    .actions { padding: 8px 12px; }
    .action-text { font-size: 12px; }
  `;

  const actionText = el('span', { className: 'action-text' });
  actionText.setAttribute('role', 'status');
  const readOnlyButton = el('button', { className: 'link', textContent: 'Read-only view' });
  const clearButton = el('button', { className: 'subtle', textContent: 'Clear' });
  const applyButton = el('button', { className: 'primary' });
  const actions = el('div', { className: 'actions' }, actionText, readOnlyButton, clearButton, applyButton);
  const bar = el('div', { className: 'bar', hidden: true });
  const notice = el('div', { className: 'notice', hidden: true });
  notice.setAttribute('role', 'status');

  // Pinned to the bottom of the menu's list while it scrolls. Set directly on the element,
  // because Bitbucket's own rules for the list's children would beat a stylesheet here.
  const footer = el('div', { className: 'bpd-menu-footer' });
  Object.assign(footer.style, {
    display: 'block',
    position: 'sticky',
    bottom: '0',
    zIndex: '4',
    margin: '0',
    padding: '0',
    borderTop: '1px solid var(--ds-border, #dfe1e6)',
    background: 'var(--ds-surface-overlay, #fff)',
  });
  footer.attachShadow({ mode: 'open' }).append(el('style', { textContent: SHARED_CSS + FOOTER_CSS }));
  // Bitbucket mustn't see these, or the menu would close. Keeping focus where it is also
  // keeps it open, in case it closes when it loses focus.
  for (const type of ['pointerdown', 'pointerup', 'mouseup', 'click', 'dblclick']) {
    footer.addEventListener(type, (event) => event.stopPropagation());
  }
  footer.addEventListener('mousedown', (event) => {
    event.preventDefault();
    event.stopPropagation();
  });

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
  host.attachShadow({ mode: 'open' }).append(el('style', { textContent: SHARED_CSS + HOST_CSS + DIFF_CSS }), bar, notice, panel);

  let current = null; // { provider, pr } for the PR on screen, if any
  let commits = [];
  let baseHash = null;
  let selection = null; // { oldest, newest } as commit hashes
  let loadId = 0;
  let loadRequested = false;
  let plan = null; // the span the Diff tab is filtering to, if any
  let planChecked = false;
  let planSeenAt = null;
  let actionId = 0;
  let preparing = false;
  let actionMessage = '';
  let viewPath = null;
  const removedHighlights = new WeakMap();
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

  // The ticks and what's showing are one state: the ticks start as what's showing, and
  // differ only while a change is waiting to be applied. Leaving the menu without applying
  // discards it.

  // The commit a single commit's page is showing, if this is one.
  function viewedCommit() {
    const hash = location.pathname.match(/\/pull-requests\/\d+\/commits\/([0-9a-f]+)/)?.[1];
    return hash ? commits.find((commit) => commit.hash.startsWith(hash)) : undefined;
  }

  function viewSelection() {
    const commit = viewedCommit();
    if (commit) return { oldest: commit.hash, newest: commit.hash };
    const active = activePlan();
    if (active && indexOf(active.first) >= 0 && indexOf(active.last) >= 0) return { oldest: active.first, newest: active.last };
    return null;
  }

  function matchesView() {
    const view = viewSelection();
    return Boolean(selection && view && selection.oldest === view.oldest && selection.newest === view.newest);
  }

  function seedSelection() {
    if (selection || !commits.length) return;
    selection = viewSelection();
  }

  function discardChanges() {
    selection = viewSelection();
    actionId++;
    preparing = false;
    actionMessage = '';
    markRows();
    markMenu();
    renderActions();
  }

  // Bitbucket can move between commits without reloading.
  function syncView() {
    if (location.pathname === viewPath) return;
    viewPath = location.pathname;
    selection = null;
    seedSelection();
  }

  // Something to apply: different ticks, or none at all while a span is showing.
  function hasChange() {
    if (selection) return !matchesView();
    return !viewedCommit() && Boolean(activePlan());
  }

  // Choosing commits

  function setSelection(next) {
    selection = next;
    actionId++;
    preparing = false;
    actionMessage = '';
    markRows();
    markMenu();
    renderActions();
  }

  // Ticks that only mirror what's showing are placeholders: ticking outside them starts
  // over. After that, ticking builds the span.
  function toggleCommit(hash) {
    const span = selectedIndexes();
    const index = indexOf(hash);
    const startOver = span && matchesView() && (index < span.newest || index > span.oldest);
    const next = startOver ? { newest: index, oldest: index } : nextSpan(span, index);
    setSelection(next && { newest: commits[next.newest].hash, oldest: commits[next.oldest].hash });
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

  // A checkbox inside a bigger clickable area, the full height of its row. Being a label,
  // a click anywhere in it reaches the checkbox.
  function checkboxIn(parent, commit, position) {
    const box = el('input', { type: 'checkbox', className: 'bpd-check' });
    box.setAttribute('aria-label', `Include commit ${commit.hash.slice(0, 7)} in the review`);
    Object.assign(box.style, { width: `${CHECKBOX_SIZE}px`, height: `${CHECKBOX_SIZE}px`, margin: '0', cursor: 'pointer' });
    const hit = el('label', { className: 'bpd-hit' }, box);
    Object.assign(hit.style, { position: 'absolute', top: '0', bottom: '0', zIndex: '3', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0', cursor: 'pointer', ...position });
    if (!/relative|absolute|fixed|sticky/.test(getComputedStyle(parent).position)) parent.style.position = 'relative';
    parent.prepend(hit);
    return { box, hit };
  }

  function addRowBox(row, commit) {
    const cell = row.cells[0];
    const width = (Number(cell.dataset.bpdPadding) || 0) + CHECKBOX_SPACE;
    const { box, hit } = checkboxIn(cell, commit, { left: '0', width: `${width}px` });
    hit.addEventListener('click', (event) => event.stopPropagation());
    box.addEventListener('change', () => toggleCommit(commit.hash));
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
  // children include a commit. On the Diff tab, the menu's closed label also says "All
  // changes" until it's relabelled, and it comes first on the page. On a single commit's
  // page, it names that commit instead.
  function findMenuList() {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const matches = [];
    while (walker.nextNode()) {
      if (walker.currentNode.data.trim() === ALL_CHANGES) matches.push(walker.currentNode);
    }
    const labelSaysAllChanges = DIFF_PAGE.test(location.pathname) && !menuTitle?.isConnected;
    for (const text of labelSaysAllChanges ? matches.slice(1) : matches) {
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
  // It's overlaid at the row's right edge, with room kept for it by page.css, so the
  // row doesn't get any wider.
  function addMenuBox(row, commit) {
    const { box, hit } = checkboxIn(row, commit, { right: '0', width: `${MENU_HIT_WIDTH}px` });
    for (const type of ['pointerdown', 'pointerup', 'mouseup', 'dblclick', 'click']) {
      hit.addEventListener(type, (event) => event.stopPropagation());
    }
    hit.addEventListener('mousedown', (event) => {
      // Keeps focus where it is, in case the menu closes when it loses focus.
      event.preventDefault();
      event.stopPropagation();
    });
    hit.addEventListener('keydown', (event) => {
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
    // Bitbucket's own highlight marks what's showing. It steps aside when that isn't
    // what the ticks say, so there's only ever one selection on screen.
    const viewed = viewedCommit();
    for (const row of menuList.children) {
      if (row === menuAllItem) {
        if (!viewed) setRowHighlight(row, !activePlan() && !selection);
      } else if (viewed && menuRowCommit(row)?.hash === viewed.hash) {
        setRowHighlight(row, !selection || matchesView());
      }
    }
    if (footer.parentElement !== menuList || menuList.lastElementChild !== footer) {
      // The list's own bottom padding would let rows show through below the footer.
      menuList.style.paddingBottom = '0';
      menuList.append(footer);
    }
  }

  function setRowHighlight(row, allowed) {
    let undo = removedHighlights.get(row);
    if (allowed) {
      if (!undo) return;
      undo.forEach((restore) => restore());
      removedHighlights.delete(row);
      row.removeAttribute('data-bpd-not-current');
      return;
    }
    if (!undo) removedHighlights.set(row, (undo = []));
    row.setAttribute('data-bpd-not-current', '');
    for (const node of [row, ...row.querySelectorAll('*')]) {
      for (const name of [...node.classList]) {
        if (!/active|selected|current|focus/i.test(name)) continue;
        node.classList.remove(name);
        undo.push(() => node.classList.add(name));
      }
      for (const attribute of ['aria-selected', 'aria-current']) {
        if (!node.hasAttribute(attribute)) continue;
        const value = node.getAttribute(attribute);
        node.removeAttribute(attribute);
        undo.push(() => node.setAttribute(attribute, value));
      }
    }
  }

  // Looks for the menu only just after a click, because searching a large diff's
  // text on every change to the page would be slow.
  function syncMenu() {
    if (menuList && !menuList.isConnected) {
      menuList = null;
      menuAllItem = null;
      footer.remove();
      discardChanges();
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
    try {
      const loaded = await provider.loadPr(pr);
      if (run !== loadId) return;
      commits = loaded.commits;
      baseHash = loaded.baseHash;
      seedSelection();
      markRows();
      syncMenu();
      renderActions();
    } catch (error) {
      if (run !== loadId) return;
      actionMessage = error.message;
      renderActions();
    }
  }

  // The actions: in the Diff menu's footer while it's open, or a bar on the Commits tab

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
    if (planActive) planSeenAt ??= Date.now();

    // Only what changes how far to trust the view stays on screen by itself.
    const warning = planActive ? filterWarning() : '';
    const unchecked = planActive && plan.unchecked
      ? `${plan.unchecked} ${plan.unchecked === 1 ? 'file is' : 'files are'} shown in full, because this PR is too big to check every file.`
      : '';
    setText(notice, warning || unchecked);
    notice.hidden = !(warning || unchecked);

    const menuOpen = Boolean(menuList?.isConnected);
    const home = menuOpen ? footer.shadowRoot : bar;
    if (actions.parentNode !== home) home.append(actions);

    const changed = hasChange();
    const span = selectedIndexes();
    let text = actionMessage;
    if (!text && changed) text = span ? selectionSummary() : 'No commits ticked';
    const showingSummary = !text && planActive;
    if (showingSummary) text = spanSummary(plan);
    if (!text && menuOpen && !viewedCommit()) text = 'Tick the commits you want to review.';
    setText(actionText, text);
    actionText.hidden = !text;
    actionText.title = showingSummary ? spanNotes(plan) : '';
    actionText.style.cursor = showingSummary ? 'help' : '';

    applyButton.hidden = !changed;
    applyButton.disabled = preparing;
    if (!preparing) {
      const count = span ? span.oldest - span.newest + 1 : 0;
      setText(applyButton, span ? `Show ${count} ${count === 1 ? 'commit' : 'commits'}` : 'Show all changes');
    }
    clearButton.hidden = !changed;
    readOnlyButton.hidden = !span || (Boolean(viewedCommit()) && !changed);
    readOnlyButton.disabled = preparing;

    bar.hidden = menuOpen || !(COMMITS_PAGE.test(location.pathname) && (changed || actionMessage));
  }

  // Saves what to keep, then reloads into the Diff tab, where the page hook applies it.
  async function applySelection() {
    if (!selection) {
      showAllChanges();
      return;
    }
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
    applyButton.textContent = 'Preparing…';
    renderActions();
    try {
      const prepared = await prepareSpan(provider, pr, range, {
        isStale,
        onProgress: (done, total) => {
          applyButton.textContent = `Preparing ${done} of ${total}…`;
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
    }
    // Bitbucket fills in its "6 commits" line after the title, and can redraw it.
    if (!menuSubtitle?.isConnected) {
      menuSubtitle = null;
      let box = menuTitle.parentElement;
      for (let i = 0; box && box !== document.body && i < 4 && !menuSubtitle; i++, box = box.parentElement) {
        menuSubtitle = findText(box, (text) => /^\d+ commits?$/.test(text));
      }
      if (menuSubtitle) menuNativeSubtitle = menuSubtitle.data;
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

  // Choosing "All changes" in the open menu should do what it says. On a single commit's
  // page, Bitbucket goes to the Diff tab itself, which mustn't then filter.
  function handleAllChangesItem(event) {
    if (!MENU_PAGE.test(location.pathname) || !activePlan()) return;
    const onDiffTab = DIFF_PAGE.test(location.pathname);
    if (onDiffTab && !menuTitle?.isConnected) return;
    for (let node = event.target; node && node !== document.body && node.textContent.length < 200; node = node.parentElement) {
      if (!ALL_CHANGES_ITEM.test(node.textContent.trim())) continue;
      if (onDiffTab) {
        event.preventDefault();
        event.stopPropagation();
        showAllChanges();
      } else {
        sessionStorage.removeItem(storageKey(location.pathname));
        plan = null;
      }
      return;
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
    viewPath = null;
    restoreDiffMenu();
    panel.hidden = true;
    bar.hidden = true;
    notice.hidden = true;
    clearResult();
    footer.remove();
    host.remove();
    menuList = null;
    menuAllItem = null;
    menuWatchUntil = 0;
    for (const hit of document.querySelectorAll('.bpd-hit')) hit.remove();
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
    if (!host.isConnected) document.documentElement.append(host);
    syncView();
    if (COMMITS_PAGE.test(location.pathname)) {
      if (!loadRequested) load();
      markRows();
    }
    renderActions();
    labelDiffMenu();
    if (MENU_PAGE.test(location.pathname)) syncMenu();
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

  applyButton.addEventListener('click', applySelection);
  readOnlyButton.addEventListener('click', openReadOnly);
  clearButton.addEventListener('click', discardChanges);
  closePanelButton.addEventListener('click', closePanel);

  document.addEventListener('click', handleAllChangesItem, true);
  document.addEventListener('click', watchForMenu, true);
  document.addEventListener(
    'keydown',
    (event) => {
      if (event.key !== 'Escape' || panel.hidden) return;
      event.stopPropagation();
      closePanel();
    },
    true
  );

  // This callback runs before the browser paints, so the commit table's gap is there
  // the first time it's seen. The rest can wait for the next sync.
  new MutationObserver(() => {
    if (COMMITS_PAGE.test(location.pathname) && findPr(location.href)) reserveRowSpace();
    scheduleSync();
  }).observe(document.documentElement, { childList: true, subtree: true });
  sync();
  setInterval(sync, 1000);
})();
