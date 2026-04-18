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

let replacementsCache = null;

function loadReplacements() {
  if (replacementsCache) return replacementsCache;
  const filePath = path.join(DATA_DIR, 'replacements.csv');
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');
  const byDiff = { EASY: [], MEDIUM: [], HARD: [] };
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const cols = parseCSVLine(line);
    if (cols.length < 2) continue;
    const rep = cols[0].trim();
    const diff = cols[1].trim().toUpperCase();
    if (byDiff[diff]) byDiff[diff].push(rep);
  }
  replacementsCache = byDiff;
  return replacementsCache;
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

function pickRandom(arr, exclude) {
  const pool = arr.filter(v => !exclude.has(v));
  const src = pool.length > 0 ? pool : arr;
  return src[Math.floor(Math.random() * src.length)];
}

function attachSubstitutions(activity, difficulty) {
  const repKey = difficulty.toUpperCase();
  const replacements = loadReplacements();
  const repPool = replacements[repKey] || replacements.EASY;

  const items = orderedItems(activity, difficulty);
  const item1 = items[0] || 'item';
  const item2 = items[1] || items[0] || 'item';

  const usedReps = new Set();
  const rep1 = pickRandom(repPool, usedReps);
  usedReps.add(rep1);
  const rep2 = pickRandom(repPool, usedReps);

  return {
    lineNumber: activity.lineNumber,
    name: activity.name,
    s1item1: item1,
    s1item2: rep1,
    s2item1: item2,
    s2item2: rep2
  };
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
    const activities = raw.map(a => attachSubstitutions(a, difficulty));
    res.json(activities);
  } catch (err) {
    res.status(500).json({ error: 'Failed to read activities file' });
  }
});

app.post('/api/flag', (req, res) => {
  const { difficulty, lineNumber, activityName, item1, item2 } = req.body;
  if (!difficulty || !lineNumber || !activityName) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  const timestamp = new Date().toISOString();
  const substitution = (item1 && item2) ? `, substitution=${item1}, ${item2}` : '';
  const logLine = `[${timestamp}] difficulty=${difficulty} line=${lineNumber} activity=${activityName}${substitution}\n`;
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