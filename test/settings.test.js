// Tests for the pure part of src/Settings.js. Run with: node --test
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ctx = vm.createContext({});
for (const file of ['Config.js', 'Logic.js', 'Settings.js']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src', file), 'utf8'), ctx, { filename: file });
}
// Plain copies, so deepEqual doesn't trip over objects from another context.
const plain = (value) => JSON.parse(JSON.stringify(value));
const call = (fn, ...args) => plain(ctx[fn] ? ctx[fn](...args) : vm.runInContext(fn, ctx)(...args));
const DEFAULTS = plain(vm.runInContext('DEFAULT_SETTINGS', ctx));

/** Settings as the page sends them: protected emoji as one string, margin as text. */
function pageInput(overrides = {}) {
  return {
    ...plain(DEFAULTS),
    protectedEmoji: DEFAULTS.protectedEmoji.join(' '),
    safetyMarginMinutes: String(DEFAULTS.safetyMarginMinutes),
    ...overrides,
  };
}

test('without saved settings the defaults apply', () => {
  assert.deepEqual(call('withDefaults', null), DEFAULTS);
});

test('saved settings override the defaults, missing parts fall back to them', () => {
  const merged = call('withDefaults', {
    statuses: { meeting: { emoji: ':date:' } },
    safetyMarginMinutes: 10,
  });
  assert.deepEqual(merged.statuses.meeting, { enabled: true, emoji: ':date:', text: 'In a meeting' });
  assert.deepEqual(merged.statuses.outOfOffice, DEFAULTS.statuses.outOfOffice);
  assert.deepEqual(merged.protectedEmoji, DEFAULTS.protectedEmoji);
  assert.equal(merged.safetyMarginMinutes, 10);
});

test('a disabled kind of event becomes null in the config', () => {
  const settings = plain(DEFAULTS);
  settings.statuses.focusTime.enabled = false;
  const config = call('toConfig', settings);
  assert.equal(config.statuses.focusTime, null);
  assert.deepEqual(config.statuses.meeting, { emoji: ':calendar:', text: 'In a meeting' });
});

test('valid settings are cleaned up', () => {
  const input = pageInput({ protectedEmoji: 'lock, :Face_With_Thermometer:  :lock: :wave::skin-tone-3:' });
  input.statuses.meeting = { enabled: true, emoji: ' Date ', text: '  On a call  ' };
  const { settings, errors } = call('validateSettings', input);
  assert.deepEqual(errors, {});
  assert.deepEqual(settings.statuses.meeting, { enabled: true, emoji: ':date:', text: 'On a call' });
  assert.deepEqual(settings.protectedEmoji, [':lock:', ':face_with_thermometer:', ':wave::skin-tone-3:']);
  assert.equal(settings.safetyMarginMinutes, 5);
});

test('invalid settings are rejected with an error per field', () => {
  const input = pageInput({ protectedEmoji: ':lock: what?', safetyMarginMinutes: '0' });
  input.statuses.meeting = { enabled: true, emoji: '', text: '' };
  input.statuses.allDay = { enabled: true, emoji: ':calendar:', text: 'x'.repeat(101) };
  const { settings, errors } = call('validateSettings', input);
  assert.equal(settings, null);
  assert.deepEqual(Object.keys(errors).sort(), [
    'allDay.text', 'meeting.emoji', 'meeting.text', 'protectedEmoji', 'safetyMarginMinutes',
  ]);
  assert.equal(errors.protectedEmoji, 'Not an emoji name: what?');
});

test('a disabled kind of event may be left empty', () => {
  const input = pageInput();
  input.statuses.focusTime = { enabled: false, emoji: '', text: '' };
  const { settings, errors } = call('validateSettings', input);
  assert.deepEqual(errors, {});
  assert.equal(settings.statuses.focusTime.enabled, false);
});

test('an empty protected emoji list is allowed', () => {
  const { settings } = call('validateSettings', pageInput({ protectedEmoji: '  ' }));
  assert.deepEqual(settings.protectedEmoji, []);
});
