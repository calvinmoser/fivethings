const express = require('express');
const fs = require('fs');
const path = require('path');
const pkg = require("./package.json");

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '../data');
const TIME_FORMAT = {
  timeZone: 'America/New_York',
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit'
};

if (process.env.NODE_ENV === 'development') {
  console.log("development")
  const livereload = require("livereload");
  const connectLiveReload = require("connect-livereload");

  // Create a server and watch your public folder
  const liveReloadServer = livereload.createServer();
  liveReloadServer.watch(path.join(__dirname, 'public'));

  // Use the middleware (put this before your routes)
  app.use(connectLiveReload());

  // Signal a refresh when the server restarts (optional but helpful)
  liveReloadServer.server.once("connection", () => {
    setTimeout(() => { liveReloadServer.refresh("/"); }, 100);
  });
}

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/activities/:difficulty', (req, res, next) => {
  const logPath = path.join(DATA_DIR, 'access.log');
  const timestamp = new Date().toLocaleString([], TIME_FORMAT);
  const ip = req.headers['x-forwarded-for'] + ' ' + req.socket.remoteAddress;
  const message = `${timestamp} - ${req.method} ${req.url} - IP: ${ip}`;
    console.log(message);
    fs.appendFile(logPath, message + '\n', (err) => {
      if (err) console.log("Error writing to " + logPath);
    });
  if (!req.headers['x-forward-for']) logHeaders(req.headers);
    next(); // Pass control to the next handler
});

function logHeaders(headers) {
  const logPath = path.join(DATA_DIR, 'debug.log');
  const timestamp = new Date().toLocaleString([], TIME_FORMAT);
  const message = `${timestamp} ${JSON.stringify(headers, null, 2)}`;
  fs.appendFile(logPath, message + '\n', (err) => {
    if (err) console.log("Error writing to " + logPath);
  });
}

function parseActivitiesCSV(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');
  const activities = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const cols = parseCSVLine(line);
    if (cols.length < 3) continue;
    activities.push({
      lineNumber: i + 1,
      name: cols[0].trim(),
      easy1: (cols[3] || '').trim(),
      easy2: (cols[4] || '').trim(),
      med1:  (cols[5] || '').trim(),
      med2:  (cols[6] || '').trim(),
      hard1: (cols[7] || '').trim(),
      hard2: (cols[8] || '').trim()
    });
  }
  return activities;
}

const LOCATION_PCT = 20;

let replacementsCache = null;
let locationsCache = null;

function loadDiffCSV(filePath, valueCol, diffCol) {
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');
  const byDiff = { EASY: [], MEDIUM: [], HARD: [] };
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const cols = parseCSVLine(line);
    if (cols.length <= Math.max(valueCol, diffCol)) continue;
    const value = cols[valueCol].trim();
    const diff = cols[diffCol].trim().toUpperCase();
    if (byDiff[diff]) byDiff[diff].push({ value, line: i + 1 });
  }
  return byDiff;
}

function loadReplacements() {
  if (!replacementsCache)
    replacementsCache = loadDiffCSV(path.join(DATA_DIR, 'replacements.csv'), 0, 1);
  return replacementsCache;
}

function loadLocations() {
  if (!locationsCache)
    locationsCache = loadDiffCSV(path.join(DATA_DIR, 'locations.csv'), 0, 1);
  return locationsCache;
}

// Returns ordered list of non-empty item values, preferred difficulty first
function orderedItems(activity, difficulty) {
  const order = {
    Easy:   ['easy1','easy2','med1','med2','hard1','hard2'],
    Medium: ['med1','med2','easy1','easy2','hard1','hard2'],
    Hard:   ['hard1','hard2','med1','med2','easy1','easy2']
  };
  return (order[difficulty] || order.Easy)
    .map(k => activity[k])
    .filter(v => v && v.length > 0);
}

function pickRandomEntry(pool, usedValues) {
  const available = pool.filter(e => !usedValues.has(e.value));
  const src = available.length > 0 ? available : pool;
  return src[Math.floor(Math.random() * src.length)];
}

