#!/usr/bin/env python3
# Writes docs/demo/data.json: a made-up pull request with a real merge, built as a real
# git repo in a temp folder, with every diff the demo page's fake API can be asked for.
#
#   python3 store-assets/make-demo-data.py
import json, os, shutil, subprocess, tempfile

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'docs', 'demo', 'data.json')
work = tempfile.mkdtemp(prefix='commit-span-demo-')
clock = 1762400000


def git(*args, author='Sam Lee', email='sam@example.com'):
    date = f'{clock} +0000'
    env = {**os.environ, 'GIT_AUTHOR_NAME': author, 'GIT_AUTHOR_EMAIL': email, 'GIT_COMMITTER_NAME': author, 'GIT_COMMITTER_EMAIL': email, 'GIT_AUTHOR_DATE': date, 'GIT_COMMITTER_DATE': date}
    return subprocess.run(['git', '-c', 'commit.gpgsign=false', *args], cwd=work, env=env, check=True, capture_output=True, text=True).stdout


def write(path, text):
    full = os.path.join(work, path)
    os.makedirs(os.path.dirname(full), exist_ok=True)
    with open(full, 'w') as f:
        f.write(text)


def replace(path, old, new):
    full = os.path.join(work, path)
    text = open(full).read()
    assert old in text, old
    with open(full, 'w') as f:
        f.write(text.replace(old, new, 1))


def commit(message, **who):
    global clock
    clock += 3600
    git('add', '-A')
    git('commit', '-qm', message, **who)


git('init', '-q', '-b', 'develop')
write('README.md', '# Invoice service\n\nCreates and exports customer invoices.\n\n## Running it\n\n    npm install\n    npm start\n')
write('src/billing/tax.ts', '''export interface TaxRule {
  region: string;
  rate: number;
}

export const DEFAULT_RULES: TaxRule[] = [
  { region: "EU", rate: 0.2 },
  { region: "UK", rate: 0.2 },
  { region: "US", rate: 0.0 },
];

export function rateFor(region: string, rules = DEFAULT_RULES): number {
  const rule = rules.find((r) => r.region === region);
  return rule ? rule.rate : 0;
}

export function taxFor(amount: number, region: string): number {
  return amount * rateFor(region);
}
''')
write('src/billing/invoice.ts', '''import { taxFor } from "./tax";

export interface InvoiceLine {
  description: string;
  quantity: number;
  unitPrice: number;
}

export interface Invoice {
  id: string;
  customer: string;
  region: string;
  issuedOn: string;
  lines: InvoiceLine[];
}

export function lineTotal(line: InvoiceLine): number {
  return line.quantity * line.unitPrice;
}

export function subtotal(invoice: Invoice): number {
  return invoice.lines.reduce((sum, line) => sum + lineTotal(line), 0);
}

export function total(invoice: Invoice): number {
  const net = subtotal(invoice);
  return net + taxFor(net, invoice.region);
}
''')
write('src/billing/invoiceExport.ts', '''import { Invoice, lineTotal } from "./invoice";

const COLUMNS = ["invoice", "customer", "description", "quantity", "price"];

function rowsFor(invoice: Invoice): string[][] {
  return invoice.lines.map((line) => [
    invoice.id,
    invoice.customer,
    line.description,
    String(line.quantity),
    lineTotal(line).toFixed(2),
  ]);
}

export function exportInvoices(invoices: Invoice[]): string {
  const rows = invoices.flatMap(rowsFor);
  return [COLUMNS, ...rows].map((row) => row.join(",")).join("\\n");
}
''')
write('src/pages/InvoicesPage.tsx', '''import { Invoice, total } from "../billing/invoice";

interface Props {
  invoices: Invoice[];
}

export function InvoicesPage({ invoices }: Props) {
  return (
    <main>
      <h1>Invoices</h1>
      <table>
        <tbody>
          {invoices.map((invoice) => (
            <tr key={invoice.id}>
              <td>{invoice.id}</td>
              <td>{invoice.customer}</td>
              <td>{total(invoice).toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
''')
commit('Set up the invoice service', author='Alex Kim', email='alex@example.com')

git('checkout', '-qb', 'invoice-export')
replace('src/pages/InvoicesPage.tsx', 'import { Invoice, total } from "../billing/invoice";\n', 'import { Invoice, total } from "../billing/invoice";\nimport { exportInvoices } from "../billing/invoiceExport";\nimport { download } from "./download";\n')
replace('src/pages/InvoicesPage.tsx', '      <h1>Invoices</h1>\n', '      <h1>Invoices</h1>\n      <button onClick={() => download("invoices.csv", exportInvoices(invoices))}>\n        Export CSV\n      </button>\n')
write('src/pages/download.ts', '''export function download(name: string, contents: string): void {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([contents], { type: "text/csv" }));
  link.download = name;
  link.click();
  URL.revokeObjectURL(link.href);
}
''')
commit('Add export button to the invoices page')

write('src/billing/csvWriter.ts', '''export function toCsv(rows: string[][]): string {
  return rows.map((row) => row.join(",")).join("\\n");
}
''')
replace('src/billing/invoiceExport.ts', 'import { Invoice, lineTotal } from "./invoice";\n', 'import { toCsv } from "./csvWriter";\nimport { Invoice, lineTotal } from "./invoice";\n')
replace('src/billing/invoiceExport.ts', '  return [COLUMNS, ...rows].map((row) => row.join(",")).join("\\n");\n', '  return toCsv([COLUMNS, ...rows]);\n')
commit('Move CSV writing into its own file')

