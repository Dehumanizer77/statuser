/**
 * Default settings. Change them on the settings page (see README) rather than
 * here: saved settings are kept apart from the code, so pasting a new version
 * of the code doesn't reset them.
 */
const DEFAULT_SETTINGS = {
  // Status for each kind of event, highest priority first (see LAYER_PRIORITY).
  // A disabled kind of event is ignored completely.
  statuses: {
    outOfOffice: { enabled: true, emoji: ':palm_tree:', text: 'Out of office' },
    meeting: { enabled: true, emoji: ':calendar:', text: 'In a meeting' },
    focusTime: { enabled: true, emoji: ':headphones:', text: 'Focus time' },
    allDay: { enabled: true, emoji: ':calendar:', text: 'Busy' },
  },

  // A manually set status with one of these emoji is never overwritten.
  // Set one with Slack's "Clear after…" to pause Statuser for a while.
  protectedEmoji: [':lock:', ':face_with_thermometer:'],

  // Our status expires this long after the event ends, so it can't get stuck
  // when the script stops running.
  safetyMarginMinutes: 5,
};
