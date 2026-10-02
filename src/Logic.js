/**
 * Decision logic. Pure functions only (no Apps Script services), so it can be
 * tested locally with Node, see test/logic.test.js.
 *
 * Model: `baseline` is the status the user set themselves. The wanted status is
 * computed on every run from the events happening right now; when none applies,
 * the baseline is restored.
 *
 * `lastSeen` is the Slack status as last seen or written, `applied` says which
 * layer it came from (null = it's the user's own). A write is first recorded as
 * `pending` and committed once Slack confirms it, so the next run can tell an
 * unconfirmed write of ours from a manual change.
 *
 * @typedef {{text: string, emoji: string, expiration: number}} Status
 * @typedef {{id: string, eventType: string, allDay: boolean, transparent: boolean,
 *            myResponse: ?string, start: number, end: number}} CalEvent
 * @typedef {{status: Status, applied: ?string}} Write
 * @typedef {{baseline: Status, lastSeen: Status, applied: ?string,
 *            suppressed: Object<string, number>, running: Object<string, number>,
 *            lastCheck: ?number, pending?: Write}} State
 *   `suppressed` and `running` map event IDs to their end time.
 */

/** Highest priority first. */
const LAYER_PRIORITY = ['outOfOffice', 'meeting', 'focusTime', 'allDay'];

/** Calendar event types that never affect the status. */
const IGNORED_EVENT_TYPES = ['workingLocation', 'birthday'];

/** Invitations with these responses are ignored. */
const IGNORED_RESPONSES = ['declined', 'needsAction'];

const EMPTY_STATUS = { text: '', emoji: '', expiration: 0 };

/** Seconds of clock skew tolerated between Google and Slack. */
const EXPIRY_TOLERANCE = 30;

function sameStatus(a, b) {
  return a.text === b.text && a.emoji === b.emoji && a.expiration === b.expiration;
}

function isEmptyStatus(s) {
  return s.text === '' && s.emoji === '';
}

function isProtected(s, config) {
  return s.emoji !== '' && config.protectedEmoji.indexOf(s.emoji) !== -1;
}

/** The baseline as it should look at `now`, i.e. empty once its own expiration passed. */
function baselineAt(baseline, now) {
  return baseline.expiration > 0 && baseline.expiration <= now ? EMPTY_STATUS : baseline;
}

/**
 * Which layer an event belongs to, or null if it should not affect the status.
 * @param {CalEvent} ev
 */
function eventLayer(ev) {
  if (IGNORED_EVENT_TYPES.indexOf(ev.eventType) !== -1) return null;
  if (IGNORED_RESPONSES.indexOf(ev.myResponse) !== -1) return null;
  if (ev.eventType === 'outOfOffice') return 'outOfOffice';
  // All-day events count even when marked as free, which is Google's default for them.
  if (ev.allDay) return 'allDay';
  if (ev.transparent) return null;
  if (ev.eventType === 'focusTime') return 'focusTime';
  return 'meeting';
}

/** The highest priority layer among active events and when its last event ends. */
function topLayer(active) {
  for (const layer of LAYER_PRIORITY) {
    const ends = active.filter((a) => a.layer === layer).map((a) => a.ev.end);
    if (ends.length) return { layer, end: Math.max(...ends) };
  }
  return null;
}

/**
 * Settles a write the previous run started but didn't confirm. If Slack shows it,
 * it went through; otherwise it didn't, and whatever Slack shows now is judged
 * against `lastSeen` as usual (the write is retried, or a manual change wins).
 */
function resolvePending(state, current) {
  if (!state.pending) return state;
  const { pending, ...rest } = state;
  return sameStatus(current, pending.status)
    ? { ...rest, lastSeen: current, applied: pending.applied }
    : rest;
}

/**
 * Marks the pending write as done.
 * @param {State} state
 * @param {Status} written the status as Slack stored it
 */
function commitWrite(state, written) {
  const { pending, ...rest } = state;
  return { ...rest, lastSeen: written, applied: pending.applied };
}

/**
 * Computes what to do in one run.
 *
 * @param {?State} prev        state saved by the previous run, null on the first one
 * @param {Status} current     status currently set in Slack
 * @param {CalEvent[]} events  calendar events around `now`
 * @param {number} now         unix seconds
 * @param {typeof CONFIG} config
 * @returns {{state: State, write: ?Status}} the new state and the status to set (null = keep).
 *   When writing, the state holds it as `pending`; pass it to commitWrite() once Slack confirms.
 */
function decide(prev, current, events, now, config) {
  const state = prev
    ? resolvePending({ ...prev, suppressed: { ...prev.suppressed } }, current)
    : { baseline: current, lastSeen: current, applied: null, suppressed: {}, running: {}, lastCheck: null };
  const wasRunning = state.running || {};

  for (const id of Object.keys(state.suppressed)) {
    if (state.suppressed[id] <= now) delete state.suppressed[id];
  }

  const active = events
    .filter((ev) => ev.start <= now && now < ev.end)
    .map((ev) => ({ ev, layer: eventLayer(ev) }))
    .filter((a) => a.layer && config.statuses[a.layer]);

  if (!sameStatus(current, state.lastSeen)) {
    const expired = isEmptyStatus(current) && state.lastSeen.expiration > 0 &&
      state.lastSeen.expiration <= now + EXPIRY_TOLERANCE;
    if (expired) {
      // Slack cleared a status whose time ran out, that's not a manual change.
      // If it was ours, the baseline gets restored below.
      if (!state.applied) state.baseline = EMPTY_STATUS;
    } else {
      // Changed by hand: it becomes the new baseline and events seen running at the
      // previous check are no longer enforced. Events that started (or were added
      // to the calendar) since then still override it. A protected status is
      // a pause rather than a skip: the events resume once it's gone.
      state.baseline = current;
      if (!isProtected(current, config)) {
        for (const a of active) {
          if (a.ev.id in wasRunning) state.suppressed[a.ev.id] = a.ev.end;
        }
      }
    }
    state.applied = null;
    state.lastSeen = current;
  }
  state.lastCheck = now;
  state.running = {};
  for (const a of active) state.running[a.ev.id] = a.ev.end;
  // Don't keep an expired status around, it would never be restored anyway.
  state.baseline = baselineAt(state.baseline, now);

  const top = topLayer(active.filter((a) => !(a.ev.id in state.suppressed)));
  const layer = top && !isProtected(state.baseline, config) ? top.layer : null;
  let desired = state.baseline;
  if (layer) {
    const { text, emoji } = config.statuses[layer];
    desired = { text, emoji, expiration: top.end + config.safetyMarginMinutes * 60 };
  }

  if (sameStatus(desired, current)) {
    state.applied = layer;
    return { state, write: null };
  }
  state.pending = { status: desired, applied: layer };
  return { state, write: desired };
}
