# Bundled tools

This Windows application bundles unmodified tools from their official upstream releases. Their licenses and notices are retained in `resources/tools/`.

* Electron 45.2.3 — MIT; Chromium and other bundled licenses accompany Electron.
* MinGit 2.56.0.4 (Git for Windows) — GPL-2.0 and component licenses; source: https://github.com/git-for-windows/git/tree/v2.56.0.windows.4 . Upstream release and corresponding source archives: https://github.com/git-for-windows/git/releases/tag/v2.56.0.windows.4 . Git is invoked as a separate executable, not linked into the application.
* GitHub CLI 2.103.3 — MIT; source and release: https://github.com/cli/cli/releases/tag/v2.103.3 .

Download URLs and pinned SHA-256 digests are in `scripts/fetch-tools.ps1`.
