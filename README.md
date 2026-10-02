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

   | Event | Status (default, see `src/Config.js`) |
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
- **Protected emoji** (`protectedEmoji` in `src/Config.js`): a status with one of
  them is never overwritten. Setting one during an event pauses it rather than
  skipping it: once the protected status is gone, the event status comes back.
- Our status is set to expire 5 minutes after the event ends, so it can't get stuck
  when the script stops running. Once it runs again, the baseline comes back.

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
3. In the editor, replace `appsscript.json` with [`src/appsscript.json`](src/appsscript.json),
   delete `Code.gs` and add script files `Config`, `Logic`, `Calendar`, `Slack`
   and `Main` with the contents of the matching files in `src/`.
4. **Project Settings** → **Script Properties** → add `SLACK_USER_TOKEN` with the
   token from step 1.

Alternatively push `src/` with [clasp](https://github.com/google/clasp)
(`clasp create --type standalone --rootDir src`, then `clasp push`). Check that
`src/appsscript.json` was not replaced by a default one before pushing. Note that
`clasp login` gives clasp itself broad access to your Google account.

### 3. Authorize and start

1. In the editor select the `tick` function and click **Run**. Google asks for
   two permissions: *See the events on Google calendars you own* and *Connect to an
   external service*.
2. Check the execution log for errors.
3. **Triggers** (alarm clock icon) → **Add Trigger**: function `tick`, event source
   *Time-driven*, type *Minutes timer*, *Every minute*.

## Usage

- **Pause** Statuser for a while, also in the middle of an event: set a status with
  a protected emoji (e.g. `:lock:`) and Slack's *Clear after…*. When it expires,
  a running event gets applied.
- **Skip** the current event: change your status by hand while it runs.
- Logs are under **Executions** in the Apps Script editor. They only say what
  happened (e.g. *Applied meeting status*, *Restored own status*), never status
  texts or event details.
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
- The token doesn't expire. If it may have leaked: open the Slack app settings →
  **OAuth & Permissions** → **Revoke All OAuth Tokens** → **Revoke Tokens**, then
  **Reinstall to Workspace** and put the new token into `SLACK_USER_TOKEN`.

## Development

The decision logic in `src/Logic.js` is pure and tested directly
(`test/logic.test.js`); `test/tick.test.js` runs the whole `tick()` against fake
Slack, Calendar and properties services, including failures halfway through a run.

```sh
node --test
```
