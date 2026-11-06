// Bitbucket Cloud provider. A provider has three functions: matchPr, loadPr and
// compareUrl. To add Data Center, write another provider and add it to providers.
(function (root) {
  const { getJson } = root.PrDiff;

  // Same-origin path the Bitbucket site uses, so requests carry the signed-in
  // session. api.bitbucket.org sends "Access-Control-Allow-Origin: *", which
  // browsers don't allow on requests with cookies.
  const API = '/!api/2.0/repositories';
  const COMMIT_FIELDS =
    'next,values.hash,values.date,values.message,values.parents.hash,values.author.raw,values.author.user.display_name';

  function matchPr(href) {
    const url = new URL(href);
    if (url.hostname !== 'bitbucket.org') return null;
    const m = url.pathname.match(/^\/([^/]+)\/([^/]+)\/pull-requests\/(\d+)(?:\/|$)/);
    if (!m) return null;
    const [, workspace, repo, id] = m;
    return { workspace, repo, id, key: `cloud/${workspace}/${repo}/${id}` };
  }

  // Commits come back newest first. baseHash is the PR's target commit, so
  // comparing against it shows everything the PR changes up to the chosen commit.
  async function loadPr(pr, fetchFn = fetch) {
    const base = `${API}/${pr.workspace}/${pr.repo}/pullrequests/${pr.id}`;
    const details = await getJson(`${base}?fields=destination.commit.hash`, fetchFn);
    const commits = [];
    let next = `${base}/commits?pagelen=50&fields=${encodeURIComponent(COMMIT_FIELDS)}`;
    while (next) {
      const page = await getJson(next, fetchFn);
      commits.push(...(page.values || []).map((commit) => ({ ...commit, parents: (commit.parents || []).map((parent) => parent.hash) })));
      next = page.next;
    }
    return { commits, baseHash: details.destination?.commit?.hash || null };
  }

  // Bitbucket's order is newer..older, the opposite of git diff.
  function compareUrl(pr, fromHash, toHash) {
    return `/${pr.workspace}/${pr.repo}/branches/compare/${toHash}..${fromHash}#diff`;
  }

  const provider = { matchPr, loadPr, compareUrl };
  root.PrDiff.providers.push(provider);
  if (typeof module !== 'undefined') module.exports = provider;
})(globalThis);
