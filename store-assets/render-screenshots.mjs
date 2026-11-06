// Draws the store screenshots (1280x800) with macOS's Quick Look, without opening a
// browser. They show a made-up pull request on a page laid out like Bitbucket's, with
// the extension's controls redrawn by hand, so they need updating if the controls change.
//
//   node store-assets/render-screenshots.mjs
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PAGE_CSS = readFileSync(join(HERE, '..', 'src', 'page.css'), 'utf8');

const COMMITS = [
  ['Add totals row to invoice export', 'f0e9d8c41a2', 'Sam Lee', '2 hours ago', false, 2],
  ['Handle empty invoices in the export', '7c1b2ad90e4', 'Sam Lee', 'Yesterday', false, 0],
  ["Merge branch 'develop' into invoice-export", 'd41e82f77be', 'Sam Lee', 'Yesterday', true, 0],
  ['Add CSV writer for invoice lines', 'a1b2c3d4e5f', 'Sam Lee', '2 days ago', false, 1],
  ['Rename billing helpers', '3f6e1c0b9a7', 'Sam Lee', '3 days ago', false, 0],
  ['Add export button to the invoices page', '90ab12cd34e', 'Sam Lee', '4 days ago', false, 0],
];

const CSS = `
  ${PAGE_CSS}
  * { box-sizing: border-box; }
  /* Quick Look lays pages out 1024 wide and scales them up to a 1280 square. sips can
     only crop from the centre, so the 800 tall page sits in the middle of the square. */
  html { zoom: 0.8; padding-top: 240px; }
  html, body { margin: 0; width: 1280px; height: 800px; overflow: hidden; background: #fff; color: #172b4d;
    font: 14px/20px -apple-system, "Helvetica Neue", Arial, sans-serif; }
  .caption { height: 84px; display: flex; align-items: center; padding: 0 40px; background: #0f766e; color: #fff; font-size: 26px; font-weight: 600; }
  .page { position: relative; height: 716px; padding: 20px 40px; overflow: hidden; }
  h1 { margin: 0 0 12px; font-size: 24px; line-height: 30px; font-weight: 500; }
  .tabs { display: flex; gap: 24px; margin: 0 0 16px; padding: 0; list-style: none; border-bottom: 2px solid #ebecf0; color: #42526e; font-weight: 500; }
  .tabs li { padding: 4px 2px 8px; margin-bottom: -2px; }
  .tabs .on { color: #0052cc; border-bottom: 2px solid #0052cc; }
  .columns { display: flex; gap: 16px; }
  .side { flex: none; width: 320px; }
  .trigger { display: flex; align-items: center; gap: 12px; padding: 8px 12px; border: 2px solid #4c9aff; border-radius: 3px; }
  .glyph { flex: none; width: 8px; height: 8px; border: 2px solid #42526e; border-radius: 50%; margin: 0 4px; }
  .title { font-weight: 500; }
  .sub { font-size: 12px; color: #5e6c84; }
  .tree { margin-top: 12px; font-size: 13px; color: #42526e; }
  .tree div { padding: 3px 0; }
  .tree b { display: inline-block; width: 14px; height: 14px; margin-right: 6px; border-radius: 2px; vertical-align: -2px; background: #00875a; }
  .tree .mod { background: #0052cc; }
  .code { flex: 1; min-width: 0; border: 1px solid #dfe1e6; border-radius: 3px; }
  .file { padding: 10px 12px; background: #f4f5f7; font-weight: 500; border-bottom: 1px solid #dfe1e6; }
  .line { display: flex; font: 12px/21px Menlo, monospace; white-space: pre; }
  .line span { flex: none; width: 44px; padding-right: 8px; text-align: right; color: #6b778c; }
  .add { background: #e3fcef; }
  .del { background: #ffebe6; }
  .gap { padding: 2px 12px; font-size: 12px; color: #6b778c; background: #f4f5f7; }
  .menu { position: absolute; left: 40px; top: 160px; width: 520px; background: #fff; border-radius: 3px; box-shadow: 0 4px 16px rgba(9, 30, 66, 0.35); }
  .row { position: relative; display: flex; gap: 12px; align-items: center; padding: 8px 12px; border-bottom: 1px solid #dfe1e6; }
  .row:last-child { border-bottom: 0; }
  .row .text { min-width: 0; padding-right: 22px; }
  .row .subject { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
  .row .meta { font-size: 12px; color: #5e6c84; }
  .row code { font: 12px Menlo, monospace; }
  .m { padding: 0 4px; border-radius: 2px; background: #42526e; color: #fff; font-size: 10px; font-weight: 700; }
  .row input { position: absolute; right: 4px; top: 8px; width: 14px; height: 14px; margin: 0; }
  table { width: 100%; border-collapse: collapse; }
  th { padding: 8px; text-align: left; font-size: 12px; color: #6b778c; border-bottom: 2px solid #dfe1e6; }
  td { padding: 10px 8px; border-bottom: 1px solid #dfe1e6; }
  th:first-child, td:first-child { padding-left: 32px; }
  td:first-child { position: relative; }
  td input { position: absolute; left: 8px; top: 50%; width: 14px; height: 14px; margin: -7px 0 0; }
  td code { font: 12px Menlo, monospace; color: #42526e; }
  .bar { position: absolute; left: 50%; bottom: 16px; transform: translateX(-50%); display: flex; gap: 8px; align-items: center; white-space: nowrap;
    padding: 8px 12px; border-radius: 3px; background: #fff; box-shadow: 0 4px 16px rgba(9, 30, 66, 0.35); }
  .bar span { margin-right: 8px; }
  .bar button { height: 32px; padding: 0 12px; border: 0; border-radius: 3px; font: inherit; color: #42526e; background: rgba(9, 30, 66, 0.06); }
  .bar .primary { color: #fff; background: #0052cc; }
  .bar .subtle { background: transparent; }
`;

