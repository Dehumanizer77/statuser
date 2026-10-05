// Tests for Main.tick() with fake Apps Script services. Run with: node --test
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SRC = path.join(__dirname, '..', 'src');
const FILES = ['Config.js', 'Logic.js', 'Settings.js', 'SettingsPage.js', 'Calendar.js', 'Slack.js', 'Main.js'];

const DAY = 1790035200; // some midnight, the exact date doesn't matter
const at = (h, m = 0) => DAY + h * 3600 + m * 60;
const iso = (t) => new Date(t * 1000).toISOString();

const EMPTY = { text: '', emoji: '', expiration: 0 };
const SECRET = { text: 'Doctor appointment SECRET-MARKER', emoji: ':hospital:', expiration: 0 };
const LUNCH = { text: 'Lunch', emoji: ':pizza:', expiration: 0 };

/** The functions that stay public on purpose: run from the editor, by the trigger or by the settings page. */
const ENTRY_POINTS = [
  'tick', 'showState', 'diagnose', 'resetState', 'doGet', 'getSettingsForPage', 'saveSettingsFromPage',
];

/** An event as the Calendar API returns it. */
const gEvent = (id, start, end, extra = {}) => ({
  id, eventType: 'default', start: { dateTime: iso(start) }, end: { dateTime: iso(end) }, ...extra,
});

/** Loads the app into a fresh context with fake Slack, Calendar and properties. */
function loadApp(status = SECRET) {
  const logs = [];
  const slack = { status, writes: 0, lastWrite: null, rejectNextWrite: false, loseNextResponse: false };
  const calendar = { pages: [{ items: [] }], requests: [] };
  const props = {
    data: { SLACK_USER_TOKEN: 'xoxp-test' },
    setCalls: 0,
    failAt: null, // number of the setProperty call that throws
    getProperty(key) { return key in this.data ? this.data[key] : null; },
    setProperty(key, value) {
      this.setCalls += 1;
      if (this.setCalls === this.failAt) throw new Error('Properties unavailable');
      this.data[key] = String(value);
    },
    deleteProperty(key) { delete this.data[key]; },
  };

  const response = (body) => ({ getResponseCode: () => 200, getContentText: () => JSON.stringify(body) });
  const profile = (s) => ({ status_text: s.text, status_emoji: s.emoji, status_expiration: s.expiration });

  const ctx = vm.createContext({
    console: { log: (...args) => logs.push(args.join(' ')) },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
    HtmlService: {
      createHtmlOutput: (html) => ({
        html,
        meta: {},
        setTitle(title) { this.title = title; return this; },
        addMetaTag(name, content) { this.meta[name] = content; return this; },
      }),
    },
    PropertiesService: { getScriptProperties: () => props },
    Utilities: { parseDate: (date) => new Date(`${date}T00:00:00Z`) },
    Calendar: {
      Events: {
        list(calendarId, options) {
          calendar.requests.push(options);
          const index = options.pageToken ? Number(options.pageToken) : 0;
          const page = calendar.pages[index];
          if (page.fail) throw new Error('Calendar unavailable');
          const next = index + 1 < calendar.pages.length ? String(index + 1) : undefined;
          return { timeZone: 'UTC', items: page.items, nextPageToken: next };
        },
      },
    },
    UrlFetchApp: {
      fetch(url, options) {
        assert.equal(options.followRedirects, false);
        assert.equal(options.headers.Authorization, 'Bearer xoxp-test');
        const method = url.replace('https://slack.com/api/', '');
        if (method === 'users.profile.get') return response({ ok: true, profile: profile(slack.status) });
        assert.equal(method, 'users.profile.set');
        if (slack.rejectNextWrite) {
          slack.rejectNextWrite = false;
          return response({ ok: false, error: 'ratelimited' });
        }
        slack.lastWrite = JSON.parse(options.payload);
        const p = slack.lastWrite.profile;
        slack.status = { text: p.status_text, emoji: p.status_emoji, expiration: p.status_expiration };
        slack.writes += 1;
        if (slack.loseNextResponse) {
          slack.loseNextResponse = false;
          throw new Error('Timeout');
        }
        return response({ ok: true, profile: profile(slack.status) });
      },
    },
  });
  for (const file of FILES) {
    vm.runInContext(fs.readFileSync(path.join(SRC, file), 'utf8'), ctx, { filename: file });
  }

  return {
    logs, slack, calendar, props,
    state: () => JSON.parse(props.data.STATE),
    run(fn, now) {
      if (now !== undefined) vm.runInContext(`Date.now = () => ${now * 1000}`, ctx);
      vm.runInContext(`${fn}()`, ctx);
    },
    /** Calls a function the way the settings page does; returns a plain copy of the result. */
    call(fn, ...args) {
      return JSON.parse(JSON.stringify(ctx[fn](...JSON.parse(JSON.stringify(args)))));
    },
    /** Makes the n-th setProperty call of the next run throw. */
    failSetProperty(n) {
      props.setCalls = 0;
      props.failAt = n;
    },
    /** The app's top-level functions: their source by name. */
    functions() {
      const sources = {};
      for (const name of Object.keys(ctx)) {
        if (typeof ctx[name] === 'function') sources[name] = String(ctx[name]);
      }
      return sources;
    },
  };
}

