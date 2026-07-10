# Smart Flow Sheet Helper

A Manifest V3 Chrome extension with read-only helpers for Smart Flow pages.

## Install a release

1. Download `smartflow-helper-extension-v*.zip` from the repository's Releases page.
2. Extract the zip to a permanent folder. Chrome cannot load the zip directly.
3. Open `chrome://extensions` in Chrome.
4. Enable **Developer mode**.
5. Select **Load unpacked** and choose the extracted folder containing `manifest.json`.

To update the extension later, replace the extracted files with a newer release and select the extension's refresh button on `chrome://extensions`.

## Develop locally

Load the [`chrome_extension`](chrome_extension) directory as an unpacked extension. The extension-specific API and behavior are documented in [`chrome_extension/README.md`](chrome_extension/README.md).

Run the checks with Node:

```powershell
node .\chrome_extension\tests\controlled-medications-check.js
node .\chrome_extension\tests\layout-check.js
```

Build the same runtime-only zip produced by CI:

```powershell
pwsh .\scripts\package-extension.ps1
```

The archive is written to `dist/` with the version from `chrome_extension/manifest.json`.

## Releases

GitHub Actions runs both checks and builds a downloadable zip artifact for every push and pull request. A tag matching the manifest version, such as `v0.1.0`, also creates or updates a GitHub Release with the extension zip attached.
