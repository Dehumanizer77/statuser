# Statuser

Sets your Slack status from your Google Calendar, like the official Google Calendar
app, but it **overrides a manually set status** during an event and **restores it**
when the event ends. Out-of-office events are supported.

Runs as a Google Apps Script under your own account: no server, no database.

## How it works

Every minute the script reads your Slack status and the events happening right now
on your primary calendar, and decides:

1. A status you set yourself is remembered as the *baseline*.
2. While an event runs, its status is set (highest priority wins):

   | Event | Default status (change it on the [settings page](#4-settings-page)) |
   |---|---|
   | Out of office | :palm_tree: Out of office |
   | Meeting | :calendar: In a meeting |
   | Focus time | :headphones: Focus time |
   | All-day event | :calendar: Busy |

3. When no event runs, the baseline is restored. If it had its own expiration
   that already passed, the status is cleared instead.

Rules:

- Skipped: declined invitations, unanswered invitations, timed events marked as
  *free*, working location and birthday events.
- Counted: tentative invitations, your own events without guests, all-day events
  (even when marked as free, which is Google's default for them).
- Status text is always generic, event titles are never shown or even downloaded.
- **A manual change during an event wins:** that event is no longer enforced and
  nothing is restored when it ends. The next event overrides the status again.
- **Protected emoji** (set on the settings page): a status with one of them is
  never overwritten. Setting one during an event pauses it rather than skipping
  it: once the protected status is gone, the event status comes back.
- Our status is set to expire a few minutes (5 by default) after the event ends,
  so it can't get stuck when the script stops running. Once it runs again, the
  baseline comes back.

## Setup

### 1. Slack app

1. Open <https://api.slack.com/apps> → **Create New App** → **From a manifest**,
   pick the workspace and paste [`slack-manifest.json`](slack-manifest.json).
2. **Install to Workspace** and allow it. Depending on workspace settings, a Slack
   admin may need to approve the app.
3. On **OAuth & Permissions**, copy the **User OAuth Token** (`xoxp-…`).

### 2. Apps Script project

1. Open <https://script.google.com> → **New project**, name it *Statuser*.
2. **Project Settings** → check *Show "appsscript.json" manifest file in editor*.
3. In the editor, replace the whole content of `appsscript.json` with
   [`src/appsscript.json`](src/appsscript.json) and the whole content of `Code.gs`
   with [`dist/Code.gs`](dist/Code.gs), all the code joined into one file
   (`./bundle.sh` regenerates it from `src/`). Make sure no other script files
   are left in the project, then save.
4. **Project Settings** → **Script Properties** → add `SLACK_USER_TOKEN` with the
   token from step 1.

Alternatively push `src/` with [clasp](https://github.com/google/clasp)
(`clasp create --type standalone --rootDir src`, then `clasp push`). Check that
`src/appsscript.json` was not replaced by a default one before pushing. Note that
`clasp login` gives clasp itself broad access to your Google account.

### 3. Authorize and start

1. Run one check by hand: `tick` is the function that does one run. Pick it in the
   function dropdown in the editor's toolbar (next to **Debug**) and click **Run**.
   Google asks for two permissions: *See the events on Google calendars you own*
   and *Connect to an external service*.
2. Check the execution log for errors.
3. **Triggers** (alarm clock icon) → **Add Trigger**: function `tick`, event source
   *Time-driven*, type *Minutes timer*, *Every minute*.

### 4. Settings page

The statuses, protected emoji and the safety margin are set on a small web page.
Settings are stored apart from the code, so pasting a new `Code.gs` keeps them.

1. In the editor: **Deploy** → **Test deployments**.
2. Next to *Select type* click the gear icon → **Web app**.
3. Copy the **URL** (it ends with `/dev`), open it and bookmark it.

Only people with edit access to the project can open the `/dev` URL, i.e. only
you. It always runs the latest saved code, so there's nothing to redeploy.

## Usage

- **Change statuses, emoji or protected emoji** on the settings page. Changes
  apply from the next run, within a minute.
- **Pause** Statuser for a while, also in the middle of an event: set a status with
  a protected emoji (e.g. `:lock:`) and Slack's *Clear after…*. When it expires,
  a running event gets applied.
- **Skip** the current event: change your status by hand while it runs.
- Logs are under **Executions** in the Apps Script editor. They only say what
  happened (e.g. *Applied meeting status*, *Restored own status*), never status
  texts or event details.
- Status not changing as expected? Run `diagnose`: it lists the events running
  right now, whether each counts and why, and what the next run will do.
- `showState` logs a summary of the saved state (again without texts or event
  details), `resetState` forgets it. Run the latter only while no event status is
  set, otherwise that status becomes the baseline.

## Permissions

| Where | Permission | Why |
|---|---|---|
| Slack | `users.profile:write` | set the status (Slack has no narrower scope, it covers your whole profile) |
| Slack | `users.profile:read` | read the current status to restore it later |
| Google | `calendar.events.owned.readonly` | read events on calendars you own |
| Google | `script.external_request` | call the Slack API, restricted to `https://slack.com/api/` by `urlFetchWhitelist` |

### Keeping it private

- The Slack token and the saved state (your own status text) live in the script
  properties, and the trigger runs as you. Anyone with edit access to the Apps
  Script project can read the token and change what runs under your account, so
  **don't share the project**. Everyone who wants Statuser makes their own copy
  with their own token.
- The settings page is only reachable through the test deployment (`/dev`), which
  needs edit access. The manifest also limits any regular web app deployment to
  you (`"access": "MYSELF"`), so don't create one with wider access.
- The token doesn't expire. If it may have leaked: open the Slack app settings →
  **OAuth & Permissions** → **Revoke All OAuth Tokens** → **Revoke Tokens**, then
  **Reinstall to Workspace** and put the new token into `SLACK_USER_TOKEN`.

## Development

The decision logic in `src/Logic.js` and the settings validation in
`src/Settings.js` are pure and tested directly (`test/logic.test.js`,
`test/settings.test.js`); `test/tick.test.js` runs the whole `tick()` and the
settings page's server functions against fake Slack, Calendar and properties
services, including failures halfway through a run.

After changing anything in `src/`, run `./bundle.sh` to regenerate `dist/Code.gs`.

```sh
node --test
```
