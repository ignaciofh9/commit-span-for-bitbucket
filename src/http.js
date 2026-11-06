// Shared by the providers. Requests are same-origin, so they carry the signed-in session.
(function (root) {
  async function getJson(url, fetchFn) {
    const res = await fetchFn(url).catch(() => null);
    const data = res && res.ok ? await res.json().catch(() => null) : null;
    if (!data) {
      const code = res ? ` (HTTP ${res.status})` : '';
      throw new Error(`Could not read this PR from Bitbucket${code}. Check you are signed in and can see this repo.`);
    }
    return data;
  }

  root.PrDiff = root.PrDiff || { providers: [] };
  root.PrDiff.getJson = getJson;
})(globalThis);
