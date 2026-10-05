// Tests for src/Logic.js. Run with: node --test
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Apps Script files are plain scripts sharing one global scope, load them the same way.
for (const file of ['Config.js', 'Logic.js', 'Settings.js']) {
  vm.runInThisContext(fs.readFileSync(path.join(__dirname, '..', 'src', file), 'utf8'), { filename: file });
}
const { decide, commitWrite, toConfig, DEFAULT_SETTINGS } =
  vm.runInThisContext('({ decide, commitWrite, toConfig, DEFAULT_SETTINGS })');
const CONFIG = toConfig(DEFAULT_SETTINGS);

const DAY = 1790035200; // some midnight, the exact date doesn't matter
const at = (h, m = 0) => DAY + h * 3600 + m * 60;
const MARGIN = CONFIG.safetyMarginMinutes * 60;

const EMPTY = { text: '', emoji: '', expiration: 0 };
const MANUAL = { text: 'Working from home', emoji: ':house_with_garden:', expiration: 0 };
const LUNCH = { text: 'Lunch', emoji: ':pizza:', expiration: 0 };
const meeting = (end) => ({ ...CONFIG.statuses.meeting, expiration: end + MARGIN });
const ooo = (end) => ({ ...CONFIG.statuses.outOfOffice, expiration: end + MARGIN });
const busy = (end) => ({ ...CONFIG.statuses.allDay, expiration: end + MARGIN });

const event = (id, start, end, extra = {}) => ({
  id, eventType: 'default', allDay: false, transparent: false, myResponse: 'accepted', start, end, ...extra,
});

const PAUSE = { text: 'Paused', emoji: ':lock:', expiration: 0 };

/** Runs decide() the way Main.tick does, against a fake Slack. */
function simulate(initial = MANUAL, config = CONFIG) {
  let state = null;
  const slack = { status: initial };
  return {
    slack,
    get state() { return state; },
    /**
     * outcome of a write: 'ok', 'unconfirmed' (Slack took it but the run died
     * before committing) or 'failed' (Slack rejected it).
     */
    tick(now, events = [], outcome = 'ok') {
      const res = decide(state, slack.status, events, now, config);
      state = res.state;
      if (res.write && outcome !== 'failed') slack.status = res.write;
      if (res.write && outcome === 'ok') state = commitWrite(state, res.write);
      return res.write;
    },
  };
}

test('first run without events keeps the manual status', () => {
  const sim = simulate();
  assert.equal(sim.tick(at(9)), null);
  assert.deepEqual(sim.state.baseline, MANUAL);
});

test('a meeting overrides the manual status and restores it afterwards', () => {
  const sim = simulate();
  const events = [event('a', at(10), at(11))];
  assert.equal(sim.tick(at(9, 59), events), null);
  assert.deepEqual(sim.tick(at(10), events), meeting(at(11)));
  assert.equal(sim.tick(at(10, 30), events), null);
  assert.deepEqual(sim.tick(at(11), events), MANUAL);
});

test('back-to-back meetings keep the status and only extend its expiration', () => {
  const sim = simulate();
  const events = [event('a', at(10), at(11)), event('b', at(11), at(12))];
  assert.deepEqual(sim.tick(at(10), events), meeting(at(11)));
  assert.deepEqual(sim.tick(at(11), events), meeting(at(12)));
  assert.deepEqual(sim.tick(at(12), events), MANUAL);
});

test('out of office wins over a meeting', () => {
  const sim = simulate();
  const events = [
    event('ooo', at(8), at(18), { eventType: 'outOfOffice' }),
    event('m', at(10), at(11)),
  ];
  assert.deepEqual(sim.tick(at(10), events), ooo(at(18)));
  assert.equal(sim.tick(at(11), events), null);
  assert.deepEqual(sim.tick(at(18), events), MANUAL);
});

test('a manual change during an event wins until the event ends', () => {
  const sim = simulate();
  const events = [event('a', at(10), at(11)), event('b', at(12), at(13))];
  assert.deepEqual(sim.tick(at(10), events), meeting(at(11)));
  sim.slack.status = LUNCH;
  assert.equal(sim.tick(at(10, 1), events), null);
  assert.equal(sim.tick(at(10, 30), events), null);
  assert.equal(sim.tick(at(11), events), null);
  assert.deepEqual(sim.state.baseline, LUNCH);
  // the next event overrides again and restores the new manual status
  assert.deepEqual(sim.tick(at(12), events), meeting(at(13)));
  assert.deepEqual(sim.tick(at(13), events), LUNCH);
});

