// Bitbucket Data Center provider, written from Atlassian's REST spec. Beyond the
// shared functions, it adds listChanges and fileDiff, which power the author-only diff.
(function (root) {
  const { getJson } = root.PrDiff;

  // Personal repos live under /users/NAME, and their project key is ~NAME.
  // The prefix covers servers hosted under a path, such as /bitbucket.
  function matchPr(href) {
    const { pathname } = new URL(href);
    const m = pathname.match(/^(.*?)\/(projects|users)\/([^/]+)\/repos\/([^/]+)\/pull-requests\/(\d+)(?:\/|$)/);
    if (!m) return null;
    const [, prefix, kind, owner, repo, id] = m;
    const project = kind === 'users' ? `~${owner}` : owner;
    return { prefix, kind, owner, project, repo, id, key: `dc${prefix}/${project}/${repo}/${id}` };
  }

  const repoApi = (pr) => `${pr.prefix}/rest/api/latest/projects/${pr.project}/repos/${pr.repo}`;

  async function allPages(url, fetchFn) {
    const values = [];
    const join = url.includes('?') ? '&' : '?';
    let start = 0;
    while (start !== null) {
      const page = await getJson(`${url}${join}limit=100&start=${start}`, fetchFn);
      values.push(...(page.values || []));
      start = page.isLastPage === false ? (page.nextPageStart ?? null) : null;
    }
    return values;
  }

  function toCommit(commit) {
    const ms = commit.authorTimestamp;
    return {
      hash: commit.id,
      message: commit.message,
      parents: (commit.parents || []).map((parent) => parent.id),
      date: ms ? new Date(ms).toISOString() : '',
      author: { user: { display_name: commit.author?.displayName || commit.author?.name || '' } },
    };
  }

  // Commits come back newest first. baseHash is the target branch's commit, so
  // comparing against it shows everything the PR changes up to the chosen commit.
  async function loadPr(pr, fetchFn = fetch) {
    const base = `${repoApi(pr)}/pull-requests/${pr.id}`;
    const details = await getJson(base, fetchFn);
    const commits = await allPages(`${base}/commits`, fetchFn);
    return { commits: commits.map(toCommit), baseHash: details.toRef?.latestCommit || null };
  }

  const pathString = (path) => path && (path.components ? path.components.join('/') : path.toString);

  // Both compare calls return what's in newer but not in older.
  async function listChanges(pr, newer, older, fetchFn = fetch) {
    const changes = await allPages(`${repoApi(pr)}/compare/changes?from=${newer}&to=${older}`, fetchFn);
    return changes.map((change) => ({ path: pathString(change.path), srcPath: pathString(change.srcPath), type: change.type }));
  }

  const encodePath = (path) => path.split('/').map(encodeURIComponent).join('/');
  const srcPathParam = (change) => (change.srcPath ? `&srcPath=${encodeURIComponent(change.srcPath)}` : '');

  async function fileDiff(pr, newer, older, change, fetchFn = fetch) {
    const url = `${repoApi(pr)}/compare/diff/${encodePath(change.path)}?from=${newer}&to=${older}&contextLines=3${srcPathParam(change)}`;
    return toFileDiff(await getJson(url, fetchFn));
  }

  // The PR's whole diff, as its Diff tab shows it.
  async function prChanges(pr, fetchFn = fetch) {
    // Not paged, according to the spec: one page is all the server returns.
    const page = await getJson(`${repoApi(pr)}/pull-requests/${pr.id}/changes?limit=1000&withComments=false`, fetchFn);
    return (page.values || []).map((change) => ({ path: pathString(change.path), srcPath: pathString(change.srcPath), type: change.type }));
  }

  async function prFileDiff(pr, change, fetchFn = fetch) {
    const url = `${repoApi(pr)}/pull-requests/${pr.id}/diff/${encodePath(change.path)}?contextLines=3&withComments=false${srcPathParam(change)}`;
    return toFileDiff(await getJson(url, fetchFn));
  }

  function toFileDiff(data) {
    // The spec describes a single diff, but the response may wrap it in a "diffs" list.
    const diff = (data.diffs ? data.diffs[0] : data) || {};
    let truncated = Boolean(data.truncated || diff.truncated);
    const hunks = (diff.hunks || []).map((hunk) => {
      const rows = [];
      for (const segment of hunk.segments || []) {
        truncated = truncated || Boolean(hunk.truncated || segment.truncated);
        for (const line of segment.lines || []) {
          rows.push({ type: segment.type, text: line.line, source: line.source, destination: line.destination, conflict: line.conflictMarker });
        }
      }
      return { rows };
    });
    return { hunks, binary: Boolean(diff.binary), truncated };
  }

  // The compare page shows what's in sourceBranch but not targetBranch.
  function compareUrl(pr, fromHash, toHash) {
    return `${pr.prefix}/${pr.kind}/${pr.owner}/repos/${pr.repo}/compare/diff?sourceBranch=${toHash}&targetBranch=${fromHash}`;
  }

  const diffTabUrl = (pr) => `${pr.prefix}/${pr.kind}/${pr.owner}/repos/${pr.repo}/pull-requests/${pr.id}/diff`;

  const provider = { matchPr, loadPr, compareUrl, listChanges, fileDiff, prChanges, prFileDiff, diffTabUrl };
  root.PrDiff.providers.push(provider);
  if (typeof module !== 'undefined') module.exports = provider;
})(globalThis);