function buildActivityPool(rawActivities, difficulty) {
  const key = difficulty.toUpperCase();
  const repPool = loadReplacements()[key] || loadReplacements().EASY;
  const locPool = loadLocations()[key] || loadLocations().EASY;

  const locationCount = Math.min(
    Math.round(rawActivities.length * LOCATION_PCT / 100),
    locPool.length
  );

  // Sample unique locations up front
  const shuffledLocs = [...locPool].sort(() => Math.random() - 0.5).slice(0, locationCount);

  // Randomly pick which activities get a location
  const shuffledIdx = rawActivities.map((_, i) => i).sort(() => Math.random() - 0.5);
  const locSet = new Set(shuffledIdx.slice(0, locationCount));

  let locIdx = 0;
  return rawActivities.map((activity, idx) => {
    const items = orderedItems(activity, difficulty);
    const item1 = items[0] || 'item';
    const item2 = items[1] || items[0] || 'item';
    const usedReps = new Set();

    if (locSet.has(idx)) {
      const locEntry = shuffledLocs[locIdx++];
      const locSlot = Math.random() < 0.5 ? 's1' : 's2';
      const repEntry = pickRandomEntry(repPool, usedReps);
      const locSub  = { type: 'location', value: locEntry.value, line: locEntry.line };
      const itemSub = { type: 'item', item: locSlot === 's1' ? item2 : item1,
                        replacement: repEntry.value, replacementLine: repEntry.line };
      return {
        lineNumber: activity.lineNumber, name: activity.name,
        s1: locSlot === 's1' ? locSub : itemSub,
        s2: locSlot === 's1' ? itemSub : locSub
      };
    }

    const rep1 = pickRandomEntry(repPool, usedReps);
    usedReps.add(rep1.value);
    const rep2 = pickRandomEntry(repPool, usedReps);
    return {
      lineNumber: activity.lineNumber, name: activity.name,
      s1: { type: 'item', item: item1, replacement: rep1.value, replacementLine: rep1.line },
      s2: { type: 'item', item: item2, replacement: rep2.value, replacementLine: rep2.line }
    };
  });
}

function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

app.get('/api/activities/:difficulty', (req, res) => {
  const { difficulty } = req.params;
  const allowed = ['Easy', 'Medium', 'Hard'];
  if (!allowed.includes(difficulty)) {
    return res.status(400).json({ error: 'Invalid difficulty' });
  }
  const filePath = path.join(DATA_DIR, `${difficulty.toLowerCase()}.csv`);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: `${difficulty}.csv not found` });
  }
  try {
    const raw = parseActivitiesCSV(filePath);
    const activities = buildActivityPool(raw, difficulty);
    res.json(activities);
  } catch (err) {
    res.status(500).json({ error: 'Failed to read activities file' });
  }
});

app.post('/api/flag', (req, res) => {
  const { type, difficulty, activityLine, activityName } = req.body;
  if (!type || !difficulty || !activityLine || !activityName) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  const ts = new Date().toISOString();
  let logLine;
  if (type === 'name') {
    logLine = `[${ts}] difficulty=${difficulty} activity[${activityLine}]="${activityName}" flagged=name\n`;
  } else if (type === 'item') {
    const { item, replacementLine, replacement } = req.body;
    logLine = `[${ts}] difficulty=${difficulty} activity[${activityLine}]="${activityName}" item="${item}" replacement[${replacementLine}]="${replacement}"\n`;
  } else if (type === 'location') {
    const { locationLine, location } = req.body;
    logLine = `[${ts}] difficulty=${difficulty} activity[${activityLine}]="${activityName}" location[${locationLine}]="${location}"\n`;
  } else {
    return res.status(400).json({ error: 'Invalid flag type' });
  }
  const logPath = path.join(DATA_DIR, 'flagged.log');
  try {
    fs.appendFileSync(logPath, logLine, 'utf8');
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to write log' });
  }
});

app.get('/health', (req, res) => res.json({ ok: true }));

app.get('/api/version', (req, res) => {
  res.json({"version": pkg.version})
});


app.listen(PORT, () => {
  console.log(`Five Things running on port ${PORT}`);
  console.log(`Data directory: ${DATA_DIR}`);
});