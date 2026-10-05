/**
 * The settings page served by doGet(). Kept as a string so the whole app stays
 * plain script files (the editor and bundle.sh need nothing else).
 * Note: it's a String.raw template, so the page must not contain backticks or "${".
 */
const SETTINGS_PAGE = String.raw`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<base target="_top">
<style>
  :root {
    --bg: #f5f6fa; --card: #ffffff; --text: #1c2230; --muted: #5d6576;
    --border: #dde1ea; --input: #ffffff; --accent: #4263eb; --accent-text: #ffffff;
    --error: #c92a2a; --ok: #2b8a3e;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #13151b; --card: #1c1f27; --text: #e7e9ef; --muted: #9ba3b4;
      --border: #333a47; --input: #161920; --accent: #748ffc; --accent-text: #0f1218;
      --error: #ff8787; --ok: #69db7c;
    }
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; background: var(--bg); color: var(--text);
    font: 15px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  }
  main { max-width: 780px; margin: 0 auto; padding: 32px 16px 48px; }
  h1 { font-size: 24px; line-height: 1.2; margin: 0 0 6px; }
  h2 { font-size: 16px; margin: 0 0 4px; }
  p { margin: 0; }
  .muted { color: var(--muted); }
  .small { font-size: 13px; }
  section {
    background: var(--card); border: 1px solid var(--border);
    border-radius: 12px; padding: 20px; margin-top: 20px;
  }
  .row {
    display: grid; grid-template-columns: 190px 170px 1fr; gap: 12px;
    padding: 14px 0; align-items: start;
  }
  .row + .row { border-top: 1px solid var(--border); }
  .kind { display: flex; gap: 10px; align-items: flex-start; font-weight: 600; padding-top: 22px; }
  .kind input { margin: 4px 0 0; width: 16px; height: 16px; accent-color: var(--accent); }
  .kind .small { font-weight: 400; }
  label.field-label { display: block; font-size: 13px; color: var(--muted); margin-bottom: 4px; }
  input[type=text], input[type=number] {
    width: 100%; padding: 8px 10px; font: inherit; color: var(--text);
    background: var(--input); border: 1px solid var(--border); border-radius: 8px;
  }
  input:focus { outline: 2px solid var(--accent); outline-offset: 1px; }
  input:disabled { opacity: 0.5; }
  input[aria-invalid=true] { border-color: var(--error); }
  .error { color: var(--error); font-size: 13px; min-height: 0; margin-top: 4px; }
  .error:empty { display: none; }
  .inline { display: flex; align-items: center; gap: 10px; margin-top: 10px; }
  .inline input { width: 90px; }
  .actions { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; margin-top: 24px; }
  button {
    font: inherit; font-weight: 600; padding: 9px 18px; border-radius: 8px; cursor: pointer;
    border: 1px solid var(--border); background: var(--card); color: var(--text);
  }
  button.primary { background: var(--accent); border-color: var(--accent); color: var(--accent-text); }
  button:disabled { opacity: 0.6; cursor: default; }
  #message.ok { color: var(--ok); }
  #message.error { color: var(--error); }
  @media (max-width: 640px) {
    .row { grid-template-columns: 1fr; gap: 8px; }
    .kind { padding-top: 0; }
  }
</style>
</head>
<body>
<main>
  <h1>Statuser settings</h1>
  <p class="muted">Your Slack status during calendar events. Changes apply from the next run, within a minute.</p>

  <p id="loading" class="muted" style="margin-top: 24px">Loading…</p>

  <div id="content" hidden>
    <section>
      <h2>Statuses</h2>
      <p class="muted small">Highest priority first: when events overlap, the upper one wins.
        Find an emoji's exact name by hovering over it in Slack's emoji picker.</p>
      <div id="kinds"></div>
    </section>

    <section>
      <h2>Protected emoji</h2>
      <p class="muted small">A status you set yourself with one of these emoji is never overwritten.
        Set one with Slack's "Clear after…" to pause Statuser for a while.
        Separate them with spaces or commas.</p>
      <div style="margin-top: 10px">
        <input type="text" id="protectedEmoji" aria-label="Protected emoji"
          placeholder=":lock: :face_with_thermometer:" autocomplete="off" spellcheck="false">
        <div class="error" id="protectedEmoji-error"></div>
      </div>
    </section>

    <section>
      <h2>Safety margin</h2>
      <p class="muted small">Statuser's status expires this long after the event ends, so it can't
        get stuck if the script stops running.</p>
      <div class="inline">
        <input type="number" id="safetyMarginMinutes" min="1" max="60" step="1"
          aria-label="Safety margin in minutes">
        <span>minutes</span>
      </div>
      <div class="error" id="safetyMarginMinutes-error"></div>
    </section>

    <div class="actions">
      <button type="button" class="primary" id="save">Save</button>
      <button type="button" id="defaults">Fill in defaults</button>
      <p id="message" role="status"></p>
    </div>
  </div>
</main>

<script>
  var KINDS = [
    ['outOfOffice', 'Out of office', 'Out-of-office events'],
    ['meeting', 'Meeting', 'Timed events shown as busy'],
    ['focusTime', 'Focus time', 'Focus time events'],
    ['allDay', 'All-day event', 'Any all-day event']
  ];
  var defaults = null;

  function el(id) { return document.getElementById(id); }

  function field(id, label, placeholder, maxlength) {
    return '<div><label class="field-label" for="' + id + '">' + label + '</label>' +
      '<input type="text" id="' + id + '" placeholder="' + placeholder + '" maxlength="' +
      maxlength + '" autocomplete="off" spellcheck="false">' +
      '<div class="error" id="' + id + '-error"></div></div>';
  }

  function buildRows() {
    KINDS.forEach(function (kind) {
      var id = kind[0];
      var row = document.createElement('div');
      row.className = 'row';
      row.innerHTML =
        '<label class="kind"><input type="checkbox" id="' + id + '.enabled">' +
        '<span>' + kind[1] + '<br><span class="small muted">' + kind[2] + '</span></span></label>' +
        field(id + '.emoji', 'Emoji', ':calendar:', 80) +
        field(id + '.text', 'Status text', 'In a meeting', 100);
      el('kinds').appendChild(row);
      el(id + '.enabled').addEventListener('change', updateEnabled);
    });
  }

  function updateEnabled() {
    KINDS.forEach(function (kind) {
      var on = el(kind[0] + '.enabled').checked;
      el(kind[0] + '.emoji').disabled = !on;
      el(kind[0] + '.text').disabled = !on;
    });
  }

  function fill(settings) {
    KINDS.forEach(function (kind) {
      var status = settings.statuses[kind[0]];
      el(kind[0] + '.enabled').checked = status.enabled;
      el(kind[0] + '.emoji').value = status.emoji;
      el(kind[0] + '.text').value = status.text;
    });
    el('protectedEmoji').value = settings.protectedEmoji.join(' ');
    el('safetyMarginMinutes').value = settings.safetyMarginMinutes;
    updateEnabled();
  }

  function read() {
    var statuses = {};
    KINDS.forEach(function (kind) {
      statuses[kind[0]] = {
        enabled: el(kind[0] + '.enabled').checked,
        emoji: el(kind[0] + '.emoji').value,
        text: el(kind[0] + '.text').value
      };
    });
    return {
      statuses: statuses,
      protectedEmoji: el('protectedEmoji').value,
      safetyMarginMinutes: el('safetyMarginMinutes').value
    };
  }

  function showMessage(text, kind) {
    var message = el('message');
    message.textContent = text;
    message.className = kind || '';
  }

  function clearErrors() {
    var boxes = document.querySelectorAll('.error');
    for (var i = 0; i < boxes.length; i++) boxes[i].textContent = '';
    var inputs = document.querySelectorAll('[aria-invalid]');
    for (var j = 0; j < inputs.length; j++) inputs[j].removeAttribute('aria-invalid');
  }

  function setBusy(busy) {
    el('save').disabled = busy;
    el('defaults').disabled = busy;
  }

  function save() {
    clearErrors();
    setBusy(true);
    showMessage('Saving…');
    google.script.run
      .withSuccessHandler(function (result) {
        setBusy(false);
        if (result.settings) {
          fill(result.settings);
          showMessage('Saved. Applies from the next run, within a minute.', 'ok');
          return;
        }
        Object.keys(result.errors).forEach(function (key) {
          var box = el(key + '-error');
          if (box) box.textContent = result.errors[key];
          var input = el(key);
          if (input) input.setAttribute('aria-invalid', 'true');
        });
        showMessage('Not saved, please fix the fields marked in red.', 'error');
      })
      .withFailureHandler(function (error) {
        setBusy(false);
        showMessage('Could not save: ' + error.message, 'error');
      })
      .saveSettingsFromPage(read());
  }

  buildRows();
  el('save').addEventListener('click', save);
  el('defaults').addEventListener('click', function () {
    clearErrors();
    fill(defaults);
    showMessage('Defaults filled in. Click Save to keep them.');
  });

  google.script.run
    .withSuccessHandler(function (data) {
      defaults = data.defaults;
      fill(data.settings);
      el('loading').hidden = true;
      el('content').hidden = false;
    })
    .withFailureHandler(function (error) {
      el('loading').textContent = 'Could not load the settings: ' + error.message;
    })
    .getSettingsForPage();
</script>
</body>
</html>
`;