test('a manual change just before an event starts does not suppress it', () => {
  const sim = simulate();
  const events = [event('a', at(10), at(11))];
  sim.tick(at(9, 59), events);
  sim.slack.status = LUNCH; // set at 9:59:30, seen at the 10:00 run
  assert.deepEqual(sim.tick(at(10), events), meeting(at(11)));
  assert.deepEqual(sim.tick(at(11), events), LUNCH);
});

test('an event added after the previous check is not skipped by a manual change', () => {
  const sim = simulate();
  sim.tick(at(10, 5)); // no events yet
  sim.slack.status = EMPTY; // status cleared by hand
  // a 10:00 event created after the 10:05 check
  assert.deepEqual(sim.tick(at(10, 10), [event('a', at(10), at(11))]), meeting(at(11)));
  assert.deepEqual(sim.tick(at(11)), EMPTY);
});

test('a status cleared by hand during an event is respected', () => {
  const sim = simulate();
  const events = [event('a', at(10), at(11))];
  sim.tick(at(10), events);
  sim.slack.status = EMPTY;
  assert.equal(sim.tick(at(10, 15), events), null);
  assert.equal(sim.tick(at(11), events), null);
  assert.deepEqual(sim.slack.status, EMPTY);
});

test('a skipped event that gets extended stays skipped', () => {
  const sim = simulate();
  sim.tick(at(10), [event('a', at(10), at(11))]);
  sim.slack.status = LUNCH;
  sim.tick(at(10, 1), [event('a', at(10), at(11))]);
  const extended = [event('a', at(10), at(12))];
  assert.equal(sim.tick(at(10, 30), extended), null);
  assert.equal(sim.tick(at(11), extended), null);
  assert.equal(sim.tick(at(11, 30), extended), null);
  assert.equal(sim.tick(at(12)), null);
  assert.deepEqual(sim.slack.status, LUNCH);
});

test('a skipped event extended at the last moment stays skipped', () => {
  const sim = simulate();
  const events = [event('a', at(10), at(11))];
  sim.tick(at(10), events);
  sim.slack.status = LUNCH;
  sim.tick(at(10, 1), events);
  sim.tick(at(10, 59), events);
  // extended after the 10:59 run, first seen when it would have ended
  const extended = [event('a', at(10), at(12))];
  assert.equal(sim.tick(at(11), extended), null);
  assert.equal(sim.tick(at(11, 59), extended), null);
  assert.deepEqual(sim.slack.status, LUNCH);
});

test('a new event overrides the manual status while an extended skipped one still runs', () => {
  const sim = simulate();
  sim.tick(at(10), [event('a', at(10), at(11))]);
  sim.slack.status = LUNCH;
  sim.tick(at(10, 1), [event('a', at(10), at(11))]);
  const events = [event('a', at(10), at(12)), event('b', at(11), at(11, 30))];
  assert.equal(sim.tick(at(10, 30), events), null);
  assert.deepEqual(sim.tick(at(11), events), meeting(at(11, 30)));
  assert.deepEqual(sim.tick(at(11, 30), events), LUNCH);
  assert.equal(sim.tick(at(12), events), null);
});

test('a skipped event moved to a later time counts as a new one', () => {
  const sim = simulate();
  sim.tick(at(10), [event('a', at(10), at(11))]);
  sim.slack.status = LUNCH;
  sim.tick(at(10, 1), [event('a', at(10), at(11))]);
  // moved to the afternoon; the script didn't run in between
  const moved = [event('a', at(14), at(15))];
  assert.deepEqual(sim.tick(at(14), moved), meeting(at(15)));
  assert.deepEqual(sim.tick(at(15), moved), LUNCH);
});

test('declined, unanswered, free and non-meeting events are ignored', () => {
  const sim = simulate();
  const events = [
    event('declined', at(10), at(11), { myResponse: 'declined' }),
    event('unanswered', at(10), at(11), { myResponse: 'needsAction' }),
    event('free', at(10), at(11), { transparent: true }),
    event('location', at(0), at(24), { eventType: 'workingLocation', allDay: true, transparent: true }),
    event('birthday', at(0), at(24), { eventType: 'birthday', allDay: true, transparent: true }),
  ];
  assert.equal(sim.tick(at(10), events), null);
});

