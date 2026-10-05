/**
 * Events on the primary calendar that overlap the next minute.
 * Only the fields Statuser needs are downloaded: no titles, descriptions or guest e-mails.
 *
 * All pages are read, Google may return partial or even empty pages before the last one.
 * If any page fails, the error propagates and the run decides nothing.
 *
 * @param {number} now unix seconds
 * @returns {CalEvent[]}
 */
function fetchEvents_(now) {
  const events = [];
  let pageToken = null;
  do {
    const options = {
      timeMin: new Date(now * 1000).toISOString(),
      timeMax: new Date((now + 60) * 1000).toISOString(),
      singleEvents: true,
      maxResults: 250,
      fields: 'timeZone,nextPageToken,' +
        'items(id,eventType,transparency,start,end,attendees(self,responseStatus))',
    };
    if (pageToken) options.pageToken = pageToken;
    const res = Calendar.Events.list('primary', options);
    for (const item of res.items || []) events.push(normalizeEvent(item, res.timeZone));
    pageToken = res.nextPageToken;
  } while (pageToken);
  return events;
}

function normalizeEvent(item, timeZone) {
  // No attendee entry for me means it's my own event without guests.
  const me = (item.attendees || []).find((a) => a.self);
  return {
    id: item.id,
    eventType: item.eventType || 'default',
    allDay: Boolean(item.start.date),
    transparent: item.transparency === 'transparent',
    myResponse: me ? me.responseStatus : null,
    start: toUnix(item.start, timeZone),
    end: toUnix(item.end, timeZone),
  };
}

function toUnix(time, timeZone) {
  const date = time.dateTime
    ? new Date(time.dateTime)
    : Utilities.parseDate(time.date, timeZone, 'yyyy-MM-dd'); // all-day: midnight in the calendar's zone
  return Math.floor(date.getTime() / 1000);
}
