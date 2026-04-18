/* ============================================================
   Five Things — app.js
   ============================================================ */

// ---- Config ----
const CONFIG = {
  defaultCount: 5,
  defaultDifficulty: 'Easy',
  maxDropdown: 20,
  subPhrase: 'Replace [item1] with [item2]',
  locationPhrase: 'Location: [location]',
  curtainOpenDuration: 5000,   // ms
  version: 'v0.0.0-beta'
};

// ---- State ----
// session history: Map<difficulty, Set<lineNumber>>
let sessionHistory = (() => {
  try {
    const raw = sessionStorage.getItem('fivethings_history');
    if (raw) {
      const parsed = JSON.parse(raw);
      const map = new Map();
      for (const [k, v] of Object.entries(parsed)) {
        map.set(k, new Set(v));
      }
      return map;
    }
  } catch (_) {}
  return new Map();
})();

function saveHistory() {
  const obj = {};
  for (const [k, v] of sessionHistory.entries()) {
    obj[k] = Array.from(v);
  }
  sessionStorage.setItem('fivethings_history', JSON.stringify(obj));
}

function markUsed(difficulty, lineNumber) {
  if (!sessionHistory.has(difficulty)) sessionHistory.set(difficulty, new Set());
  sessionHistory.get(difficulty).add(lineNumber);
  saveHistory();
}

function isUsed(difficulty, lineNumber) {
  return sessionHistory.has(difficulty) && sessionHistory.get(difficulty).has(lineNumber);
}

// Currently displayed line numbers
let displayedLines = new Set();
// Full pool for current difficulty
let activityPool = [];
let currentDifficulty = CONFIG.defaultDifficulty;

// ---- DOM refs ----
const numSelect = document.getElementById('numSuggestions');
const diffSelect = document.getElementById('difficulty');
const themeSelect = document.getElementById('themeSelect');
const getBtn = document.getElementById('getActivities');
const area = document.getElementById('activitiesArea');
const modal = document.getElementById('flagModal');
const modalMsg = document.getElementById('flagModalMessage');
const flagConfirmBtn = document.getElementById('flagConfirm');
const flagCancelBtn = document.getElementById('flagCancel');
const footerYear = document.getElementById('footerYear');
const version = document.getElementById('version');

// ---- Init ----
footerYear.textContent = new Date().getFullYear();

// Populate number dropdown
for (let i = 1; i <= CONFIG.maxDropdown; i++) {
  const opt = document.createElement('option');
  opt.value = i;
  opt.textContent = i;
  if (i === CONFIG.defaultCount) opt.selected = true;
  numSelect.appendChild(opt);
}

// Set default difficulty
diffSelect.value = CONFIG.defaultDifficulty;

// ---- Theme ----
const THEMES = ['default', 'rainbow', 'spotlight', 'greasepaint', 'neon', 'sockbuskin'];

function applyTheme(theme) {
  document.body.classList.remove(...THEMES.map(t => `theme-${t}`));
  document.body.classList.add(`theme-${theme}`);
  localStorage.setItem('fivethings_theme', theme);
  themeSelect.value = theme;
}

// Restore saved theme or default
applyTheme(localStorage.getItem('fivethings_theme') || 'default');

themeSelect.addEventListener('change', () => applyTheme(themeSelect.value));

// ---- Curtain animation ----
const curtainContainer = document.getElementById('curtainContainer');

function calcCurtainTargetScale() {
  const contentCol = document.querySelector('.content-col');
  if (!contentCol) return 0.04;
  const rect = contentCol.getBoundingClientRect();
  const panelWidth = window.innerWidth / 2;
  if (panelWidth === 0) return 0.04;
  return Math.max(0, Math.min(1, rect.left / panelWidth));
}