replace('src/billing/invoiceExport.ts', 'export function exportInvoices(invoices: Invoice[]): string {\n', 'export function exportInvoices(invoices: Invoice[]): string {\n  if (invoices.length === 0) return "";\n')
commit('Handle an empty invoice list in the export')

git('checkout', '-q', 'develop')
replace('src/billing/tax.ts', '  return amount * rateFor(region);\n', '  return Math.round(amount * rateFor(region) * 100) / 100;\n')
replace('src/billing/tax.ts', '  { region: "US", rate: 0.0 },\n', '  { region: "US", rate: 0.0 },\n  { region: "CA", rate: 0.05 },\n')
replace('src/billing/invoice.ts', '  issuedOn: string;\n', '  issuedOn: string;\n  dueOn: string;\n')
commit('Round tax to two decimals and add Canada', author='Alex Kim', email='alex@example.com')

git('checkout', '-q', 'invoice-export')
clock += 3600
git('merge', '-q', '--no-ff', '-m', "Merge branch 'develop' into invoice-export", 'develop')

replace('src/billing/invoiceExport.ts', 'import { Invoice, lineTotal } from "./invoice";\n', 'import { Invoice, lineTotal, subtotal } from "./invoice";\n')
replace('src/billing/invoiceExport.ts', '  const rows = invoices.flatMap(rowsFor);\n', '  const rows = invoices.flatMap(rowsFor);\n  const net = invoices.reduce((sum, invoice) => sum + subtotal(invoice), 0);\n  rows.push(["", "", "Total", "", net.toFixed(2)]);\n')
commit('Add a totals row to the export')

write('src/billing/csvWriter.ts', '''function escapeValue(value: string): string {
  return /[",\\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function toCsv(rows: string[][]): string {
  return rows.map((row) => row.map(escapeValue).join(",")).join("\\n");
}
''')
commit('Escape quotes and commas in CSV values')

git('checkout', '-q', 'develop')
replace('README.md', '    npm start\n', '    npm start\n\n## Tests\n\n    npm test\n')
commit('Document how to run the tests', author='Alex Kim', email='alex@example.com')
git('checkout', '-q', 'invoice-export')


def to_diff(patch):
    # The same shape as Bitbucket's diff responses.
    hunks = []
    hunk = segment = None
    source = destination = 0
    for line in patch.split('\n'):
        if line.startswith('@@'):
            parts = line.split(' ')
            source = int(parts[1][1:].split(',')[0])
            destination = int(parts[2][1:].split(',')[0])
            hunk = {'sourceLine': source, 'destinationLine': destination, 'segments': []}
            hunks.append(hunk)
            segment = None
            continue
        if hunk is None or line.startswith('\\') or not line:
            continue
        kind = {'+': 'ADDED', '-': 'REMOVED', ' ': 'CONTEXT'}.get(line[0])
        if not kind:
            continue
        if not segment or segment['type'] != kind:
            segment = {'type': kind, 'lines': []}
            hunk['segments'].append(segment)
        segment['lines'].append({'line': line[1:], 'source': source, 'destination': destination})
        if kind != 'ADDED':
            source += 1
        if kind != 'REMOVED':
            destination += 1
    return {'hunks': hunks}


def compare(newer, older):
    # What's in newer but not older, like Bitbucket's compare endpoints.
    spec = f'{older}...{newer}'
    changes = []
    diffs = {}
    for row in git('diff', '--name-status', '--no-renames', spec).strip().split('\n'):
        if not row:
            continue
        status, path = row.split('\t')
        changes.append({'path': {'components': path.split('/')}, 'type': {'A': 'ADD', 'D': 'DELETE', 'M': 'MODIFY'}[status]})
        diffs[path] = to_diff(git('diff', '-U10', spec, '--', path))
    return {'changes': changes, 'diffs': diffs}


commits = []
for row in git('log', '--format=%H %P%x09%at%x09%an%x09%s', 'develop..invoice-export').strip().split('\n'):
    ids, when, author, subject = row.split('\t')
    commit_id, *parents = ids.split(' ')
    commits.append({
        'id': commit_id,
        'displayId': commit_id[:11],
        'message': subject,
        'authorTimestamp': int(when) * 1000,
        'author': {'name': author, 'displayName': author},
        'parents': [{'id': parent} for parent in parents],
    })

target = git('rev-parse', 'develop').strip()
tip = commits[0]['id']
refs = {commit['id'] for commit in commits} | {parent['id'] for commit in commits for parent in commit['parents']} | {target}
data = {
    'title': 'Add invoice export',
    'fromBranch': 'invoice-export',
    'toBranch': 'develop',
    'tip': tip,
    'target': target,
    'base': git('merge-base', 'develop', 'invoice-export').strip(),
    'commits': commits,
    'whole': compare(tip, target),
    # Only what the extension asks for: from any ref, to a ref it might compare against.
    'compare': {f'{newer}|{older}': compare(newer, older) for newer in refs for older in refs if newer != older},
}

os.makedirs(os.path.dirname(OUT), exist_ok=True)
with open(OUT, 'w') as f:
    json.dump(data, f, separators=(',', ':'))
shutil.rmtree(work)
print(f'{len(commits)} commits, {len(data["compare"])} comparisons, {os.path.getsize(OUT) // 1024} KB')
for commit in commits:
    print(commit['displayId'], len(commit['parents']), commit['message'])
