/* OLB Donation Leaderboard — Nostr zap tracking */
(function(){
'use strict';

const DREAD_PUBKEY = '107c975920979626f0db08e6c03d4e2cd7678f3d6543db55b6204e3aa1db4725';
const LN_ADDRESS   = 'jabs@flashapp.me';
const BTC_ADDRESS  = 'bc1qammuqhlk7qx4rke0cjj8hu4uctwp765cts2mz3';
const NOSTR_LINK   = 'https://njump.me/npub1zp7fwkfqj7tzduxmprnvq02w9ntk0reav4pak4dkyp8r4gwmgujseg3nnf';
const GOAL_NEW     = 1000000;   // sats
const GOAL_RETURN  = 5000000;  // sats for already-visited
const RELAYS = [
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://relay.nostr.band',
  'wss://relay.primal.net',
];

let COUNTRIES = [];
const zapTotals = {};   // name → sats
const seenIds   = new Set();
let activeTab   = 'all';
let searchQuery = '';
let currentCountry = null;
let relayCount  = 0;

// ── flag emoji from ISO-2 code ────────────────────────
function flag(iso2) {
  if (!iso2 || iso2.length !== 2) return '🌍';
  return [...iso2.toUpperCase()].map(c =>
    String.fromCodePoint(0x1F1E6 + c.charCodeAt(0) - 65)
  ).join('');
}

// ── format sats ───────────────────────────────────────
function fmtSats(n) {
  if (n >= 1e6) return (n/1e6).toFixed(2).replace(/\.?0+$/,'') + 'M';
  if (n >= 1e3) return (n/1e3).toFixed(1).replace(/\.?0+$/,'') + 'K';
  return n.toString();
}

// ── extract country from zap message ─────────────────
function extractCountry(msg) {
  if (!msg) return null;
  const lower = msg.toLowerCase();
  for (const c of COUNTRIES) {
    if (lower.includes(c.n.toLowerCase())) return c.n;
  }
  return null;
}

// ── handle a kind-9735 event ─────────────────────────
function handleZap(ev) {
  if (seenIds.has(ev.id)) return;
  seenIds.add(ev.id);

  const amtTag = ev.tags.find(t => t[0] === 'amount');
  const msats  = parseInt(amtTag?.[1] || '0', 10);
  if (!msats) return;

  const descTag = ev.tags.find(t => t[0] === 'description');
  let country = null;
  if (descTag?.[1]) {
    try {
      const req = JSON.parse(descTag[1]);
      country = extractCountry(req.content || '');
    } catch (_) {}
  }
  if (!country) return;

  zapTotals[country] = (zapTotals[country] || 0) + Math.round(msats / 1000);
  renderLeaderboard();
}

// ── connect to relays ─────────────────────────────────
function connectRelays() {
  const statusEl = document.getElementById('zap-status');
  relayCount = 0;

  RELAYS.forEach(url => {
    try {
      const ws = new WebSocket(url);
      const sub = ['REQ','olb-zaps-1',{kinds:[9735],'#p':[DREAD_PUBKEY],limit:500}];

      ws.onopen = () => {
        relayCount++;
        if (statusEl) {
          statusEl.textContent = `⚡ ${relayCount}/${RELAYS.length} relays connected`;
          if (relayCount === RELAYS.length) {
            statusEl.textContent = '✓ Live — zaps tracked in real-time';
            statusEl.classList.add('ok');
          }
        }
        ws.send(JSON.stringify(sub));
      };

      ws.onmessage = e => {
        try {
          const msg = JSON.parse(e.data);
          if (msg[0] === 'EVENT' && msg[2]?.kind === 9735) handleZap(msg[2]);
        } catch (_) {}
      };

      ws.onerror = () => {};
      ws.onclose = () => {
        relayCount = Math.max(0, relayCount - 1);
        setTimeout(() => connectRelay(url), 10000);
      };
    } catch (_) {}
  });
}

function connectRelay(url) {
  try {
    const ws = new WebSocket(url);
    ws.onopen = () => ws.send(JSON.stringify(
      ['REQ','olb-zaps-1',{kinds:[9735],'#p':[DREAD_PUBKEY],limit:500}]
    ));
    ws.onmessage = e => {
      try {
        const msg = JSON.parse(e.data);
        if (msg[0] === 'EVENT' && msg[2]?.kind === 9735) handleZap(msg[2]);
      } catch (_) {}
    };
    ws.onerror = () => {};
  } catch (_) {}
}

// ── render leaderboard ────────────────────────────────
function renderLeaderboard() {
  const list = document.getElementById('leaderboard');
  if (!list) return;

  let countries = COUNTRIES.slice();

  // filter by tab
  if (activeTab === 'new')    countries = countries.filter(c => !c.v);
  if (activeTab === 'return') countries = countries.filter(c => c.v);

  // filter by search
  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    countries = countries.filter(c => c.n.toLowerCase().includes(q));
  }

  // sort: most sats first, then alphabetical
  countries.sort((a, b) => {
    const sa = zapTotals[a.n] || 0;
    const sb = zapTotals[b.n] || 0;
    if (sb !== sa) return sb - sa;
    return a.n.localeCompare(b.n);
  });

  if (countries.length === 0) {
    list.innerHTML = '<div class="lb-none">No countries match your search.</div>';
    return;
  }

  list.innerHTML = countries.map((c, i) => {
    const sats = zapTotals[c.n] || 0;
    const goal = c.v ? GOAL_RETURN : GOAL_NEW;
    const pct  = Math.min(100, (sats / goal) * 100).toFixed(1);
    const rank = i + 1;
    return `<div class="lb-row" onclick="window.openDonate('${c.n.replace(/'/g,"\\'")}')">
      <span class="lb-rank">${rank}</span>
      <span class="lb-flag">${flag(c.c)}</span>
      <div class="lb-info">
        <span class="lb-name">${c.n}</span>
        ${c.v ? '<span class="lb-visited-badge">RETURN VISIT</span>' : ''}
        <div class="lb-progress-wrap"><div class="lb-progress-bar" style="width:${pct}%"></div></div>
      </div>
      <span class="lb-amount${sats > 0 ? ' has-sats' : ''}">${sats > 0 ? fmtSats(sats)+' sats' : '—'}</span>
      <button class="lb-donate-btn" onclick="event.stopPropagation();window.openDonate('${c.n.replace(/'/g,"\\'")}')">⚡ Donate</button>
    </div>`;
  }).join('');
}

// ── open donate modal ─────────────────────────────────
window.openDonate = function(name) {
  const c = COUNTRIES.find(x => x.n === name);
  if (!c) return;
  currentCountry = c;

  const sats = zapTotals[name] || 0;
  const goal = c.v ? GOAL_RETURN : GOAL_NEW;
  const pct  = Math.min(100, (sats / goal) * 100).toFixed(1);
  const label = c.v ? '5,000,000 SAT GOAL — RETURN VISIT' : '1,000,000 SAT GOAL — NEW INTERVIEW';

  document.getElementById('dmodal-flag').textContent = flag(c.c);
  document.getElementById('dmodal-name').textContent = name;
  document.getElementById('dmodal-type').textContent = label;
  document.getElementById('dmodal-progress-bar').style.width = pct + '%';
  document.getElementById('dmodal-progress-label').textContent =
    `${fmtSats(sats)} / ${fmtSats(goal)} sats raised (${pct}%)`;
  document.getElementById('dmodal-country-note').textContent = name;

  // QR codes — encode Lightning address with country comment hint
  renderQR('dmodal-ln-qr',  'lightning:' + LN_ADDRESS);
  renderQR('dmodal-btc-qr', 'bitcoin:'   + BTC_ADDRESS);

  document.getElementById('donate-modal').classList.add('open');
  document.body.style.overflow = 'hidden';
};

window.closeDonate = function() {
  document.getElementById('donate-modal').classList.remove('open');
  document.body.style.overflow = '';
};

function renderQR(imgId, value) {
  const el = document.getElementById(imgId);
  if (!el) return;
  const encoded = encodeURIComponent(value);
  el.src = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&margin=10&bgcolor=ffffff&color=000000&data=${encoded}`;
  el.style.borderRadius = '8px';
}

window.copyLN  = function() { navigator.clipboard.writeText(LN_ADDRESS); };
window.copyBTC = function() { navigator.clipboard.writeText(BTC_ADDRESS); };

// ── tab / search controls ─────────────────────────────
window.setTab = function(tab) {
  activeTab = tab;
  document.querySelectorAll('.lb-tab').forEach(el =>
    el.classList.toggle('active', el.dataset.tab === tab)
  );
  renderLeaderboard();
};

window.filterLeaderboard = function() {
  searchQuery = document.getElementById('country-search').value.trim();
  renderLeaderboard();
};

// ── init ──────────────────────────────────────────────
async function init() {
  try {
    const res = await fetch('countries.json');
    COUNTRIES = await res.json();
    renderLeaderboard();
    connectRelays();
  } catch (e) {
    console.error('OLB donate init failed:', e);
  }
}

document.addEventListener('DOMContentLoaded', init);
})();
