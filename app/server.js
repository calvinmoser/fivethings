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
      name:    cols[0].trim(),
      with:    (cols[1] || '').trim().toLowerCase() === 'true',
      against: (cols[2] || '').trim().toLowerCase() === 'true',
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
const PERSON_PCT   = 20;

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

let personsCache = null;

function loadPersons() {
  if (!personsCache)
    personsCache = loadDiffCSV(path.join(DATA_DIR, 'persons.csv'), 0, 1);
  return personsCache;
}

// Returns ordered list of non-empty item values, preferred difficulty first
function orderedItems(activity, difficulty) {
  const order = {
    Easy:   ['easy1','easy2','med1','med2','hard1','hard2'],
    Medium: ['med1','med2','easy1','easy2','hard1','hard2'],
    Hard:   ['hard1','hard2','med1','med2','easy1','easy2']
  };
  const cols = difficulty === 'Random'
    ? ['easy1','easy2','med1','med2','hard1','hard2'].sort(() => Math.random() - 0.5)
    : (order[difficulty] || order.Easy);
  return cols.map(k => activity[k]).filter(v => v && v.length > 0);
}

function pickRandomEntry(pool, usedValues, label) {
  if (pool.length === 0) {
    console.log(`[Five Things] ${label || 'Pool'} is empty`);
    return { value: '?', line: 0 };
  }
  const available = pool.filter(e => !usedValues.has(e.value));
  if (available.length === 0) {
    console.log(`[Five Things] ${label || 'Pool'} exhausted — resetting and reusing`);
  }
  const src = available.length > 0 ? available : pool;
  return src[Math.floor(Math.random() * src.length)];
}

function personVariant(activity) {
  if (activity.with && activity.against) return Math.random() < 0.5 ? 'with' : 'against';
  if (activity.with) return 'with';
  return 'against';
}

