# Commit Span for Bitbucket

A Chrome extension for reviewing Bitbucket Data Center pull requests. Pick a span of commits and review just those in Bitbucket's own Diff tab, with its viewer and comments, without the code that came in through merges.

## Load it

1. Go to `chrome://extensions` and turn on **Developer mode**.
2. Click **Load unpacked** and choose this folder.
3. Open a PR on your Bitbucket. If the tab was already open, reload it.

## Use it

**Pick the commits**, whichever way is handy:

- On the Diff tab, open Bitbucket's own menu of commits and tick them there. Clicking the rest of a row still opens that one commit.
- On the Commits tab, tick them in the table.
- On any PR page, click the **Commit span** tab and tick them in its dropdown. This may go away if the Diff menu proves reliable.

They all stay in sync. Ticking builds one continuous span:

- Tick a commit outside the span, and the span extends to reach it. So tick the first and last commit, and everything between is included.
- Untick the newest or oldest commit, and the span gets shorter.
- Untick a commit in the middle, and the commits newer than it drop out.

**Review them.** A bar with your selection appears as soon as you tick something, or in the dropdown's footer while that's open.

- **Review in Diff tab** opens Bitbucket's Diff tab showing only those commits. Comment as usual.
- **Read-only view** opens the commits' diff over the page, without comments. It's a fallback for now.

**In the Diff tab**, a bar at the bottom says what you're looking at, and Bitbucket's Diff menu names the span instead of "All changes". **Change commits** picks a different span. **Show all changes**, or **All changes** in that menu, goes back to the whole PR. The span stays on for that PR in that browser tab until you do.

## Try it