test('logs contain no status texts, emoji or event IDs', () => {
  const app = loadApp();
  app.calendar.pages = [{ items: [gEvent('evt-SECRET-ID', at(10), at(11))] }];
  app.run('tick', at(9, 59));
  app.run('diagnose', at(10));
  app.run('tick', at(10));
  app.run('tick', at(11));
  app.run('showState');

  assert.deepEqual(app.slack.status, SECRET);
  const output = app.logs.join('\n');
  for (const secret of ['SECRET-MARKER', ':hospital:', 'evt-SECRET-ID']) {
    assert.ok(!output.includes(secret), `logs contain ${secret}`);
  }
  assert.match(output, /No change/);
  assert.match(output, /Applied meeting status/);
  assert.match(output, /Restored own status/);
  assert.match(output, /"baselineSet":true/);
});

test('diagnose explains why an event does or does not count', () => {
  const app = loadApp();
  app.calendar.pages = [{
    items: [
      gEvent('a', at(10), at(11)),
      gEvent('b', at(10), at(11), { attendees: [{ self: true, responseStatus: 'needsAction' }] }),
    ],
  }];
  app.run('diagnose', at(10));
  const output = app.logs.join('\n');
  assert.match(output, /Events in your primary calendar right now: 2/);
  assert.match(output, /my response: none \(own event\): counts as meeting/);
  assert.match(output, /my response: needsAction: ignored/);
  assert.match(output, /The next run will change the status/);
  assert.equal(app.slack.writes, 0);
  assert.equal(app.props.data.STATE, undefined);

  const empty = loadApp();
  empty.run('diagnose', at(10));
  assert.match(empty.logs.join('\n'), /Events in your primary calendar right now: 0\nIs the event running/);
});

test('diagnose reports an event the next run is going to skip', () => {
  const app = loadApp();
  app.calendar.pages = [{ items: [gEvent('a', at(10), at(11))] }];
  app.run('tick', at(10));
  app.slack.status = LUNCH; // changed by hand, no run has seen it yet
  app.run('diagnose', at(10, 1));
  const output = app.logs.join('\n');
  assert.match(output, /counts as meeting, skipped after a manual change/);
  assert.match(output, /The next run will change nothing/);
});

test('a Slack write whose state commit fails is recognized on the next run', () => {
  const app = loadApp();
  app.calendar.pages = [{ items: [gEvent('a', at(10), at(11))] }];
  app.run('tick', at(9, 59));
  app.failSetProperty(2); // the commit after the Slack write
  assert.throws(() => app.run('tick', at(10)), /Properties unavailable/);
  assert.equal(app.slack.status.text, 'In a meeting');

  app.failSetProperty(null);
  app.run('tick', at(10, 1));
  assert.equal(app.slack.writes, 1);
  assert.deepEqual(app.state().baseline, SECRET);
  app.run('tick', at(11));
  assert.deepEqual(app.slack.status, SECRET);
});

test('a Slack write whose response is lost is recognized on the next run', () => {
  const app = loadApp();
  app.calendar.pages = [{ items: [gEvent('a', at(10), at(11))] }];
  app.run('tick', at(9, 59));
  app.slack.loseNextResponse = true;
  assert.throws(() => app.run('tick', at(10)), /Timeout/);

  app.run('tick', at(10, 1));
  assert.equal(app.slack.writes, 1);
  assert.deepEqual(app.state().baseline, SECRET);
  app.run('tick', at(11));
  assert.deepEqual(app.slack.status, SECRET);
});

test('an unconfirmed Slack write that expired before the next run keeps the own status', () => {
  const app = loadApp();
  app.calendar.pages = [{ items: [gEvent('a', at(10), at(11))] }];
  app.run('tick', at(9, 59));
  app.failSetProperty(2); // the commit after the Slack write
  assert.throws(() => app.run('tick', at(10)), /Properties unavailable/);
  app.failSetProperty(null);

  app.slack.status = EMPTY; // Slack cleared it at 11:05, no run until noon
  app.calendar.pages = [{ items: [] }];
  app.run('tick', at(12));
  assert.deepEqual(app.slack.status, SECRET);
  assert.deepEqual(app.state().baseline, SECRET);
});

test('a failure before the Slack write changes nothing and is retried', () => {
  const app = loadApp();
  app.calendar.pages = [{ items: [gEvent('a', at(10), at(11))] }];
  app.run('tick', at(9, 59));
  app.failSetProperty(1);
  assert.throws(() => app.run('tick', at(10)), /Properties unavailable/);
  assert.equal(app.slack.writes, 0);

  app.failSetProperty(null);
  app.run('tick', at(10, 1));
  assert.equal(app.slack.status.text, 'In a meeting');
  app.run('tick', at(11));
  assert.deepEqual(app.slack.status, SECRET);
});

