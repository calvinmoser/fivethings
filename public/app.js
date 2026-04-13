/* ============================================================
   Five Things — app.js
   ============================================================ */

// ---- Config ----
const CONFIG = {
  defaultCount: 5,
  defaultDifficulty: 'Easy',
  maxDropdown: 20,
  subPhrase: 'Replace [item1] with [item2]',
  curtainOpenDuration: 5000,   // ms
  version: '0.0.1-beta'
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
const THEMES = ['default', 'rainbow'];

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

function startCurtain() {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    curtainContainer.classList.add('open-done');
    return;
  }
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

// Freeze curtain panels at their current rendered position
let curtainStopped = false;
function stopCurtain() {
  if (curtainStopped) return;
  curtainStopped = true;
  const leftPanel = document.getElementById('curtainLeft');
  const rightPanel = document.getElementById('curtainRight');
  // Snapshot the current computed matrix so panels freeze mid-accordion
  leftPanel.style.transform = getComputedStyle(leftPanel).transform;
  rightPanel.style.transform = getComputedStyle(rightPanel).transform;
  curtainContainer.classList.remove('animate-open');
  curtainContainer.classList.add('open-done');
}

document.addEventListener('pointerdown', stopCurtain, { once: true });
document.addEventListener('keydown', stopCurtain, { once: true });

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
function subText(item1, item2) {
  return CONFIG.subPhrase
    .replace('[item1]', item1)
    .replace('[item2]', item2);
}

function renderActivity(actObj, difficulty) {
  const card = document.createElement('div');
  card.className = 'activity-card';
  card.dataset.lineNumber = actObj.lineNumber;

  // Refresh button
  const refreshBtn = document.createElement('button');
  refreshBtn.className = 'btn-refresh';
  refreshBtn.setAttribute('aria-label', `Refresh activity: ${actObj.name}`);
  refreshBtn.title = 'Get a different activity';
  refreshBtn.textContent = '↻';
  refreshBtn.addEventListener('click', () => refreshActivity(card, difficulty));
  card.appendChild(refreshBtn);

  // Activity name
  const nameDiv = document.createElement('div');
  nameDiv.className = 'activity-name';
  nameDiv.textContent = actObj.name;
  card.appendChild(nameDiv);

  // Flag for activity name
  card.appendChild(makeFlagBtn(difficulty, actObj, 'name', actObj.name));

  // S1
  const s1Div = document.createElement('div');
  s1Div.className = 'sub-text';
  s1Div.textContent = subText(actObj.s1item1, actObj.s1item2);
  card.appendChild(s1Div);
  card.appendChild(makeFlagBtn(difficulty, actObj, 's1', actObj.s1item1, actObj.s1item2));

  // S2
  const s2Div = document.createElement('div');
  s2Div.className = 'sub-text';
  s2Div.textContent = subText(actObj.s2item1, actObj.s2item2);
  card.appendChild(s2Div);
  card.appendChild(makeFlagBtn(difficulty, actObj, 's2', actObj.s2item1, actObj.s2item2));

  return card;
}

function makeFlagBtn(difficulty, actObj, rowType, item1, item2) {
  const btn = document.createElement('button');
  btn.className = 'btn-flag-row';
  btn.setAttribute('aria-label', `Flag for review: ${item1}${item2 ? ' → ' + item2 : ''}`);
  btn.title = 'Flag this for review';
  btn.textContent = '⚑';
  btn.addEventListener('click', () => openFlagModal(difficulty, actObj, rowType, item1, item2));
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

function openFlagModal(difficulty, actObj, rowType, item1, item2) {
  const target = rowType === 'name'
    ? `activity "${actObj.name}"`
    : `substitution "${item1}" → "${item2}" on "${actObj.name}"`;

  modalMsg.textContent = `Flag ${target} for review?`;
  pendingFlag = { difficulty, lineNumber: actObj.lineNumber, activityName: actObj.name, item1, item2: item2 || null, rowType };
  modal.hidden = false;
  flagConfirmBtn.focus();
}

function closeFlagModal() {
  modal.hidden = true;
  pendingFlag = null;
}

flagConfirmBtn.addEventListener('click', async () => {
  if (!pendingFlag) return;
  const { difficulty, lineNumber, activityName, item1, item2, rowType } = pendingFlag;
  closeFlagModal();
  try {
    await fetch('/api/flag', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        difficulty,
        lineNumber,
        activityName,
        item1: rowType !== 'name' ? item1 : undefined,
        item2: rowType !== 'name' ? item2 : undefined
      })
    });
  } catch (_) {
    // best-effort
  }
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

// ---- Boot ----
window.addEventListener('DOMContentLoaded', async () => {
  startCurtain();
  await loadActivities();
});