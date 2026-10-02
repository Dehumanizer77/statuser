/**
 * Statuser configuration. Edit freely, changes apply on the next run.
 */
const CONFIG = {
  // Status for each kind of event, highest priority first (see LAYER_PRIORITY).
  // Set a kind to null to ignore those events completely.
  statuses: {
    outOfOffice: { emoji: ':palm_tree:', text: 'Out of office' },
    meeting: { emoji: ':calendar:', text: 'In a meeting' },
    focusTime: { emoji: ':headphones:', text: 'Focus time' },
    allDay: { emoji: ':calendar:', text: 'Busy' },
  },

  // A manually set status with one of these emoji is never overwritten.
  // Set one with Slack's "Clear after…" to pause Statuser for a while.
  protectedEmoji: [':lock:', ':face_with_thermometer:'],

  // Our status expires this long after the event ends, so it can't get stuck
  // when the script stops running.
  safetyMarginMinutes: 5,
};
