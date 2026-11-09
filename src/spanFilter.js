// Narrows the PR's own diff to a span. Pure logic, used by both the content script
// and the page hook. Keeps real line numbers, so comments land on the right lines.
(function (root) {
  const rowKey = (row) => `${row.type} ${row.text}`;
  const meaningful = (text) => /[a-z0-9]/i.test(text);

  // Runs of changed rows, as [start, end] pairs.
  function changedBlocks(rows) {
    const blocks = [];
    let start = null;
    rows.forEach((row, i) => {
      const changed = row.type !== 'CONTEXT';
      if (changed && start === null) start = i;
      if (!changed && start !== null) {
        blocks.push([start, i]);
        start = null;
      }
    });
    if (start !== null) blocks.push([start, rows.length]);
    return blocks;
  }

  // A block stays if it shares a real line with the span. Matching only on "}" isn't
  // enough, unless the whole block is that sort of line.
  function blockInSpan(block, keys) {
    const hits = block.filter((row) => keys.has(rowKey(row)));
    return hits.some((row) => meaningful(row.text)) || (hits.length > 0 && hits.length === block.length);
  }

  // Which changed rows of a diff belong to the span, as a set of row positions. Blocks
  // that mix removed and added lines stay whole, since a removal shown without its
  // replacement would mislead. A block that's only added lines, such as all of a file
  // the PR created, is narrowed line by line, so only the span's own lines show.
  // A merge conflict always stays visible.
  function rowsInSpan(rows, keys, isConflict) {
    const kept = new Set();
    for (const [start, end] of changedBlocks(rows)) {
      const block = rows.slice(start, end);
      const positions = block.map((_, i) => start + i);
      const types = new Set(block.map((row) => row.type));
      if (block.some(isConflict) || (types.size > 1 && blockInSpan(block, keys))) {
        positions.forEach((i) => kept.add(i));
        continue;
      }
      if (types.size > 1) continue;
      const hits = positions.filter((i) => keys.has(rowKey(rows[i])));
      const real = hits.filter((i) => meaningful(rows[i].text));
      // Lines like "}" count only beside the span's real lines, or if that's all there is.
      const keep = real.length ? hits : hits.length === block.length ? hits : [];
      keep.forEach((i) => kept.add(i));
    }
    return kept;
  }

  function storageKey(pathname) {
    const m = pathname.match(/^(.*\/pull-requests\/\d+)(?:\/|$)/);
    return m && `bpd-span:${m[1]}`;
  }

  // What to keep for one file, from the span's rows and the PR's whole diff.
  function planFile(spanResult, prDiff) {
    if (spanResult.error || spanResult.binary || prDiff.binary) return { all: true, kept: true, gone: 0 };
    const spanRows = spanResult.hunks.flatMap((hunk) => hunk.rows).filter((row) => row.type === 'ADDED' || row.type === 'REMOVED');
    const keys = new Set(spanRows.map(rowKey));
    const shown = new Set();
    for (const { rows } of prDiff.hunks) {
      rowsInSpan(rows, keys, (row) => row.conflict).forEach((i) => shown.add(rowKey(rows[i])));
    }
    const gone = spanRows.filter((row) => row.type === 'ADDED' && meaningful(row.text) && !shown.has(rowKey(row))).length;
    return { keys: [...keys], kept: shown.size > 0, gone };
  }

  function buildHunk(hunk, rows) {
    const segments = [];
    for (const { type, line, segment } of rows) {
      const last = segments[segments.length - 1];
      if (last && last.type === type) last.lines.push(line);
      else segments.push({ ...segment, lines: [line] });
    }
    return {
      ...hunk,
      sourceLine: rows[0].line.source,
      destinationLine: rows[0].line.destination,
      sourceSpan: rows.filter((row) => row.type !== 'ADDED').length,
      destinationSpan: rows.filter((row) => row.type !== 'REMOVED').length,
      segments,
    };
  }

  // Splits a hunk around each hidden change, so line numbers stay continuous in each piece.
  function filterHunk(hunk, keys) {
    const rows = (hunk.segments || []).flatMap((segment) =>
      (segment.lines || []).map((line) => ({ type: segment.type, text: line.line, line, segment }))
    );
    const kept = rowsInSpan(rows, keys, (row) => row.line.conflictMarker);
    const pieces = [];
    let piece = [];
    let hasChanges = false;
    const finishPiece = () => {
      if (hasChanges) pieces.push(buildHunk(hunk, piece));
      piece = [];
      hasChanges = false;
    };
    rows.forEach((row, i) => {
      if (row.type === 'CONTEXT') {
        piece.push(row);
      } else if (kept.has(i)) {
        piece.push(row);
        hasChanges = true;
      } else {
        finishPiece();
      }
    });
    finishPiece();
    return pieces;
  }

  function filterOneDiff(diff, file) {
    if (file?.all) return diff;
    const keys = new Set(file?.keys || []);
    const hunks = (diff.hunks || []).flatMap((hunk) => filterHunk(hunk, keys));
    const commentIds = new Set(hunks.flatMap((hunk) => hunk.segments.flatMap((s) => s.lines.flatMap((l) => l.commentIds || []))));
    const out = { ...diff, hunks };
    if (diff.lineComments) out.lineComments = diff.lineComments.filter((comment) => commentIds.has(comment.id));
    return out;
  }

  // The spec describes a single diff, but the response may wrap it in a "diffs" list.
  function filterDiffResponse(data, file) {
    if (data.diffs) return { ...data, diffs: data.diffs.map((diff) => filterOneDiff(diff, file)) };
    return filterOneDiff(data, file);
  }

  const pathOf = (path) => (path?.components ? path.components.join('/') : typeof path?.toString === 'string' ? path.toString : '');

  function filterChanges(data, plan) {
    const values = (data.values || []).filter((change) => plan.files[pathOf(change.path)]);
    return { ...data, values, size: values.length };
  }

  const api = { rowKey, changedBlocks, storageKey, planFile, filterDiffResponse, filterChanges };
  root.PrDiff = root.PrDiff || { providers: [] };
  Object.assign(root.PrDiff, api);
  if (typeof module !== 'undefined') module.exports = api;
})(globalThis);