function buildActivityPool(rawActivities, difficulty) {
  const key = difficulty.toUpperCase();
  const reps = loadReplacements();
  const locs = loadLocations();
  const pers = loadPersons();
  const repPool = reps[key]?.length ? reps[key] : (console.log(`[Five Things] Replacements empty for ${key}, falling back to EASY`), reps.EASY);
  const locPool = locs[key]?.length ? locs[key] : (console.log(`[Five Things] Locations empty for ${key}, falling back to EASY`),  locs.EASY);
  const perPool = pers[key]?.length ? pers[key] : (console.log(`[Five Things] Persons empty for ${key}, falling back to EASY`),    pers.EASY);

  const count = rawActivities.length;
  const locTarget = Math.round(count * LOCATION_PCT / 100);
  const locationCount = Math.min(locTarget, locPool.length);
  if (locationCount < locTarget) console.log(`[Five Things] Locations exhausted for ${difficulty} (need ${locTarget}, have ${locPool.length}) — using all available`);

  // Shuffle all indices; first slice gets locations
  const shuffled = rawActivities.map((_, i) => i).sort(() => Math.random() - 0.5);
  const locSet   = new Set(shuffled.slice(0, locationCount));

  // From the remainder, pick person-eligible activities
  const personEligible = shuffled
    .slice(locationCount)
    .filter(i => rawActivities[i].with || rawActivities[i].against);
  const perTarget = Math.round(count * PERSON_PCT / 100);
  const personCount = Math.min(perTarget, personEligible.length, perPool.length);
  if (personCount < perTarget) console.log(`[Five Things] Persons exhausted for ${difficulty} (need ${perTarget}, have ${Math.min(personEligible.length, perPool.length)}) — using all available`);
  const perSet = new Set(personEligible.slice(0, personCount));

  // Pre-sample unique locations and persons
  const sampledLocs = [...locPool].sort(() => Math.random() - 0.5).slice(0, locationCount);
  const sampledPers = [...perPool].sort(() => Math.random() - 0.5).slice(0, personCount);

  let locIdx = 0, perIdx = 0;

  return rawActivities.map((activity, idx) => {
    const items = orderedItems(activity, difficulty);
    const item1 = items[0] || 'item';
    const item2 = items[1] || items[0] || 'item';
    const usedReps = new Set();

    function modPair(modSub) {
      const repEntry = pickRandomEntry(repPool, usedReps);
      const modFirst = Math.random() < 0.5;
      const itemSub = { type: 'item', item: modFirst ? item2 : item1,
                        replacement: repEntry.value, replacementLine: repEntry.line };
      return { s1: modFirst ? modSub : itemSub, s2: modFirst ? itemSub : modSub };
    }

    if (locSet.has(idx)) {
      const e = sampledLocs[locIdx++];
      const { s1, s2 } = modPair({ type: 'location', value: e.value, line: e.line });
      return { lineNumber: activity.lineNumber, name: activity.name, s1, s2 };
    }

    if (perSet.has(idx)) {
      const e = sampledPers[perIdx++];
      const { s1, s2 } = modPair({ type: 'person', value: e.value, line: e.line, variant: personVariant(activity) });
      return { lineNumber: activity.lineNumber, name: activity.name, s1, s2 };
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

const RANDOM_OFFSETS = { Easy: 0, Medium: 10000, Hard: 20000 };

function buildRandomPool() {
  const diffs = ['Easy', 'Medium', 'Hard'];
  const repAll = Object.values(loadReplacements()).flat();
  const locAll = Object.values(loadLocations()).flat();
  const perAll = Object.values(loadPersons()).flat();

  const combined = diffs.flatMap(diff => {
    const filePath = path.join(DATA_DIR, `${diff.toLowerCase()}.csv`);
    if (!fs.existsSync(filePath)) return [];
    return parseActivitiesCSV(filePath).map(a => ({
      ...a,
      lineNumber: a.lineNumber + RANDOM_OFFSETS[diff],
      sourceDifficulty: diff
    }));
  });

  const count = combined.length;
  const locRandTarget = Math.round(count * LOCATION_PCT / 100);
  const locationCount = Math.min(locRandTarget, locAll.length);
  if (locationCount < locRandTarget) console.log(`[Five Things] Locations exhausted for Random (need ${locRandTarget}, have ${locAll.length}) — using all available`);
  const shuffled = combined.map((_, i) => i).sort(() => Math.random() - 0.5);
  const locSet   = new Set(shuffled.slice(0, locationCount));
  const personEligible = shuffled.slice(locationCount).filter(i => combined[i].with || combined[i].against);
  const perRandTarget = Math.round(count * PERSON_PCT / 100);
  const personCount = Math.min(perRandTarget, personEligible.length, perAll.length);
  if (personCount < perRandTarget) console.log(`[Five Things] Persons exhausted for Random (need ${perRandTarget}, have ${Math.min(personEligible.length, perAll.length)}) — using all available`);
  const perSet = new Set(personEligible.slice(0, personCount));

  const sampledLocs = [...locAll].sort(() => Math.random() - 0.5).slice(0, locationCount);
  const sampledPers = [...perAll].sort(() => Math.random() - 0.5).slice(0, personCount);

  let locIdx = 0, perIdx = 0;

  return combined.map((activity, idx) => {
    const items = orderedItems(activity, 'Random');
    const item1 = items[0] || 'item';
    const item2 = items[1] || items[0] || 'item';
    const usedReps = new Set();

    function modPair(modSub) {
      const repEntry = pickRandomEntry(repAll, usedReps);
      const modFirst = Math.random() < 0.5;
      const itemSub = { type: 'item', item: modFirst ? item2 : item1,
                        replacement: repEntry.value, replacementLine: repEntry.line };
      return { s1: modFirst ? modSub : itemSub, s2: modFirst ? itemSub : modSub };
    }

    const base = { lineNumber: activity.lineNumber, name: activity.name, sourceDifficulty: activity.sourceDifficulty };

    if (locSet.has(idx)) {
      const e = sampledLocs[locIdx++];
      const { s1, s2 } = modPair({ type: 'location', value: e.value, line: e.line });
      return { ...base, s1, s2 };
    }
    if (perSet.has(idx)) {
      const e = sampledPers[perIdx++];
      const { s1, s2 } = modPair({ type: 'person', value: e.value, line: e.line, variant: personVariant(activity) });
      return { ...base, s1, s2 };
    }
    const rep1 = pickRandomEntry(repAll, usedReps);
    usedReps.add(rep1.value);
    const rep2 = pickRandomEntry(repAll, usedReps);
    return {
      ...base,
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
  const allowed = ['Easy', 'Medium', 'Hard', 'Random'];
  if (!allowed.includes(difficulty)) {
    return res.status(400).json({ error: 'Invalid difficulty' });
  }
  try {
    if (difficulty === 'Random') {
      return res.json(buildRandomPool());
    }
    const filePath = path.join(DATA_DIR, `${difficulty.toLowerCase()}.csv`);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: `${difficulty}.csv not found` });
    }
    const raw = parseActivitiesCSV(filePath);
    res.json(buildActivityPool(raw, difficulty));
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
  } else if (type === 'person') {
    const { personLine, person } = req.body;
    logLine = `[${ts}] difficulty=${difficulty} activity[${activityLine}]="${activityName}" person[${personLine}]="${person}"\n`;
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