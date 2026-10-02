/** Slack user token (xoxp-…), stored in the script properties. */
const TOKEN_PROPERTY = 'SLACK_USER_TOKEN';

/** @returns {Status} */
function getSlackStatus() {
  return toStatus(slackCall('users.profile.get').profile);
}

/**
 * @param {Status} status
 * @returns {Status} the status as Slack stored it
 */
function setSlackStatus(status) {
  const res = slackCall('users.profile.set', {
    profile: {
      status_text: status.text,
      status_emoji: status.emoji,
      status_expiration: status.expiration,
    },
  });
  return toStatus(res.profile);
}

function toStatus(profile) {
  return {
    text: profile.status_text || '',
    emoji: profile.status_emoji || '',
    expiration: profile.status_expiration || 0,
  };
}

function slackCall(method, body) {
  const token = PropertiesService.getScriptProperties().getProperty(TOKEN_PROPERTY);
  if (!token) throw new Error(`Script property ${TOKEN_PROPERTY} is not set`);

  const options = {
    headers: { Authorization: `Bearer ${token}` },
    muteHttpExceptions: true,
    followRedirects: false, // the endpoints are fixed, a redirect is rejected as a non-200 below
  };
  if (body) {
    options.method = 'post';
    options.contentType = 'application/json; charset=utf-8';
    options.payload = JSON.stringify(body);
  }
  const res = UrlFetchApp.fetch(`https://slack.com/api/${method}`, options);
  if (res.getResponseCode() !== 200) {
    throw new Error(`Slack ${method}: HTTP ${res.getResponseCode()}`);
  }
  const data = JSON.parse(res.getContentText());
  if (!data.ok) throw new Error(`Slack ${method}: ${data.error}`);
  return data;
}
