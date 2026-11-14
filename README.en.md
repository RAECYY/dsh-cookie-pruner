# dsh-cookie-pruner

> v0.2.0 · DSH desktop plugin for cleaning up and preventing the `dsh-auth-*` cookie pile-up behind HTTP 431.

[简体中文](./README.md)

## What it does

The DSH desktop app writes a fresh `dsh-auth-*` auth cookie on every launch. Because the local server port is random each time, every cookie name is different and old ones are never reused or removed. After roughly 70 launches the request header exceeds 16 KB, the host returns HTTP 431 (`Web authentication failed`), and the desktop app can no longer start.

This plugin does three things:

- **Measure** the current Chromium Cookies DB size, flag accumulation risk, and let the assistant report it in chat.
- **Explain** the state and the one-time cleanup steps under Settings → Account → Cookie 清理.
- **Prevent** future pile-up by capping new auth cookies at **3 days** so old ones expire on their own.

## How it works

Two halves, one offline script, and one profile setting:

- **Host half (`index.js`)** runs inside the DSH plugin sandbox. It reads the size of `%APPDATA%\@deepseek-ai\dsh-desktop\Network\Cookies` with `node:fs.statSync` (file metadata stays readable even while the DB is locked) and writes the result to `.runtime-diag.json`, which the assistant reports in chat.
- **Client half (`client.js`)** registers the "Cookie 清理" section under Settings → Account, describing the mechanism and the offline cleanup steps.
- **Offline script (`cleanup-once.ps1`)** runs after DSH is fully quit and the DB is unlocked. It renames the DB to `.bak-<timestamp>` as a backup; the next launch rebuilds a clean DB. It refuses to run if the DSH process is still alive, so it cannot corrupt files.
- **Config patch (`cordis.patch.yml`)** writes `connection.cookieMaxAgeDays: 3` into the profile.

> The plugin sandbox cannot delete cookies at runtime (the DB is held open by the desktop app and the sandbox exposes no cookie service). So clearing existing accumulation is done by the offline script, and preventing new accumulation is done by the 3-day expiry setting.

## How it prevents

- **No future pile-up**: `connection.cookieMaxAgeDays: 3` makes every new auth cookie expire after 3 days. Even with a fresh name on each launch, old cookies roll off and the request header never grows back to 16 KB.
- **Clear existing accumulation**: fully quit DSH, then run once as administrator (adjust the path to your install location):
  ```powershell
  & "D:\AI\dsh-cookie-pruner\cleanup-once.ps1"
  ```
  Reopen DSH afterward; the 431 is resolved.
