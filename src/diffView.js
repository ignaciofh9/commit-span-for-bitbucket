// Draws one file of a span's diff. All repo content goes in as text, never as HTML.
(function (root) {
  const OPEN_UP_TO_ROWS = 1000;
  const KINDS = { ADD: 'Added', DELETE: 'Deleted', MOVE: 'Renamed', COPY: 'Copied' };

  const DIFF_CSS = `
    .summary { margin-bottom: 8px; }
    .summary details { margin-top: 4px; font-size: 12px; color: var(--ds-text-subtle, #5e6c84); }
    .file { border: 1px solid var(--ds-border, #dfe1e6); border-radius: 3px; margin-top: 10px; }
    .file > summary { cursor: pointer; padding: 8px 10px; background: var(--ds-surface-sunken, #f4f5f7); }
    .path { font-weight: 600; word-break: break-all; }
    .kind, .stat, .file-note { color: var(--ds-text-subtle, #5e6c84); font-size: 12px; margin-left: 8px; }
    .body { overflow-x: auto; }
    .message { padding: 8px 10px; color: var(--ds-text-subtle, #5e6c84); font-size: 12px; }
    .diff { border-collapse: collapse; width: 100%; }
    .diff td { padding: 0 8px; font-family: SFMono-Regular, Consolas, Menlo, monospace; font-size: 12px; line-height: 20px; vertical-align: top; }
    .diff .num { width: 1%; min-width: 40px; text-align: right; color: var(--ds-text-subtlest, #6b778c); user-select: none; }
    .diff .code { white-space: pre; }
    .diff .ADDED { background: var(--ds-background-success, #e3fcef); }
    .diff .REMOVED { background: var(--ds-background-danger, #ffebe6); }
    .diff .gap td, .diff .HIDDEN td, .diff .OVERLAP td { font-family: inherit; color: var(--ds-text-subtle, #42526e); background: var(--ds-surface-sunken, #f4f5f7); }
    .diff .OVERLAP td { background: var(--ds-background-warning, #fffae6); }
  `;

  function el(tag, props = {}, ...children) {
    const node = Object.assign(document.createElement(tag), props);
    node.append(...children);
    return node;
  }

  function noteRow(className, text) {
    return el('tr', { className }, el('td', { colSpan: 3, textContent: text }));
  }

  function diffRow(row) {
    if (row.type === 'HIDDEN') {
      return noteRow('HIDDEN', `${row.count} ${row.count === 1 ? 'line' : 'lines'} from a merge hidden`);
    }
    if (row.type === 'OVERLAP') return noteRow('OVERLAP', 'A merge changed some of these lines too, so check them');
    const sign = { ADDED: '+', REMOVED: '-', CONTEXT: ' ' }[row.type];
    return el(
      'tr',
      { className: row.type },
      el('td', { className: 'num', textContent: row.type === 'ADDED' ? '' : (row.source ?? '') }),
      el('td', { className: 'num', textContent: row.type === 'REMOVED' ? '' : (row.destination ?? '') }),
      el('td', { className: 'code', textContent: `${sign} ${row.text}` })
    );
  }

  function diffTable(hunks) {
    const table = el('table', { className: 'diff' });
    hunks.forEach((hunk, i) => {
      if (i > 0) table.append(noteRow('gap', '⋯'));
      table.append(...hunk.rows.map(diffRow));
    });
    return table;
  }

  // A placeholder, so files stay in order however they finish loading.
  function fileShell(change) {
    const summary = el('summary', {}, el('span', { className: 'path', textContent: change.path }));
    if (KINDS[change.type]) summary.append(el('span', { className: 'kind', textContent: KINDS[change.type] }));
    const body = el('div', { className: 'body' }, el('div', { className: 'message', textContent: 'Loading…' }));
    return el('details', { className: 'file', open: true }, summary, body);
  }

  function fillFile(shell, result) {
    const summary = shell.querySelector('summary');
    const body = shell.querySelector('.body');
    const message = (text) => body.replaceChildren(el('div', { className: 'message', textContent: text }));
    if (result.error) {
      message(`Could not load this file. ${result.error}`);
      return;
    }
    if (result.hiddenWhole) {
      shell.hidden = true;
      return;
    }
    if (result.added || result.removed) {
      summary.append(el('span', { className: 'stat', textContent: `+${result.added} -${result.removed}` }));
    }
    if (result.hiddenLines) {
      summary.append(el('span', { className: 'file-note', textContent: `${result.hiddenLines} merged lines hidden` }));
    }
    if (result.binary) {
      message('Binary file. It may also have been changed by a merge.');
      return;
    }
    if (!result.hunks.length) {
      message('No line changes.');
      return;
    }
    const rowCount = result.hunks.reduce((total, hunk) => total + hunk.rows.length, 0);
    const draw = () => {
      body.replaceChildren(diffTable(result.hunks));
      if (result.truncated) body.append(el('div', { className: 'message', textContent: 'Bitbucket cut this diff short.' }));
    };
    if (rowCount <= OPEN_UP_TO_ROWS) {
      draw();
      return;
    }
    shell.open = false;
    message('Large file.');
    shell.addEventListener('toggle', draw, { once: true });
  }

  root.PrDiff = root.PrDiff || { providers: [] };
  Object.assign(root.PrDiff, { DIFF_CSS, el, fileShell, fillFile });
})(globalThis);