function startCurtain() {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    curtainContainer.classList.add('open-done');
    return;
  }
  curtainContainer.style.setProperty('--curtain-target-scale', calcCurtainTargetScale());
  curtainContainer.classList.add('animate-open');
  curtainContainer.addEventListener('animationend', () => {
    const leftPanel = document.getElementById('curtainLeft');
    const rightPanel = document.getElementById('curtainRight');
    leftPanel.style.transform = getComputedStyle(leftPanel).transform;
    rightPanel.style.transform = getComputedStyle(rightPanel).transform;
    curtainContainer.classList.remove('animate-open');
    curtainContainer.classList.add('open-done');
    curtainStopped = true;
  }, { once: true });
}

let curtainStopped = false;

// ---- Fetch pool ----
async function fetchPool(difficulty) {
  const res = await fetch(`/api/activities/${difficulty}`);
  if (!res.ok) throw new Error(`Failed to load ${difficulty} activities`);
  return res.json();
}

// ---- Random selection (not used this session, not currently displayed) ----
function pickRandom(pool, difficulty, count, excludeLines) {
  const available = pool.filter(a =>
    !isUsed(difficulty, a.lineNumber) &&
    !excludeLines.has(a.lineNumber)
  );
  const shuffled = available.sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count);
}

// ---- Render ----
function escapeHtml(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function subText(item1, item2) {
  return CONFIG.subPhrase
    .replace('[item1]', `<span class="item-name">${escapeHtml(item1)}</span>`)
    .replace('[item2]', `<span class="item-name">${escapeHtml(item2)}</span>`);
}

function renderActivity(actObj, difficulty) {
  const card = document.createElement('div');
  card.className = 'activity-card';
  card.dataset.lineNumber = actObj.lineNumber;

  const header = document.createElement('div');
  header.className = 'activity-header';

  const nameDiv = document.createElement('div');
  nameDiv.className = 'activity-name';
  nameDiv.textContent = actObj.name;
  const refreshBtn = document.createElement('button');
  refreshBtn.className = 'btn-refresh';
  refreshBtn.setAttribute('aria-label', `Refresh activity: ${actObj.name}`);
  refreshBtn.title = 'Get a different activity';
  refreshBtn.textContent = '↻';
  refreshBtn.addEventListener('click', () => refreshActivity(card, difficulty));
  header.appendChild(refreshBtn);
  header.appendChild(nameDiv);
  card.appendChild(header);

  card.appendChild(makeFlagBtn(difficulty, actObj, 'name'));

  [actObj.s1, actObj.s2].forEach(sub => {
    const div = document.createElement('div');
    div.className = 'sub-text';
    if (sub.type === 'location') {
      div.innerHTML = CONFIG.locationPhrase.replace('[location]',
        `<span class="item-name">${escapeHtml(sub.value)}</span>`);
    } else {
      div.innerHTML = subText(sub.item, sub.replacement);
    }
    card.appendChild(div);
    card.appendChild(makeFlagBtn(difficulty, actObj, sub));
  });

  return card;
}

function makeFlagBtn(difficulty, actObj, sub) {
  const btn = document.createElement('button');
  btn.className = 'btn-flag-row';
  const label = sub === 'name' ? actObj.name
    : sub.type === 'location' ? `location: ${sub.value}`
    : `${sub.item} → ${sub.replacement}`;
  btn.setAttribute('aria-label', `Flag for review: ${label}`);
  btn.title = 'Flag this for review';
  btn.textContent = '⚑';
  btn.addEventListener('click', () => openFlagModal(difficulty, actObj, sub));
  return btn;
}

function displayActivities(activities, difficulty) {
  area.innerHTML = '';
  displayedLines = new Set();
  activities.forEach(a => {
    displayedLines.add(a.lineNumber);
    markUsed(difficulty, a.lineNumber);
    area.appendChild(renderActivity(a, difficulty));
  });
}

// ---- Refresh single activity ----
async function refreshActivity(card, difficulty) {
  const oldLine = parseInt(card.dataset.lineNumber, 10);
  const pool = activityPool;

  // Build current display set excluding this card
  const otherDisplayed = new Set(displayedLines);
  otherDisplayed.delete(oldLine);

  const candidates = pool.filter(a =>
    !isUsed(difficulty, a.lineNumber) &&
    !otherDisplayed.has(a.lineNumber)
  );

  if (candidates.length === 0) {
    card.style.opacity = '0.5';
    card.title = 'No more unused activities available';
    return;
  }

  const replacement = candidates[Math.floor(Math.random() * candidates.length)];
  displayedLines.delete(oldLine);
  displayedLines.add(replacement.lineNumber);
  markUsed(difficulty, replacement.lineNumber);

  const newCard = renderActivity(replacement, difficulty);
  newCard.style.opacity = '0';
  card.replaceWith(newCard);
  requestAnimationFrame(() => {
    newCard.style.transition = 'opacity 0.25s';
    newCard.style.opacity = '1';
  });
}

// ---- Load activities ----
async function loadActivities() {
  const count = parseInt(numSelect.value, 10);
  const difficulty = diffSelect.value;

  area.innerHTML = '<p class="state-message">Loading…</p>';

  try {
    if (currentDifficulty !== difficulty || activityPool.length === 0) {
      activityPool = await fetchPool(difficulty);
      currentDifficulty = difficulty;
    }

    const picked = pickRandom(activityPool, difficulty, count, new Set());

    if (picked.length === 0) {
      area.innerHTML = '<p class="state-message">No more unused activities for this difficulty in this session.</p>';
      return;
    }

    displayActivities(picked, difficulty);
  } catch (err) {
    area.innerHTML = `<p class="state-message">Error: ${err.message}</p>`;
  }
}

// ---- Flag modal ----
let pendingFlag = null;

function openFlagModal(difficulty, actObj, sub) {
  const target = sub === 'name'
    ? `activity "${actObj.name}"`
    : sub.type === 'location'
      ? `location "${sub.value}" on "${actObj.name}"`
      : `substitution "${sub.item}" → "${sub.replacement}" on "${actObj.name}"`;

  modalMsg.textContent = `Flag ${target} for review?`;
  pendingFlag = { difficulty, actObj, sub };
  modal.hidden = false;
  flagConfirmBtn.focus();
}

function closeFlagModal() {
  modal.hidden = true;
  pendingFlag = null;
}

flagConfirmBtn.addEventListener('click', async () => {
  if (!pendingFlag) return;
  const { difficulty, actObj, sub } = pendingFlag;
  closeFlagModal();
  let body;
  if (sub === 'name') {
    body = { type: 'name', difficulty, activityLine: actObj.lineNumber, activityName: actObj.name };
  } else if (sub.type === 'location') {
    body = { type: 'location', difficulty, activityLine: actObj.lineNumber, activityName: actObj.name,
             locationLine: sub.line, location: sub.value };
  } else {
    body = { type: 'item', difficulty, activityLine: actObj.lineNumber, activityName: actObj.name,
             item: sub.item, replacementLine: sub.replacementLine, replacement: sub.replacement };
  }
  try {
    await fetch('/api/flag', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
  } catch (_) {}
});

flagCancelBtn.addEventListener('click', closeFlagModal);

// Close on backdrop click
modal.querySelector('.modal-backdrop').addEventListener('click', closeFlagModal);

// Close on Escape
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && !modal.hidden) closeFlagModal();
});

// ---- Event listeners ----
getBtn.addEventListener('click', loadActivities);

getBtn.addEventListener('keydown', e => {
  if (e.key === 'Enter' || e.key === ' ') loadActivities();
});

async function fetchVersion() {
  const res = await fetch(`/api/version`);
  if (!res.ok) throw new Error(`Failed to load version`);
  const data = await res.json();
  return CONFIG.version.replace('0.0.0', data.version);
}

// ---- Boot ----
window.addEventListener('DOMContentLoaded', async () => {
  startCurtain();
  await loadActivities();
  version.textContent = await fetchVersion();
});