test('tentative events and own events without guests count', () => {
  const tentative = simulate();
  assert.deepEqual(tentative.tick(at(10), [event('a', at(10), at(11), { myResponse: 'tentative' })]), meeting(at(11)));
  const own = simulate();
  assert.deepEqual(own.tick(at(10), [event('a', at(10), at(11), { myResponse: null })]), meeting(at(11)));
});

test('an all-day event counts even when free, a meeting during it takes over', () => {
  const sim = simulate();
  const events = [
    event('day', at(0), at(24), { allDay: true, transparent: true }),
    event('m', at(10), at(11)),
  ];
  assert.deepEqual(sim.tick(at(9), events), busy(at(24)));
  assert.deepEqual(sim.tick(at(10), events), meeting(at(11)));
  assert.deepEqual(sim.tick(at(11), events), busy(at(24)));
  assert.deepEqual(sim.tick(at(24), events), MANUAL);
});

test('a status with a protected emoji is never overwritten', () => {
  const sick = { text: 'Sick', emoji: ':face_with_thermometer:', expiration: 0 };
  const sim = simulate(sick);
  const events = [event('ooo', at(8), at(18), { eventType: 'outOfOffice' }), event('m', at(10), at(11))];
  assert.equal(sim.tick(at(10), events), null);
  assert.equal(sim.tick(at(11), events), null);
});

test('pause: once the protected status expires, the running meeting is applied', () => {
  const pause = { ...PAUSE, expiration: at(10, 30) };
  const sim = simulate(pause);
  const events = [event('a', at(10), at(11))];
  assert.equal(sim.tick(at(9, 50), events), null);
  assert.equal(sim.tick(at(10), events), null);
  sim.slack.status = EMPTY; // Slack cleared the pause at 10:30
  assert.deepEqual(sim.tick(at(10, 31), events), meeting(at(11)));
  assert.deepEqual(sim.tick(at(11), events), EMPTY);
});

test('a pause set during a meeting resumes the meeting when it expires', () => {
  const sim = simulate();
  const events = [event('a', at(10), at(11))];
  sim.tick(at(10), events);
  sim.slack.status = { ...PAUSE, expiration: at(10, 30) };
  assert.equal(sim.tick(at(10, 1), events), null);
  assert.equal(sim.tick(at(10, 15), events), null);
  sim.slack.status = EMPTY; // Slack cleared the pause at 10:30
  assert.deepEqual(sim.tick(at(10, 31), events), meeting(at(11)));
  assert.deepEqual(sim.tick(at(11), events), EMPTY);
});

test('an expired pause Slack still shows is not honored', () => {
  const sim = simulate();
  const events = [event('a', at(10), at(11))];
  sim.tick(at(10), events);
  sim.slack.status = { ...PAUSE, expiration: at(10, 30) };
  sim.tick(at(10, 1), events);
  assert.deepEqual(sim.tick(at(10, 31), events), meeting(at(11)));
});

test('a pause does not undo skipping an event', () => {
  const sim = simulate();
  const events = [event('a', at(10), at(11))];
  sim.tick(at(10), events);
  sim.slack.status = LUNCH; // skips the meeting
  sim.tick(at(10, 1), events);
  sim.slack.status = { ...PAUSE, expiration: at(10, 30) };
  sim.tick(at(10, 2), events);
  sim.slack.status = EMPTY; // Slack cleared the pause at 10:30
  assert.equal(sim.tick(at(10, 31), events), null);
  assert.equal(sim.tick(at(11), events), null);
});

test('a pause cleared by hand resumes the running meeting', () => {
  const sim = simulate();
  const events = [event('a', at(10), at(11))];
  sim.tick(at(10), events);
  sim.slack.status = PAUSE; // no expiration
  assert.equal(sim.tick(at(10, 1), events), null);
  sim.slack.status = EMPTY;
  assert.deepEqual(sim.tick(at(10, 2), events), meeting(at(11)));
  assert.deepEqual(sim.tick(at(11), events), EMPTY);
});

