/**
 * Functions run from the editor or by the trigger. They have to stay public, like
 * the three the settings page calls (Settings.js). Everything else that reaches
 * Slack, the calendar or the script properties ends with an underscore, which puts
 * it out of reach of google.script.run, i.e. of whoever can open the settings page.
 */
const STATE_PROPERTY = 'STATE';

/**
 * Entry point, run every minute by a time-driven trigger.
 * Logs only what happened, never status texts, emoji or event IDs.
 */
function tick() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return; // the previous run is still going
  try {
    const props = PropertiesService.getScriptProperties();
    const saved = props.getProperty(STATE_PROPERTY);
    const now = Math.floor(Date.now() / 1000);

    const current = getSlackStatus_();
    const events = fetchEvents_(now);
    const { state, write } = decide(saved && JSON.parse(saved), current, events, now, loadConfig_());

    // Saved before writing: if the write goes through but this run dies before
    // committing it, the next run recognizes it instead of taking it for a manual change.
    props.setProperty(STATE_PROPERTY, JSON.stringify(state));
    if (write) {
      const committed = commitWrite(state, setSlackStatus_(write));
      props.setProperty(STATE_PROPERTY, JSON.stringify(committed));
      console.log(describeWrite(committed));
    } else {
      console.log('No change');
    }
  } finally {
    lock.releaseLock();
  }
}

/**
 * Logs a summary of the saved state: no status texts, emoji or event IDs, but it
 * does tell when the last check ran and how many events are being skipped.
 */
function showState() {
  const saved = PropertiesService.getScriptProperties().getProperty(STATE_PROPERTY);
  if (!saved) {
    console.log('No saved state');
    return;
  }
  const s = JSON.parse(saved);
  console.log(JSON.stringify({
    baselineSet: !isEmptyStatus(s.baseline),
    baselineProtected: isProtected(s.baseline, loadConfig_()),
    baselineExpires: s.baseline.expiration > 0,
    applied: s.applied,
    skippedEvents: Object.keys(s.suppressed).length,
    pendingWrite: Boolean(s.pending),
    lastCheck: s.lastCheck ? new Date(s.lastCheck * 1000).toISOString() : null,
  }));
}

/**
 * Explains what the next run would do and why. Run it from the editor when the
 * status doesn't change as expected.
 * Logs no status texts, emoji or event IDs, but it does describe the events: how
 * many there are, each one's kind, whether it's free or busy and your response.
 */
function diagnose() {
  const now = Math.floor(Date.now() / 1000);
  const saved = PropertiesService.getScriptProperties().getProperty(STATE_PROPERTY);
  const state = saved && JSON.parse(saved);
  const current = getSlackStatus_();
  const events = fetchEvents_(now);

  const config = loadConfig_();
  const { state: next, write } = decide(state, current, events, now, config);
  const protectedNote = isProtected(current, config) ? ', with a protected emoji' : '';
  console.log(`Slack status: ${isEmptyStatus(current) ? 'empty' : 'set'}${protectedNote}`);
  console.log(`Events in your primary calendar right now: ${events.length}`);
  if (!events.length) {
    console.log('Is the event running right now (Google suggests the next half hour for new events) ' +
      'and is it in your own calendar, not in another one?');
  }
  for (const ev of events) {
    const layer = eventLayer(ev);
    let verdict = layer ? `counts as ${layer}` : 'ignored';
    if (layer && !config.statuses[layer]) verdict = `${layer}, disabled in settings`;
    if (!(ev.start <= now && now < ev.end)) verdict += ', not running yet';
    if (ev.id in next.suppressed) verdict += ', skipped after a manual change';
    console.log(`- ${ev.allDay ? 'all-day' : 'timed'} ${ev.eventType} event, ` +
      `${ev.transparent ? 'free' : 'busy'}, my response: ${ev.myResponse || 'none (own event)'}: ${verdict}`);
  }
  console.log(write ? 'The next run will change the status' : 'The next run will change nothing');
}

/**
 * Forgets the saved state; the next run takes the current Slack status as the baseline.
 * Run it only while no event status is set, otherwise that one becomes the baseline.
 */
function resetState() {
  PropertiesService.getScriptProperties().deleteProperty(STATE_PROPERTY);
}

function describeWrite(state) {
  if (state.applied) return `Applied ${state.applied} status`;
  return isEmptyStatus(state.lastSeen) ? 'Cleared status' : 'Restored own status';
}