test('a write rejected by Slack is retried', () => {
  const app = loadApp();
  app.calendar.pages = [{ items: [gEvent('a', at(10), at(11))] }];
  app.run('tick', at(9, 59));
  app.slack.rejectNextWrite = true;
  assert.throws(() => app.run('tick', at(10)), /ratelimited/);
  assert.deepEqual(app.slack.status, SECRET);

  app.run('tick', at(10, 1));
  assert.equal(app.slack.status.text, 'In a meeting');
  app.run('tick', at(11));
  assert.deepEqual(app.slack.status, SECRET);
});

test('a manual change during recovery wins', () => {
  const app = loadApp();
  app.calendar.pages = [{ items: [gEvent('a', at(10), at(11))] }];
  app.run('tick', at(9, 59));
  app.failSetProperty(2);
  assert.throws(() => app.run('tick', at(10)), /Properties unavailable/);
  app.failSetProperty(null);

  app.slack.status = LUNCH;
  app.run('tick', at(10, 5));
  app.run('tick', at(11));
  assert.deepEqual(app.slack.status, LUNCH);
  assert.equal(app.slack.writes, 1);
});

test('a status write sends nothing but the three status fields', () => {
  const app = loadApp();
  app.call('setSlackStatus_', { ...LUNCH, real_name: 'Somebody Else', fields: { title: 'Boss' } });
  assert.deepEqual(app.slack.lastWrite, {
    profile: { status_text: 'Lunch', status_emoji: ':pizza:', status_expiration: 0 },
  });
});

test('the settings page can reach Slack, the calendar and the properties only through the entry points', () => {
  const functions = loadApp().functions();
  for (const name of ENTRY_POINTS) assert.ok(name in functions, `${name} is missing`);

  // Only names without a trailing underscore can be called by google.script.run.
  const callable = Object.keys(functions).filter((name) => !name.endsWith('_') && !ENTRY_POINTS.includes(name));
  assert.ok(callable.includes('decide'));
  for (const name of callable) {
    assert.doesNotMatch(functions[name], /\b(PropertiesService|UrlFetchApp|LockService|HtmlService|Calendar)\b|\w_\(/,
      `${name} reaches a service, it should end with an underscore`);
  }
});

test('events on later calendar pages are used', () => {
  const app = loadApp();
  app.calendar.pages = [{ items: [] }, { items: [gEvent('a', at(10), at(11))] }];
  app.run('tick', at(10));

  assert.equal(app.slack.status.text, 'In a meeting');
  const [first, second] = app.calendar.requests;
  assert.equal(app.calendar.requests.length, 2);
  assert.match(first.fields, /nextPageToken/);
  assert.ok(!('pageToken' in first));
  assert.equal(second.pageToken, '1');
});

test('a higher priority event on a later page wins', () => {
  const app = loadApp();
  app.calendar.pages = [
    { items: [gEvent('m', at(10), at(11))] },
    { items: [gEvent('ooo', at(8), at(18), { eventType: 'outOfOffice' })] },
  ];
  app.run('tick', at(10));
  assert.equal(app.slack.status.text, 'Out of office');
});

test('a failing calendar page leaves the status alone', () => {
  const app = loadApp();
  app.calendar.pages = [{ items: [gEvent('a', at(10), at(11))] }, { fail: true }];
  assert.throws(() => app.run('tick', at(10)), /Calendar unavailable/);
  assert.equal(app.slack.writes, 0);
  assert.deepEqual(app.slack.status, SECRET);
});

test('settings saved on the page are used by the next run', () => {
  const app = loadApp();
  app.calendar.pages = [{ items: [gEvent('a', at(10), at(11))] }];
  const { settings } = app.call('getSettingsForPage');
  settings.statuses.meeting = { enabled: true, emoji: 'date', text: 'On a call' };
  const result = app.call('saveSettingsFromPage', { ...settings, protectedEmoji: ':lock:', safetyMarginMinutes: '10' });
  assert.deepEqual(result.errors, {});
  assert.equal(result.settings.statuses.meeting.emoji, ':date:');

  app.run('tick', at(10));
  assert.deepEqual(app.slack.status, { text: 'On a call', emoji: ':date:', expiration: at(11) + 600 });
});

test('invalid settings from the page are not saved', () => {
  const app = loadApp();
  const { settings } = app.call('getSettingsForPage');
  settings.statuses.meeting.emoji = '';
  const result = app.call('saveSettingsFromPage', settings);
  assert.equal(result.settings, null);
  assert.ok(result.errors['meeting.emoji']);
  assert.equal(app.props.data.SETTINGS, undefined);
});

test('a kind of event disabled in the settings is ignored', () => {
  const app = loadApp();
  app.calendar.pages = [{ items: [gEvent('a', at(10), at(11))] }];
  const { settings } = app.call('getSettingsForPage');
  settings.statuses.meeting.enabled = false;
  assert.deepEqual(app.call('saveSettingsFromPage', settings).errors, {});
  app.run('tick', at(10));
  assert.equal(app.slack.writes, 0);
});

test('the settings page is served with a script that parses', () => {
  const page = loadApp().call('doGet');
  assert.equal(page.title, 'Statuser settings');
  const script = page.html.match(/<script>([\s\S]*)<\/script>/)[1];
  assert.doesNotThrow(() => new vm.Script(script));
});
