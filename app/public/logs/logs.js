try {
  const t = localStorage.getItem('fivethings-theme');
  if (t && t !== 'default') document.body.classList.add('theme-' + t);
} catch (_) {}

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function parseLineDate(line) {
  const m = line.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!m) return null;
  return new Date(+m[3], +m[1] - 1, +m[2]);
}

function dayKey(date) {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function mondayOf(date) {
  const d = new Date(date);
  const dow = d.getDay(); // 0=Sun
  d.setDate(d.getDate() - (dow === 0 ? 6 : dow - 1));
  d.setHours(0, 0, 0, 0);
  return d;
}

function getBucket(date) {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const diffDays = Math.round((now - d) / 86400000);

  if (diffDays <= 6) return { type: 'day',   key: `day-${dayKey(date)}`,   date };

  if (diffDays <= 27) {
    const mon = mondayOf(date);
    return { type: 'week', key: `week-${dayKey(mon)}`, date: mon };
  }

  return { type: 'month', key: `month-${date.getFullYear()}-${date.getMonth()}`, date };
}

function bucketLabel(bucket) {
  const { type, date } = bucket;

  if (type === 'day') {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
    const weekday   = date.toLocaleDateString([], { weekday: 'long' });
    const shortDate = date.toLocaleDateString([], { month: 'short', day: 'numeric' });
    if (dayKey(date) === dayKey(today))     return { primary: `Today · ${weekday}`,     secondary: shortDate };
    if (dayKey(date) === dayKey(yesterday)) return { primary: `Yesterday · ${weekday}`, secondary: shortDate };
    return { primary: weekday, secondary: shortDate };
  }

  if (type === 'week') {
    const sun = new Date(date); sun.setDate(date.getDate() + 6);
    const startStr = date.toLocaleDateString([], { month: 'short', day: 'numeric' });
    const endStr   = date.getMonth() === sun.getMonth()
      ? `${sun.getDate()}`
      : sun.toLocaleDateString([], { month: 'short', day: 'numeric' });
    return { primary: `${startStr} – ${endStr}`, secondary: `${date.getFullYear()}` };
  }

  // month
  return {
    primary:   date.toLocaleDateString([], { month: 'long' }),
    secondary: `${date.getFullYear()}`
  };
}

function renderAccessLog(lines, container, counter) {
  counter.textContent = `${lines.length} line${lines.length !== 1 ? 's' : ''}`;
  if (!lines.length) {
    container.innerHTML = '<span class="log-empty">No entries yet.</span>';
    return;
  }

  const groups = [];
  const keyMap = {};
  for (const line of lines) {
    const date   = parseLineDate(line);
    const bucket = date ? getBucket(date) : { type: 'unknown', key: '__unknown__', date: null };
    if (!keyMap[bucket.key]) {
      keyMap[bucket.key] = { bucket, label: date ? bucketLabel(bucket) : { primary: '', secondary: '' }, lines: [] };
      groups.push(keyMap[bucket.key]);
    }
    keyMap[bucket.key].lines.push(line);
  }

  const todayKey = dayKey(new Date());
  let html = '';
  for (const group of groups.slice().reverse()) {
    const { primary, secondary } = group.label;
    const isToday   = group.bucket.type === 'day' && dayKey(group.bucket.date) === todayKey;
    const collapsed  = isToday ? '' : ' collapsed';
    html += `<div class="log-day-header${collapsed}">
      <span class="log-day-chevron">▼</span>
      <span class="log-day-primary">${escapeHtml(primary)}</span>
      <span class="log-day-secondary">${escapeHtml(secondary)}</span>
      <span class="log-day-badge">${group.lines.length}</span>
    </div>
    <div class="log-group-body${collapsed}">
      ${group.lines.slice().reverse().map(l => `<div class="log-line">${escapeHtml(l)}</div>`).join('')}
    </div>`;
  }
  container.innerHTML = html;

  container.querySelectorAll('.log-day-header').forEach(header => {
    header.addEventListener('click', () => {
      const body = header.nextElementSibling;
      const collapsed = body.classList.toggle('collapsed');
      header.classList.toggle('collapsed', collapsed);
    });
  });
}

async function loadLog(name, containerId, countId) {
  const container = document.getElementById(containerId);
  const counter   = document.getElementById(countId);
  try {
    const res = await fetch(`/api/logs/${name}`);
    const { lines } = await res.json();
    if (name === 'access') {
      renderAccessLog(lines, container, counter);
    } else {
      const box = document.getElementById('flaggedBox');
      if (!lines.length) {
        box.hidden = true;
        document.getElementById('accessBox').style.flexGrow = '';
        return;
      }
      box.hidden = false;
      document.getElementById('accessBox').style.flexGrow = '8';
      box.style.flexGrow = '1';
      counter.textContent = `${lines.length} line${lines.length !== 1 ? 's' : ''}`;
      container.innerHTML = lines.slice().reverse()
        .map(l => `<div class="log-line">${escapeHtml(l)}</div>`)
        .join('');
    }
  } catch (_) {
    container.innerHTML = '<span class="log-empty">Failed to load.</span>';
  }
}

function loadAll() {
  loadLog('access',  'accessLog',  'accessCount');
  loadLog('flagged', 'flaggedLog', 'flaggedCount');
}

document.getElementById('refreshBtn').addEventListener('click', loadAll);
loadAll();
