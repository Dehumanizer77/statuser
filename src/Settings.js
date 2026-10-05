/**
 * Settings: stored as JSON in the script properties, edited on the settings page
 * (SettingsPage.js), served as a web app only you can open.
 */
const SETTINGS_PROPERTY = 'SETTINGS';

/** ":name:", optionally with a skin tone, e.g. ":wave::skin-tone-3:". */
const EMOJI_PATTERN = /^:[a-z0-9_+'.-]+:(:skin-tone-[2-6]:)?$/;

/** Slack's limit for a status text. */
const MAX_STATUS_TEXT = 100;

/** "palm_tree", " :Palm_Tree: " etc. become ":palm_tree:". */
function normalizeEmoji(value) {
  const name = String(value).trim().toLowerCase().replace(/^:+|:+$/g, '');
  return name ? `:${name}:` : '';
}

/** Saved settings on top of the defaults; anything missing falls back to them. */
function withDefaults(saved) {
  const s = saved || {};
  const savedStatuses = s.statuses || {};
  const statuses = {};
  for (const layer of LAYER_PRIORITY) {
    statuses[layer] = { ...DEFAULT_SETTINGS.statuses[layer], ...savedStatuses[layer] };
  }
  return {
    statuses,
    protectedEmoji: Array.isArray(s.protectedEmoji) ? s.protectedEmoji : DEFAULT_SETTINGS.protectedEmoji,
    safetyMarginMinutes: Number.isInteger(s.safetyMarginMinutes)
      ? s.safetyMarginMinutes
      : DEFAULT_SETTINGS.safetyMarginMinutes,
  };
}

/** @returns {Config} settings in the shape decide() takes */
function toConfig(settings) {
  const statuses = {};
  for (const layer of LAYER_PRIORITY) {
    const { enabled, emoji, text } = settings.statuses[layer];
    statuses[layer] = enabled ? { emoji, text } : null;
  }
  return {
    statuses,
    protectedEmoji: settings.protectedEmoji,
    safetyMarginMinutes: settings.safetyMarginMinutes,
  };
}

/**
 * Checks and cleans settings sent by the settings page.
 * @returns {{settings: ?Object, errors: Object<string, string>}} errors by field ID,
 *   settings only when there are none
 */
function validateSettings(input) {
  const errors = {};

  const statuses = {};
  for (const layer of LAYER_PRIORITY) {
    const raw = (input.statuses || {})[layer] || {};
    const status = {
      enabled: raw.enabled === true,
      emoji: normalizeEmoji(raw.emoji || ''),
      text: String(raw.text || '').trim(),
    };
    // A disabled kind may be left half filled in, it isn't used.
    if (status.enabled) {
      if (!EMOJI_PATTERN.test(status.emoji)) {
        errors[`${layer}.emoji`] = 'Enter an emoji name, e.g. :calendar:';
      }
      if (!status.text) errors[`${layer}.text`] = 'Enter a status text';
    }
    if (status.text.length > MAX_STATUS_TEXT) {
      errors[`${layer}.text`] = `At most ${MAX_STATUS_TEXT} characters`;
    }
    statuses[layer] = status;
  }

  const protectedEmoji = [];
  const list = Array.isArray(input.protectedEmoji) ? input.protectedEmoji.join(' ') : input.protectedEmoji;
  for (const part of String(list || '').split(/[\s,]+/)) {
    if (!part) continue;
    const emoji = normalizeEmoji(part);
    if (!EMOJI_PATTERN.test(emoji)) {
      errors.protectedEmoji = `Not an emoji name: ${part}`;
    } else if (protectedEmoji.indexOf(emoji) === -1) {
      protectedEmoji.push(emoji);
    }
  }

  const margin = Number(input.safetyMarginMinutes);
  if (!Number.isInteger(margin) || margin < 1 || margin > 60) {
    errors.safetyMarginMinutes = 'A whole number from 1 to 60';
  }

  if (Object.keys(errors).length) return { settings: null, errors };
  return { settings: { statuses, protectedEmoji, safetyMarginMinutes: margin }, errors };
}

/** Saved settings merged with the defaults. */
function loadSettings() {
  const saved = PropertiesService.getScriptProperties().getProperty(SETTINGS_PROPERTY);
  return withDefaults(saved ? JSON.parse(saved) : null);
}

/** @returns {Config} the configuration runs use */
function loadConfig() {
  return toConfig(loadSettings());
}

/** Serves the settings page. */
function doGet() {
  return HtmlService.createHtmlOutput(SETTINGS_PAGE)
    .setTitle('Statuser settings')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/** Called by the settings page when it opens. */
function getSettingsForPage() {
  return { settings: loadSettings(), defaults: DEFAULT_SETTINGS };
}

/**
 * Called by the settings page to save.
 * @returns {{settings: ?Object, errors: Object<string, string>}} the saved settings, or errors by field
 */
function saveSettingsFromPage(input) {
  const result = validateSettings(input);
  if (result.settings) {
    PropertiesService.getScriptProperties().setProperty(SETTINGS_PROPERTY, JSON.stringify(result.settings));
  }
  return result;
}
