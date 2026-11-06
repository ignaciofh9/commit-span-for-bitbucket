// Runs in the page's own context, because only there can responses be seen before
// Bitbucket's viewer draws them. While a span is active on the Diff tab, it narrows
// the file list and file diffs of the PR's whole diff. It never changes anything
// sent to Bitbucket, and any failure leaves the response as it was.
(function () {
  const { storageKey, filterChanges, filterDiffResponse } = globalThis.PrDiff;
  delete globalThis.PrDiff;

  // The Diff tab may load the PR's whole diff as a range, from commits/<tip>/diff/<path>?since=<base>.
  const API = /\/(?:pull-requests\/(\d+)|commits\/[0-9a-f]+)\/(?:(changes)|diff\/([^?#]+))(?:[?#]|$)/;
  const DIFF_TAB = /\/pull-requests\/(\d+)\/diff(?:\/|$)/;

  function activeSpan() {
    try {
      return JSON.parse(sessionStorage.getItem(storageKey(location.pathname)));
    } catch {
      return null;
    }
  }

  // Notes the shape of a diff request that wasn't filtered, for the banner's warning.
  // Project, repo, PR number, file path, hashes and parameter values are left out.
  function noteSkipped(url) {
    const kind = String(url).match(/\/rest\/[^?]*\b(diff|changes)\b/)?.[1];
    if (!kind) return;
    const { pathname, searchParams } = new URL(url, location.href);
    const endpoint = pathname
      .replace(/^.*?\/rest\//, '')
      .replace(/(projects|users)\/[^/]+\/repos\/[^/]+/, '*')
      .replace(/pull-requests\/\d+/, 'pr')
      .replace(/\b[0-9a-f]{7,40}\b/g, 'hash')
      .replace(/(\/diff)\/.*/, '$1');
    const params = [...searchParams.keys()].map((key) => (key === 'diffType' ? `diffType=${searchParams.get(key)}` : key));
    document.documentElement.setAttribute(`data-bpd-skipped-${kind}`, `${endpoint}?${params.join('&')}`);
  }

  // Returns what to do for a request, or null to leave it alone. On the Diff tab, a
  // request can carry since and until hashes and still be for the whole PR, so only
  // an explicit commit or range is left alone.
  function inspect(url) {
    const tab = location.pathname.match(DIFF_TAB);
    if (!tab) return null;
    const match = String(url).match(API);
    const query = new URL(url, location.href).searchParams;
    // A commits/<hash> request without "since" is one commit, not the whole PR.
    const samePr = match && (match[1] ? match[1] === tab[1] : query.has('since'));
    if (!samePr) {
      noteSkipped(url);
      return null;
    }
    if (match[2]) {
      if (!['ALL', 'UNREVIEWED'].includes(query.get('changeScope') || 'ALL')) {
        noteSkipped(url);
        return null;
      }
    } else if (['COMMIT', 'RANGE'].includes(query.get('diffType'))) {
      noteSkipped(url);
      return null;
    }
    const plan = activeSpan();
    return plan && { plan, isChanges: Boolean(match[2]), path: match[3] && decodeURIComponent(match[3]) };
  }

  // A problem here must never get in the way of Bitbucket's own request.
  function requestFor(url) {
    try {
      return inspect(url);
    } catch {
      return null;
    }
  }

  function rewrite(request, text) {
    try {
      const data = JSON.parse(text);
      const out = request.isChanges ? filterChanges(data, request.plan) : filterDiffResponse(data, request.plan.files[request.path]);
      document.documentElement.setAttribute(request.isChanges ? 'data-bpd-changes' : 'data-bpd-diff', 'filtered');
      return JSON.stringify(out);
    } catch (error) {
      document.documentElement.setAttribute('data-bpd-error', error.name);
      return text;
    }
  }

  const requests = new WeakMap();
  const results = new WeakMap();
  const realOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url) {
    results.delete(this);
    const request = String(method).toUpperCase() === 'GET' ? requestFor(url) : null;
    if (request) requests.set(this, request);
    else requests.delete(this);
    return realOpen.apply(this, arguments);
  };

  function filteredText(xhr, text) {
    const request = requests.get(xhr);
    if (!request || xhr.readyState !== 4 || xhr.status !== 200 || typeof text !== 'string') return text;
    if (!results.has(xhr)) results.set(xhr, rewrite(request, text));
    return results.get(xhr);
  }

  const textGetter = Object.getOwnPropertyDescriptor(XMLHttpRequest.prototype, 'responseText');
  const responseGetter = Object.getOwnPropertyDescriptor(XMLHttpRequest.prototype, 'response');
  Object.defineProperty(XMLHttpRequest.prototype, 'responseText', {
    ...textGetter,
    get() {
      return filteredText(this, textGetter.get.call(this));
    },
  });
  Object.defineProperty(XMLHttpRequest.prototype, 'response', {
    ...responseGetter,
    get() {
      const value = responseGetter.get.call(this);
      if (this.responseType === 'json' && value && requests.has(this) && this.readyState === 4 && this.status === 200) {
        return JSON.parse(filteredText(this, JSON.stringify(value)));
      }
      return this.responseType === '' || this.responseType === 'text' ? filteredText(this, value) : value;
    },
  });

  const realFetch = window.fetch;
  window.fetch = function (input, init) {
    const promise = realFetch.apply(this, arguments);
    const url = typeof input === 'string' ? input : input?.url || String(input);
    const method = init?.method || input?.method || 'GET';
    const request = String(method).toUpperCase() === 'GET' ? requestFor(url) : null;
    if (!request) return promise;
    return promise.then(async (response) => {
      if (response.status !== 200) return response;
      const text = await response.clone().text();
      const out = rewrite(request, text);
      if (out === text) return response;
      const copy = new Response(out, { status: response.status, statusText: response.statusText, headers: response.headers });
      Object.defineProperty(copy, 'url', { value: response.url });
      return copy;
    });
  };
})();