test('a timed pause cleared by hand before it expires resumes the running meeting', () => {
  const sim = simulate();
  const events = [event('a', at(10), at(11))];
  sim.tick(at(10), events);
  sim.slack.status = { ...PAUSE, expiration: at(10, 30) };
  assert.equal(sim.tick(at(10, 1), events), null);
  sim.slack.status = EMPTY;
  assert.deepEqual(sim.tick(at(10, 2), events), meeting(at(11)));
  assert.deepEqual(sim.tick(at(11), events), EMPTY);
});

test('a pause from before the meeting, cleared during it, lets the meeting apply', () => {
  const sim = simulate(PAUSE);
  const events = [event('a', at(10), at(11))];
  assert.equal(sim.tick(at(9, 50), events), null);
  assert.equal(sim.tick(at(10), events), null);
  sim.slack.status = EMPTY;
  assert.deepEqual(sim.tick(at(10, 15), events), meeting(at(11)));
});

test('clearing a pause by hand does not undo skipping an event', () => {
  const sim = simulate();
  const events = [event('a', at(10), at(11))];
  sim.tick(at(10), events);
  sim.slack.status = LUNCH; // skips the meeting
  sim.tick(at(10, 1), events);
  sim.slack.status = PAUSE;
  sim.tick(at(10, 2), events);
  sim.slack.status = EMPTY;
  assert.equal(sim.tick(at(10, 3), events), null);
  assert.equal(sim.tick(at(11), events), null);
});

test('replacing a pause with an ordinary status skips the running meeting', () => {
  const sim = simulate();
  const events = [event('a', at(10), at(11))];
  sim.tick(at(10), events);
  sim.slack.status = PAUSE;
  sim.tick(at(10, 1), events);
  sim.slack.status = LUNCH;
  assert.equal(sim.tick(at(10, 2), events), null);
  assert.equal(sim.tick(at(11), events), null);
  assert.deepEqual(sim.slack.status, LUNCH);
});

test('clearing an event status by hand is a skip even when its emoji is protected', () => {
  const sim = simulate(MANUAL, { ...CONFIG, protectedEmoji: [CONFIG.statuses.meeting.emoji] });
  const events = [event('a', at(10), at(11))];
  assert.deepEqual(sim.tick(at(10), events), meeting(at(11)));
  sim.slack.status = EMPTY;
  assert.equal(sim.tick(at(10, 15), events), null);
  assert.equal(sim.tick(at(11), events), null);
});

test('a manual status that expired during a meeting is not restored or kept', () => {
  const sim = simulate({ ...LUNCH, expiration: at(10, 30) });
  const events = [event('a', at(10), at(11))];
  sim.tick(at(9, 55), events);
  assert.deepEqual(sim.tick(at(10), events), meeting(at(11)));
  assert.deepEqual(sim.tick(at(11), events), EMPTY);
  assert.deepEqual(sim.state.baseline, EMPTY);
  assert.equal(sim.tick(at(24 + 11)), null);
  assert.deepEqual(sim.state.baseline, EMPTY);
});

test('an unconfirmed write that went through is not taken for a manual change', () => {
  const sim = simulate();
  const events = [event('a', at(10), at(11))];
  assert.deepEqual(sim.tick(at(10), events, 'unconfirmed'), meeting(at(11)));
  assert.equal(sim.tick(at(10, 1), events), null);
  assert.deepEqual(sim.state.baseline, MANUAL);
  assert.deepEqual(sim.tick(at(11), events, 'unconfirmed'), MANUAL);
  assert.equal(sim.tick(at(11, 1), events), null);
  assert.deepEqual(sim.state.baseline, MANUAL);
});

test('a failed write is retried', () => {
  const sim = simulate();
  const events = [event('a', at(10), at(11))];
  assert.deepEqual(sim.tick(at(10), events, 'failed'), meeting(at(11)));
  assert.deepEqual(sim.tick(at(10, 1), events), meeting(at(11)));
  assert.deepEqual(sim.tick(at(11), events), MANUAL);
});

test('a manual change after an unconfirmed write wins', () => {
  const sim = simulate();
  const events = [event('a', at(10), at(11))];
  sim.tick(at(10), events, 'unconfirmed');
  sim.slack.status = LUNCH;
  assert.equal(sim.tick(at(10, 5), events), null);
  assert.equal(sim.tick(at(11), events), null);
  assert.deepEqual(sim.slack.status, LUNCH);
});

