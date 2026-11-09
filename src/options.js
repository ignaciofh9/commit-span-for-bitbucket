// Commit labels and span logic. Commits are always newest first.
(function (root) {
  function commitParts(commit) {
    return {
      hash: commit.hash.slice(0, 7),
      subject: (commit.message || '').split('\n')[0],
      author: commit.author?.user?.display_name || (commit.author?.raw || '').replace(/\s*<.*>$/, ''),
      date: (commit.date || '').slice(0, 10),
    };
  }

  function commitLabel(commit) {
    const { hash, subject, author, date } = commitParts(commit);
    return [hash, subject.slice(0, 60), author, date].filter(Boolean).join(' · ');
  }

  // What Bitbucket's Diff menu should say while a span is active. nativeSubtitle is its
  // own line, such as "5 commits", which gives the PR's total.
  function spanMenuLabel(plan, nativeSubtitle) {
    const first = plan.first.slice(0, 7);
    const last = plan.last.slice(0, 7);
    const total = nativeSubtitle?.match(/\d+/)?.[0];
    let subtitle = nativeSubtitle;
    if (plan.count) subtitle = total ? `${plan.count} of ${total} commits` : `${plan.count} ${plan.count === 1 ? 'commit' : 'commits'}`;
    return { title: first === last ? `Commit ${first}` : `Commits ${first} to ${last}`, subtitle };
  }

  // What the Diff tab is showing for a span, in a few words. spanNotes has the full story.
  function spanSummary(plan) {
    const files = Object.keys(plan.files).length;
    const shown = `${files} ${files === 1 ? 'file' : 'files'}`;
    return plan.gone || plan.notShown.length ? `${shown}. Some changes were replaced later.` : shown;
  }

  // Explains what the Diff tab is showing for a span, one sentence to a line.
  function spanNotes(plan) {
    const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;
    const files = Object.keys(plan.files).length;
    const lines = [`Showing only these commits' changes, in ${plural(files, 'file')}.`];
    const missing = [];
    if (plan.gone) missing.push(plural(plan.gone, 'line'));
    if (plan.notShown.length) missing.push(plural(plan.notShown.length, plan.gone ? 'other file' : 'file'));
    if (missing.length) {
      const one = plan.gone + plan.notShown.length === 1;
      lines.push(`Later commits changed or removed ${missing.join(' and ')} from these commits, so ${one ? "it isn't" : "they aren't"} shown. The read-only view has ${one ? 'it' : 'them'}.`);
    }
    lines.push('Comments on other lines are hidden until you choose All changes.');
    return lines.join('\n');
  }

  // What ticking commit i does to a span of list positions. Outside the span, it
  // extends the span to reach it. On an end, it unticks that commit. In the middle,
  // it drops the commits newer than it, so that commit becomes the newest.
  function nextSpan(span, i) {
    if (!span) return { newest: i, oldest: i };
    if (i < span.newest) return { newest: i, oldest: span.oldest };
    if (i > span.oldest) return { newest: span.newest, oldest: i };
    if (span.newest === span.oldest) return null;
    if (i === span.oldest) return { newest: span.newest, oldest: i - 1 };
    if (i === span.newest) return { newest: i + 1, oldest: span.oldest };
    return { newest: i, oldest: span.oldest };
  }

  // What to compare to see what a span introduced, both ends included. A span from
  // the PR's first commit compares against the target branch, and Bitbucket then
  // diffs from where the branch left it, so nothing merged from the target shows up.
  // A later span compares against the commit just before it, which does include what
  // merges brought in, so incoming lists the commits to filter out. A parent that's
  // one of the PR's own commits isn't listed, because that work is the author's.
  function spanRange(commits, baseHash, a, b) {
    const indexes = [a, b].map((hash) => commits.findIndex((commit) => commit.hash === hash));
    const newest = Math.min(...indexes);
    const oldest = Math.max(...indexes);
    const againstTarget = oldest === commits.length - 1 && Boolean(baseHash);
    const first = commits[oldest];
    const from = againstTarget ? baseHash : first.parents[0] || commits[oldest + 1]?.hash || null;
    const own = new Set(commits.map((commit) => commit.hash));
    const parents = commits.slice(newest, oldest + 1).flatMap((commit) => commit.parents);
    return {
      from,
      to: commits[newest].hash,
      first: first.hash,
      last: commits[newest].hash,
      incoming: againstTarget ? [] : [...new Set(parents)].filter((hash) => !own.has(hash) && hash !== from),
    };
  }

  // The hashes a table row mentions: links to /commits/<hash>, or a cell holding only a hash.
  function hashesInRow(hrefs, cellTexts) {
    const fromLinks = hrefs.map((href) => href.match(/\/commits\/([0-9a-f]{7,40})(?:[/?#]|$)/)?.[1]).filter(Boolean);
    const fromCells = cellTexts.filter((text) => /^[0-9a-f]{7,40}$/.test(text));
    return [...fromLinks, ...fromCells];
  }

  function commitForRow(commits, hrefs, cellTexts) {
    for (const hash of hashesInRow(hrefs, cellTexts)) {
      const commit = commits.find((candidate) => candidate.hash.startsWith(hash));
      if (commit) return commit;
    }
    return null;
  }

  const api = { commitParts, commitLabel, spanMenuLabel, spanSummary, spanNotes, nextSpan, spanRange, hashesInRow, commitForRow };
  root.PrDiff = root.PrDiff || { providers: [] };
  Object.assign(root.PrDiff, api);
  if (typeof module !== 'undefined') module.exports = api;
})(globalThis);
