const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');

const DATA_FILE = path.join(__dirname, 'stats.json');
const MAX_RECENT = 300;
const SAVE_INTERVAL_MS = 30_000;

const emitter = new EventEmitter();

const defaultStats = () => ({
  startedAt: new Date().toISOString(),
  totalRequests: 0,
  pageViews: {},        // { 'chrome.html': 5, 'firefox.html': 3, ... }
  uaBreakdown: {},      // { chrome: 5, firefox: 3, edge: 2, unsupported: 1 }
  ips: {},              // { '1.2.3.4': { hits, firstSeen, lastSeen, agents, lastUA, lastPage } }
  recent: []            // последние N попаданий
});

let stats = defaultStats();

function load() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
      stats = { ...defaultStats(), ...parsed };
    }
  } catch (e) {
    console.error('[stats] load failed:', e.message);
  }
}

function save() {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(stats, null, 2));
  } catch (e) {
    console.error('[stats] save failed:', e.message);
  }
}

function getClientIp(req) {
  const xff = req.headers['x-forwarded-for'];
  if (xff) return String(xff).split(',')[0].trim();
  return req.socket?.remoteAddress || req.ip || 'unknown';
}

function categorizeUA(uaRaw) {
  const ua = String(uaRaw || '').toLowerCase();
  if (!ua.includes('windows')) return 'unsupported';
  const isEdge = ua.includes('edg/') || ua.includes('edge/');
  const isOpera = ua.includes('opr/') || ua.includes('opera');
  const isChrome = !isEdge && !isOpera && ua.includes('chrome') && ua.includes('safari');
  const isFirefox = ua.includes('firefox');
  if (isEdge) return 'edge';
  if (isChrome) return 'chrome';
  if (isFirefox) return 'firefox';
  return 'unsupported';
}

function record(req, page) {
  const ip = getClientIp(req);
  const ua = req.headers['user-agent'] || '';
  const category = categorizeUA(ua);
  const now = new Date().toISOString();

  stats.totalRequests++;
  stats.pageViews[page] = (stats.pageViews[page] || 0) + 1;
  stats.uaBreakdown[category] = (stats.uaBreakdown[category] || 0) + 1;

  if (!stats.ips[ip]) {
    stats.ips[ip] = {
      hits: 0,
      firstSeen: now,
      lastSeen: now,
      agents: {},
      lastUA: ua,
      lastPage: page
    };
  }
  const entry = stats.ips[ip];
  entry.hits++;
  entry.lastSeen = now;
  entry.lastPage = page;
  entry.lastUA = ua;
  entry.agents[category] = (entry.agents[category] || 0) + 1;

  const hit = { time: now, ip, page, category, ua };
  stats.recent.unshift(hit);
  if (stats.recent.length > MAX_RECENT) stats.recent.length = MAX_RECENT;

  emitter.emit('hit', hit);
}

function getStats() {
  return stats;
}

function reset() {
  stats = defaultStats();
  save();
  return stats;
}

function uniqueIpCount() {
  return Object.keys(stats.ips).length;
}

function uptimeMs() {
  return Date.now() - new Date(stats.startedAt).getTime();
}

load();
setInterval(save, SAVE_INTERVAL_MS);

process.on('SIGINT', () => { save(); process.exit(0); });
process.on('SIGTERM', () => { save(); process.exit(0); });

module.exports = {
  record,
  getStats,
  reset,
  uniqueIpCount,
  uptimeMs,
  getClientIp,
  categorizeUA,
  save,
  emitter
};