test('an unconfirmed write that expired before the next run keeps the baseline', () => {
  const sim = simulate();
  sim.tick(at(10), [event('a', at(10), at(11))], 'unconfirmed');
  sim.slack.status = EMPTY; // Slack cleared it at 11:05, the script was not running
  assert.deepEqual(sim.tick(at(12)), MANUAL);
  assert.deepEqual(sim.state.baseline, MANUAL);
});

test('an unconfirmed write that expired is followed by the next event, then the baseline', () => {
  const sim = simulate();
  const events = [event('a', at(10), at(11)), event('b', at(12), at(13))];
  sim.tick(at(10), events, 'unconfirmed');
  sim.slack.status = EMPTY; // Slack cleared it at 11:05, the script was not running
  assert.deepEqual(sim.tick(at(12), events), meeting(at(13)));
  assert.deepEqual(sim.tick(at(13), events), MANUAL);
});

test('an unconfirmed write that outlived an expiring baseline leaves the status empty', () => {
  const sim = simulate({ ...LUNCH, expiration: at(10, 30) });
  sim.tick(at(9, 55));
  sim.tick(at(10), [event('a', at(10), at(11))], 'unconfirmed');
  sim.slack.status = EMPTY; // Slack cleared it at 11:05, the script was not running
  assert.equal(sim.tick(at(12)), null);
  assert.deepEqual(sim.state.baseline, EMPTY);
});

test('a failed write followed by downtime changes nothing', () => {
  const sim = simulate();
  sim.tick(at(10), [event('a', at(10), at(11))], 'failed');
  assert.equal(sim.tick(at(12)), null);
  assert.deepEqual(sim.state.baseline, MANUAL);
  assert.deepEqual(sim.slack.status, MANUAL);
});

test('a failed write over an empty status is retried', () => {
  const sim = simulate(EMPTY);
  const events = [event('a', at(10), at(11))];
  assert.deepEqual(sim.tick(at(10), events, 'failed'), meeting(at(11)));
  assert.deepEqual(sim.tick(at(10, 1), events), meeting(at(11)));
  assert.deepEqual(sim.tick(at(11), events), EMPTY);
});

test('a failed write over a status of ours, followed by downtime, still restores the baseline', () => {
  const sim = simulate();
  assert.deepEqual(sim.tick(at(8), [event('ooo', at(8), at(18), { eventType: 'outOfOffice' })]), ooo(at(18)));
  // the out-of-office event got deleted, a meeting runs instead
  sim.tick(at(10), [event('a', at(10), at(11))], 'failed');
  assert.deepEqual(sim.slack.status, ooo(at(18)));
  assert.deepEqual(sim.tick(at(12)), MANUAL);
});

test('a manual status set after an unconfirmed write survives downtime', () => {
  const sim = simulate();
  sim.tick(at(10), [event('a', at(10), at(11))], 'unconfirmed');
  sim.slack.status = LUNCH;
  assert.equal(sim.tick(at(12)), null);
  assert.deepEqual(sim.state.baseline, LUNCH);
});

test('a status cleared by hand right after an unconfirmed write is respected', () => {
  const sim = simulate();
  const events = [event('a', at(10), at(11))];
  sim.tick(at(10), events, 'unconfirmed');
  sim.slack.status = EMPTY; // long before the write would expire
  assert.equal(sim.tick(at(10, 5), events), null);
  assert.equal(sim.tick(at(11), events), null);
  assert.deepEqual(sim.state.baseline, EMPTY);
});

test('a manual status with time left is restored with its original expiration', () => {
  const lunch = { ...LUNCH, expiration: at(12) };
  const sim = simulate(lunch);
  const events = [event('a', at(10), at(11))];
  sim.tick(at(9, 55), events);
  sim.tick(at(10), events);
  assert.deepEqual(sim.tick(at(11), events), lunch);
});

test('our status expired while the script was down: the baseline comes back', () => {
  const sim = simulate();
  sim.tick(at(10), [event('a', at(10), at(11))]);
  sim.slack.status = EMPTY; // Slack cleared it at 11:05, the script was not running
  assert.deepEqual(sim.tick(at(12)), MANUAL);
});

test('disabled kinds of events are ignored', () => {
  const config = { ...CONFIG, statuses: { ...CONFIG.statuses, focusTime: null } };
  const sim = simulate(MANUAL, config);
  assert.equal(sim.tick(at(10), [event('f', at(10), at(11), { eventType: 'focusTime' })]), null);
});
