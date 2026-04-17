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
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  const message = `${timestamp} - ${req.method} ${req.url} - IP: ${ip}`;
    console.log(message);
    fs.appendFile(logPath, message + '\n', (err) => {
      if (err) console.log("Error writing to " + logPath);
    });
    next(); // Pass control to the next handler
});

// Parse CSV rows, tracking line numbers (1-based, skipping header)
function parseCSV(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');
  const activities = [];
  // skip header (index 0)
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    // Handle quoted fields
    const cols = parseCSVLine(line);
    if (cols.length < 5) continue;
    activities.push({
      lineNumber: i + 1, // 1-based including header
      name: cols[0].trim(),
      s1item1: cols[1].trim(),
      s1item2: cols[2].trim(),
      s2item1: cols[3].trim(),
      s2item2: cols[4].trim()
    });
  }
  return activities;
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
  const filePath = path.join(DATA_DIR, `${difficulty}.csv`);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: `${difficulty}.csv not found` });
  }
  try {
    const activities = parseCSV(filePath);
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