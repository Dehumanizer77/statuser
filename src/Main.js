const STATE_PROPERTY = 'STATE';

/**
 * Entry point, run every minute by a time-driven trigger.
 * Logs only what happened, never status texts or event details.
 */
function tick() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return; // the previous run is still going
  try {
    const props = PropertiesService.getScriptProperties();
    const saved = props.getProperty(STATE_PROPERTY);
    const now = Math.floor(Date.now() / 1000);

    const current = getSlackStatus();
    const events = fetchEvents(now);
    const { state, write } = decide(saved && JSON.parse(saved), current, events, now, CONFIG);

    // Saved before writing: if the write goes through but this run dies before
    // committing it, the next run recognizes it instead of taking it for a manual change.
    props.setProperty(STATE_PROPERTY, JSON.stringify(state));
    if (write) {
      const committed = commitWrite(state, setSlackStatus(write));
      props.setProperty(STATE_PROPERTY, JSON.stringify(committed));
      console.log(describeWrite(committed));
    }
  } finally {
    lock.releaseLock();
  }
}

/** Logs a summary of the saved state, without status texts or event details. */
function showState() {
  const saved = PropertiesService.getScriptProperties().getProperty(STATE_PROPERTY);
  if (!saved) {
    console.log('No saved state');
    return;
  }
  const s = JSON.parse(saved);
  console.log(JSON.stringify({
    baselineSet: !isEmptyStatus(s.baseline),
    baselineProtected: isProtected(s.baseline, CONFIG),
    baselineExpires: s.baseline.expiration > 0,
    applied: s.applied,
    skippedEvents: Object.keys(s.suppressed).length,
    pendingWrite: Boolean(s.pending),
    lastCheck: s.lastCheck ? new Date(s.lastCheck * 1000).toISOString() : null,
  }));
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