const tabs = (on) =>
  `<ul class="tabs">${['Overview', 'Diff', 'Commits', 'Builds', 'Commit span'].map((t) => `<li class="${t === on ? 'on' : ''}">${t}</li>`).join('')}</ul>`;
const heading = '<h1>Add invoice export</h1>';
const bar = (text, ...buttons) =>
  `<div class="bar"><span>${text}</span>${buttons.map(([label, kind = '']) => `<button class="${kind}">${label}</button>`).join('')}</div>`;
const pickBar = bar('3 commits: a1b2c3d to 7c1b2ad', ['Review in Diff tab', 'primary'], ['Read-only view'], ['Clear', 'subtle']);
const trigger = (title, sub) => `<div class="trigger"><i class="glyph"></i><div><div class="title">${title}</div><div class="sub">${sub}</div></div></div>`;
const SELECTED = new Set([1, 2, 3]);

const diffBody = `
  <div class="code">
    <div class="file">src/billing/invoiceExport.ts</div>
    <div class="line"><span>41</span> function writeLines(invoice: Invoice) {</div>
    <div class="line add"><span>42</span>+  if (!invoice.lines.length) return [];</div>
    <div class="line"><span>43</span>   return invoice.lines.map(toCsvRow);</div>
    <div class="line"><span>44</span> }</div>
    <div class="gap">⋯</div>
    <div class="line"><span>87</span> export function exportInvoices(invoices: Invoice[]) {</div>
    <div class="line del"><span>88</span>-  const rows = invoices.map(writeLines);</div>
    <div class="line add"><span>88</span>+  const rows = invoices.flatMap(writeLines);</div>
    <div class="line add"><span>89</span>+  const header = csvHeader(COLUMNS);</div>
    <div class="line"><span>90</span>   return download(rows);</div>
    <div class="line"><span>91</span> }</div>
  </div>`;
const tree = '<div class="tree"><div><b class="mod"></b>invoiceExport.ts</div><div><b></b>csvWriter.ts</div><div><b class="mod"></b>InvoicesPage.tsx</div></div>';

const SCREENS = {
  'screenshot-1': {
    caption: "Tick commits right in Bitbucket's Diff menu",
    body: `${heading}${tabs('Diff')}<div class="columns"><div class="side">${trigger('All changes in this pull request', '6 commits')}${tree}</div>${diffBody}</div>
      <div class="menu"><div class="row"><i class="glyph"></i><div class="text"><div>All changes in this pull request</div><div class="sub">6 commits</div></div></div>
      ${COMMITS.map(([subject, hash, author, when, merge], i) => `<div class="row" ${SELECTED.has(i) ? 'data-bpd-selected' : ''}><i class="glyph"></i><div class="text"><div class="subject">${subject}</div><div class="meta">${author} committed <code>${hash}</code> ${merge ? '<span class="m">M</span> ' : ''}${when}</div></div><input type="checkbox" ${SELECTED.has(i) ? 'checked' : ''}></div>`).join('')}
      </div>${pickBar}`,
  },
  'screenshot-2': {
    caption: 'Review just those commits, in the real Diff tab',
    body: `${heading}${tabs('Diff')}<div class="columns"><div class="side">${trigger('Commits a1b2c3d to 7c1b2ad', '3 of 6 commits')}${tree}</div>${diffBody}</div>
      ${bar('Showing commits a1b2c3d to 7c1b2ad: 3 files.', ['Change commits'], ['Show all changes'])}`,
  },
  'screenshot-3': {
    caption: 'Or pick them from the Commits tab',
    body: `${heading}${tabs('Commits')}<table><thead><tr><th>Author</th><th>Commit</th><th>Message</th><th>Commit date</th></tr></thead><tbody>
      ${COMMITS.map(([subject, hash, author, when], i) => `<tr ${SELECTED.has(i) ? 'data-bpd-selected' : ''}><td><input type="checkbox" ${SELECTED.has(i) ? 'checked' : ''}>${author}</td><td><code>${hash}</code></td><td>${subject}</td><td>${when}</td></tr>`).join('')}
      </tbody></table>${pickBar}`,
  },
};

const work = mkdtempSync(join(tmpdir(), 'commit-span-screens-'));
try {
  for (const [name, { caption, body }] of Object.entries(SCREENS)) {
    const html = join(work, `${name}.html`);
    writeFileSync(html, `<!doctype html><meta charset="utf-8"><style>${CSS}</style><div class="caption">${caption}</div><div class="page">${body}</div>`);
    execFileSync('qlmanage', ['-t', '-s', '1280', '-o', work, html], { stdio: 'ignore', timeout: 60000 });
    execFileSync('sips', ['-c', '800', '1280', `${html}.png`, '--out', `${html}.png`], { stdio: 'ignore' });
    execFileSync('sips', ['-s', 'format', 'png', `${html}.png`, '--out', join(HERE, `${name}.png`)], { stdio: 'ignore' });
    console.log(execFileSync('sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', join(HERE, `${name}.png`)], { encoding: 'utf8' }).replace(/\s+/g, ' '));
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}
