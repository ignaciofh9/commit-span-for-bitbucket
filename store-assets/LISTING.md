# Chrome Web Store listing: Commit Span for Bitbucket

Everything to paste into the Developer Dashboard, tab by tab: https://chrome.google.com/webstore/devconsole

## Package

Upload `dist/commit-span-for-bitbucket-<version>.zip`, made by running `./build.sh`.

## Store listing

**Name** (from the manifest): Commit Span for Bitbucket

**Summary** (from the manifest):

> Review a span of commits in a Bitbucket Data Center pull request, in its own Diff tab, without what merges brought in.

**Category:** Developer Tools

**Language:** English

**Description:**

```
Commit Span for Bitbucket lets you review any run of commits in a pull request as one diff, instead of going commit by commit.

Tick the commits you want in Bitbucket's own Diff menu or on the Commits tab. The Diff tab then shows only what those commits changed, in Bitbucket's own viewer, so you can read and comment as usual. It's handy for seeing what's new since you last looked.

Code that came in by merging the target branch stays out of the way, because the Diff tab already leaves it out. If a later commit rewrote a line, you see the line as it will merge, and it tells you how many of the span's lines are no longer in the pull request. Files and comments outside the span are hidden until you choose to show all changes.

There's also a read-only view that shows the commits as they were at the time.

It works with self-hosted Bitbucket Data Center. It doesn't work with Bitbucket Cloud.

Try it without a server, on a demo page with made-up data: https://ignaciofh9.github.io/commit-span-for-bitbucket/projects/DEMO/repos/invoice-service/pull-requests/1/diff/

No account, and no tracking. It only talks to the Bitbucket server you're already signed in to, and it never changes anything there itself.

Changes are matched by their text, so a change right next to one outside the span may also appear.

Not affiliated with or endorsed by Atlassian. Bitbucket is a trademark of Atlassian.

Source code: https://github.com/ignaciofh9/commit-span-for-bitbucket
```

## Privacy practices

**Single purpose:**

> Lets a reviewer narrow a Bitbucket pull request's Diff tab to a chosen span of commits.

**Host permission justification** (`*://*/*/repos/*/pull-requests/*`):

> Self-hosted Bitbucket Data Center servers can have any address, so the host can't be listed in advance. The pattern limits the extension to pages whose address looks like a Bitbucket pull request. There it adds its controls, reads the pull request's commits and diffs from that same server using the user's session, and narrows the file list and diffs Bitbucket's Diff tab receives. It sends only GET requests, and only to the same server.

**Are you using remote code?** No, I am not using remote code. All code is in the package.

**Data usage:**

Tick **Website content**. The extension reads commits and code changes from the page's own server, and keeps the span's changed lines in session storage for that tab. None of it leaves the browser. Google's user data FAQ counts handling website content as user data, even when it stays on the device. Leave the rest unticked.

Tick all three certifications:

- I do not sell or transfer user data to third parties, outside of the approved use cases.
- I do not use or transfer user data for purposes that are unrelated to my item's single purpose.
- I do not use or transfer user data to determine creditworthiness or for lending purposes.

**Privacy policy URL:** https://ignaciofh9.github.io/commit-span-for-bitbucket/privacy-policy.html

**Website:** https://github.com/ignaciofh9/commit-span-for-bitbucket

## Test instructions

Paste this. No server or account is needed.

```
Bitbucket Data Center is self-hosted, so there's a demo page for testing. It's a stand-in for a Bitbucket pull request with made-up data, and the extension runs on it unchanged. No sign-in is needed.

1. Install the extension.
2. Open https://ignaciofh9.github.io/commit-span-for-bitbucket/projects/DEMO/repos/invoice-service/pull-requests/1/diff/
3. Open the menu above the file list, labelled "All changes in this pull request".
4. Tick "Handle an empty invoice list in the export" and "Add a totals row to the export". The commits between them are ticked too.
5. Click "Review in Diff tab" in the bar that appears.

Expected: the file list goes from 4 files to 1, and the menu reads "3 of 6 commits". Only the changes from those commits remain, and the merge's files don't appear. Click "Show all changes" to get all 4 files back.

The Commits tab has the same checkboxes in its table. On real servers, the extension runs on addresses of the same shape, which is why the demo page uses one.
```

## Images

| What | Size | File |
|---|---|---|
| Store icon | 128×128 | `icons/icon-128.png` (96×96 artwork with padding, as the store asks) |
| Screenshots | 1280×800 | `store-assets/screenshot-*.png`, in order |

The small promo tile and marquee are optional, so there aren't any.

The screenshots are real captures of the extension running on Bitbucket Data Center 9.4, on a local test server with a made-up repo and pull request. Upload them in this order:

1. `screenshot-1.png`: ticking commits in Bitbucket's Diff menu.
2. `screenshot-2.png`: the Diff tab narrowed to those commits, with a comment on a line.
3. `screenshot-3.png`: ticking commits on the Commits tab.

## Before you submit

1. Check the privacy policy is live at the URL above (GitHub Pages, serving `docs/` from `main`).
2. Check the demo page works with the extension installed, at the link in the test instructions.
3. Run `./build.sh` and upload the zip from `dist/`.
4. Choose visibility: Public, or Unlisted (only people with the link).
