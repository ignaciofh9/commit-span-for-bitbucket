// Works out what a span's author wrote, leaving out what merges brought in.
// When unsure, it keeps a change and flags it: hiding real work is the worse mistake.
(function (root) {
  const { rowKey, changedBlocks, planFile } = root.PrDiff;
  const MAX_FILES = 200;
  const FILES_AT_ONCE = 6;

  const blockKey = (rows) => JSON.stringify(rows.map((row) => [row.type, row.text]));

  // A block is hidden only if a merge made exactly that change. Anything else stays,
  // such as a conflict resolution or an edit right next to merged lines. It's flagged
  // if at least half of its lines also came from a merge.
  function filterFile(diff, incomingDiffs) {
    const mergedBlocks = new Set();
    const mergedRows = new Set();
    for (const incoming of incomingDiffs) {
      for (const { rows } of incoming.hunks) {
        for (const [start, end] of changedBlocks(rows)) {
          const block = rows.slice(start, end);
          mergedBlocks.add(blockKey(block));
          block.forEach((row) => mergedRows.add(rowKey(row)));
        }
      }
    }

    const hunks = [];
    let hiddenLines = 0;
    let added = 0;
    let removed = 0;
    let overlaps = 0;
    for (const { rows } of diff.hunks) {
      const kept = [];
      let cursor = 0;
      let hasChanges = false;
      for (const [start, end] of changedBlocks(rows)) {
        kept.push(...rows.slice(cursor, start));
        const block = rows.slice(start, end);
        cursor = end;
        if (mergedBlocks.has(blockKey(block))) {
          kept.push({ type: 'HIDDEN', count: block.length });
          hiddenLines += block.length;
          continue;
        }
        const shared = block.filter((row) => /[a-z0-9]/i.test(row.text) && mergedRows.has(rowKey(row))).length;
        if (shared > 0 && shared * 2 >= block.length) {
          kept.push({ type: 'OVERLAP' });
          overlaps++;
        }
        kept.push(...block);
        hasChanges = true;
        added += block.filter((row) => row.type === 'ADDED').length;
        removed += block.filter((row) => row.type === 'REMOVED').length;
      }
      kept.push(...rows.slice(cursor));
      if (hasChanges) hunks.push({ rows: kept });
    }
    return {
      hunks,
      added,
      removed,
      hiddenLines,
      overlaps,
      binary: diff.binary,
      truncated: diff.truncated,
      hiddenWhole: hiddenLines > 0 && hunks.length === 0,
    };
  }

  async function inParallel(items, isStale, work) {
    let next = 0;
    async function worker() {
      while (next < items.length && !isStale()) {
        const index = next++;
        await work(items[index], index);
      }
    }
    await Promise.all(Array.from({ length: FILES_AT_ONCE }, worker));
  }

  // Calls onPlan with the files to show, then onFile as each one is ready, in any order.
  async function loadSpan(provider, pr, range, { onPlan, onFile, isStale = () => false }) {
    const changes = await provider.listChanges(pr, range.to, range.from);
    const merges = await Promise.all(
      range.incoming.map(async (hash) => {
        const merged = await provider.listChanges(pr, hash, range.from);
        return { hash, paths: new Set(merged.map((change) => change.path)) };
      })
    );
    if (isStale()) return;
    const files = changes.slice(0, MAX_FILES);
    onPlan(files, changes.length);

    await inParallel(files, isStale, async (change, index) => {
      let result;
      try {
        const diff = await provider.fileDiff(pr, range.to, range.from, change);
        const touching = merges.filter(({ paths }) => paths.has(change.path));
        const incoming = await Promise.all(
          touching.map(({ hash }) => provider.fileDiff(pr, hash, range.from, { path: change.path }))
        );
        result = filterFile(diff, incoming);
      } catch (error) {
        result = { error: error.message };
      }
      if (!isStale()) onFile(index, result);
    });
  }

  // Works out what the Diff tab should keep. Files the author changed in the span
  // that have nothing left in the PR's whole diff are listed in notShown.
  async function prepareSpan(provider, pr, range, { onProgress = () => {}, isStale = () => false } = {}) {
    const prChanges = new Map((await provider.prChanges(pr)).map((change) => [change.path, change]));
    let files = [];
    let total = 0;
    const results = [];
    await loadSpan(provider, pr, range, {
      isStale,
      onPlan(list, count) {
        files = list;
        total = count;
      },
      onFile(index, result) {
        results[index] = result;
        onProgress(results.filter(Boolean).length, files.length);
      },
    });
    const plan = { first: range.first, last: range.last, files: {}, notShown: [], gone: 0, total, truncated: total > files.length };
    const authored = files.map((change, index) => ({ change, result: results[index] })).filter(({ result }) => result && !result.hiddenWhole);
    await inParallel(authored, isStale, async ({ change, result }) => {
      const prChange = prChanges.get(change.path);
      if (!prChange) {
        plan.notShown.push(change.path);
        return;
      }
      let file;
      try {
        file = planFile(result, await provider.prFileDiff(pr, prChange));
      } catch {
        file = { all: true, kept: true, gone: 0 };
      }
      plan.gone += file.gone;
      if (file.kept) plan.files[change.path] = file.all ? { all: true } : { keys: file.keys };
      else plan.notShown.push(change.path);
    });
    return plan;
  }

  const api = { filterFile, loadSpan, prepareSpan };
  Object.assign(root.PrDiff, api);
  if (typeof module !== 'undefined') module.exports = api;
})(globalThis);