With the extension installed, open the [demo page](https://ignaciofh9.github.io/commit-span-for-bitbucket/projects/DEMO/repos/invoice-service/pull-requests/1/diff/). It's a stand-in for a Bitbucket pull request with made-up data, so no server is needed.

## What the Diff tab shows

The Diff tab's normal content is the PR's whole diff, which already leaves out what came in from the target branch. A span narrows that:

- Files the span didn't touch are removed from the file list.
- In the files that remain, changes the span didn't make are hidden. Each change keeps its real line numbers.
- Merge conflict markers always stay visible in a file the span touched.

**It shows the code as it will merge.** If a span's commit changed a line and a later commit rewrote it, you see the final line, and the bar counts the span's lines that are no longer in the PR. If you need the code exactly as it was at that commit, use the read-only view.

**Comments on hidden lines are hidden too**, until you click **Show all changes**. The bar's tooltip says so.

**How changes are matched:** by their text, so it can be wrong in both directions. If a change is right next to one from outside the span, both stay. If an identical line was added both inside and outside the span, both can stay. Binary files and files that couldn't be checked aren't filtered at all.

If filtering doesn't apply, the bar turns yellow and includes **Saw:** and the shape of the request it skipped. It leaves out the project, repo, PR number, file path, hashes and parameter values, so it's safe to share.

## What the read-only view shows

The author's changes in those commits, as they were at the time:

- **A span from the PR's first commit** is compared against the target branch, from where the branch last met it.
- **A span starting later** is compared against the commit just before it, and what each merge in the span brought in is removed, but only where a merge made exactly that change.

Conflict resolutions and merges of the PR's own commits stay. Changes right next to merged lines also stay, and are flagged if at least half the block matches a merge. Files changed only by merges are listed in a collapsed **hidden** section.

## Permissions and what it touches

It never needs a password or token, and no server address has to be configured, so none is stored in this repo. It runs on any page whose URL looks like `/.../repos/.../pull-requests/...`, on any host. Chrome describes this as access to all sites, because the host isn't limited. The script doesn't load on other URLs.

If a site that isn't Bitbucket has PR-shaped URLs and tabs labelled the same way, the controls appear there too. On a page whose path ends in `/commits`, it requests that site's commit list straight away. Requests only go to that same site.

**It reads, and never writes.** The extension sends only GET requests, with your existing session. Comments are posted by Bitbucket's own page, and the extension doesn't touch them.

**One script runs inside the page itself** (`src/pageHook.js`), because that's the only place responses can be seen before Bitbucket's viewer draws them. It wraps the page's `XMLHttpRequest` and `fetch`, but only changes the response when all of these are true:

- A span is active for this PR in this browser tab.
- The page is the PR's Diff tab, not a single commit's page.
- The request is a GET for the file list or a file's diff, either `pull-requests/{id}/...` or `commits/{hash}/...?since=...`, and isn't marked as a single commit or range.

If it can't parse a response, the response goes through unchanged.

On the demo page, marked by a `commit-span-demo` tag, the extension gets its data through the page, because a service worker there plays the server and a content script's own requests don't reach it (`src/demo.js`, `docs/sw.js`). No other page uses this.

The span is kept in `sessionStorage`, including the text of the span's changed lines, and it's gone when the browser tab closes.

Data Center endpoints the extension calls itself, from [Atlassian's REST spec](https://dac-static.atlassian.com/server/bitbucket/10.0.swagger.v3.json), under `/rest/api/latest/projects/{key}/repos/{repo}/`: `pull-requests/{id}`, its `/commits`, `/changes` and `/diff/{path}`, plus `compare/changes` and `compare/diff/{path}`. It loads up to 6 files at a time and checks up to 200 files per span.

## How it stays out of the way

Only three things go inside Bitbucket's page: a copy of its Commits tab, a checkbox on each row of its Diff menu, and a checkbox at the start of each row of the Commits table. Selected rows are tinted by a see-through layer on top (`src/page.css`), so Bitbucket's fading of long text isn't disturbed. The Commits table's checkboxes get a narrow gap, added to the table's first column as soon as the table appears and before the browser paints it, so they don't shift anything when they arrive. If the table was already on screen when the extension started, it moves once. The dropdown, bar and read-only view float above the page from their own element.

It doesn't rely on Bitbucket's class names. It finds the tabs by their labels ("Diff" and "Commits") and the rows by their commit hashes, and puts back anything a re-render removed.

- The Diff menu's list is found from its "All changes" row, for a few seconds after each click on the page, and its rows by their commit hashes.
- If a row can't be matched, it gets no checkbox. The other ways of picking still work.
- If the tabs can't be found for 5 seconds, a **Commit span** button appears in the corner instead. Translated tab labels would also cause this.

Colours use Atlassian's theme values where the server provides them, so dark mode should follow along, and otherwise fall back to light.

## What has been tested

**On real Bitbucket Data Center 9.4**, in Chrome, on a local test server with a made-up repo:

- Ticking commits in the Diff menu and on the Commits tab, with a span across a real merge from the target branch.
- The Diff tab narrowed to that span: the file list and diffs were filtered, and the merge's files stayed out.
- A comment left during a span: Bitbucket stored it as a normal comment on the correct line, and it stayed there after **Show all changes**.
- Picking a single commit in Bitbucket's own Diff menu: it shows the whole commit, unfiltered, and the span is kept.
- The Diff menu's label, its **All changes** item no longer looking current during a span, and choosing it to clear the span.
- The read-only view, with the merge's files hidden and named.

It has also been used on another real Data Center server, whose version isn't recorded here.

The demo page was run in Chrome with the extension installed, served locally. Once it's published, check it at its real address.

Run with `npm test` (no dependencies):

- URL matching, paging, span and tick logic, row matching, merge filtering and the Diff tab filter. The page hook runs against stand-ins for `XMLHttpRequest` and `fetch`, including the requests it must leave alone.

**Not tested:**

- Other Bitbucket versions, or large pull requests.
- The side-by-side diff view.
- The corner fallback.
- Spans from the first commit on pull requests that are already merged.
- Dark mode.

## Known limits

- Bitbucket Cloud isn't supported. `src/cloud.js` is an unfinished start at it, which has never run in a browser and isn't in the package.
- PRs from forks are untested.
- A span is prepared once. If the PR gets new commits, pick the span again.

## Publishing

Run `./build.sh` to make the package in `dist/`. `store-assets/LISTING.md` has everything for the Chrome Web Store's dashboard. `node store-assets/render-icons.mjs` redraws the icons, with no browser needed. `python3 store-assets/make-demo-data.py` regenerates the demo's data. The screenshots are captures from a local test server.

## Adding another Bitbucket

A provider has `matchPr`, `loadPr` and `compareUrl`. Add `listChanges` and `fileDiff` for the read-only view, then `prChanges`, `prFileDiff` and `diffTabUrl` for the Diff tab. See `src/datacenter.js`. Commits must be newest first, with `parents` as a list of hashes. Add the new file to `js` in `manifest.json`, after `src/http.js` and before `src/options.js`.
