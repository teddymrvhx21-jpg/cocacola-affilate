const TelegramBot = require('node-telegram-bot-api');
const stats = require('./stats');

const LIVE_COOLDOWN_MS = 1500;

function startBot({ token, adminIds }) {
  if (!token) {
    console.warn('[bot] TELEGRAM_BOT_TOKEN is not set — bot disabled');
    return null;
  }

  const bot = new TelegramBot(token, { polling: true });
  const admins = new Set((adminIds || []).map(String));
  const openAccess = admins.size === 0;
  if (openAccess) {
    console.warn('[bot] no TELEGRAM_ADMIN_IDS set — bot responds to everyone (lab mode)');
  }

  let liveChatId = null;
  let lastLiveAt = 0;

  const isAllowed = (msg) => openAccess || admins.has(String(msg.chat.id));
  const guard = (msg) => {
    if (!isAllowed(msg)) {
      bot.sendMessage(msg.chat.id, '⛔ Access denied.');
      return false;
    }
    return true;
  };

  const esc = (s) =>
    String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const fmtDuration = (ms) => {
    const s = Math.floor(ms / 1000);
    const d = Math.floor(s / 86400);
    const h = Math.floor((s % 86400) / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    const parts = [];
    if (d) parts.push(`${d}d`);
    if (h) parts.push(`${h}h`);
    if (m) parts.push(`${m}m`);
    parts.push(`${sec}s`);
    return parts.join(' ');
  };

  const fmtTime = (iso) => iso.replace('T', ' ').replace(/\..+/, 'Z');

  // ---- Commands ----

  bot.onText(/^\/(start|help)\b/, (msg) => {
    if (!guard(msg)) return;
    const text =
      '🛠 <b>SEBUA Lab Bot</b>\n\n' +
      '<b>Stats</b>\n' +
      '/stats — общая сводка\n' +
      '/unique — количество уникальных IP\n' +
      '/ips [N] — топ-N IP по хитам (по умолч. 10)\n' +
      '/ip &lt;addr&gt; — детали по одному IP\n' +
      '/pages — разбивка по страницам\n' +
      '/agents — разбивка по категориям UA\n' +
      '/recent [N] — последние N попаданий (по умолч. 10)\n' +
      '/uptime — сколько работает сервер\n\n' +
      '<b>Live</b>\n' +
      '/live on — присылать каждое попадание в этот чат\n' +
      '/live off — выключить live\n\n' +
      '<b>Admin</b>\n' +
      '/export — выгрузить stats.json\n' +
      '/reset — сбросить статистику\n' +
      '/reset confirm — подтвердить сброс';
    bot.sendMessage(msg.chat.id, text, { parse_mode: 'HTML' });
  });

  bot.onText(/^\/stats\b/, (msg) => {
    if (!guard(msg)) return;
    const s = stats.getStats();
    const uniq = stats.uniqueIpCount();
    const topPages = Object.entries(s.pageViews)
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `  • ${esc(k)}: <b>${v}</b>`)
      .join('\n') || '  —';
    const topAgents = Object.entries(s.uaBreakdown)
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `  • ${esc(k)}: <b>${v}</b>`)
      .join('\n') || '  —';
    const text =
      `📊 <b>Общая статистика</b>\n` +
      `Uptime: <b>${fmtDuration(stats.uptimeMs())}</b>\n` +
      `Started: <code>${esc(fmtTime(s.startedAt))}</code>\n\n` +
      `Всего запросов: <b>${s.totalRequests}</b>\n` +
      `Уникальных IP: <b>${uniq}</b>\n\n` +
      `<b>Страницы:</b>\n${topPages}\n\n` +
      `<b>Категории UA:</b>\n${topAgents}`;
    bot.sendMessage(msg.chat.id, text, { parse_mode: 'HTML' });
  });

  bot.onText(/^\/unique\b/, (msg) => {
    if (!guard(msg)) return;
    const uniq = stats.uniqueIpCount();
    const s = stats.getStats();
    const total = s.totalRequests;
    const avg = uniq ? (total / uniq).toFixed(2) : '0';
    bot.sendMessage(
      msg.chat.id,
      `🌐 Уникальных IP: <b>${uniq}</b>\nСреднее хитов на IP: <b>${avg}</b>`,
      { parse_mode: 'HTML' }
    );
  });

  bot.onText(/^\/ips(?:\s+(\d+))?/, (msg, match) => {
    if (!guard(msg)) return;
    const n = Math.min(parseInt(match[1] || '10', 10) || 10, 50);
    const s = stats.getStats();
    const list = Object.entries(s.ips)
      .sort((a, b) => b[1].hits - a[1].hits)
      .slice(0, n);
    if (!list.length) {
      bot.sendMessage(msg.chat.id, 'Пока пусто.');
      return;
    }
    const lines = list.map(([ip, e], i) =>
      `${i + 1}. <code>${esc(ip)}</code> — <b>${e.hits}</b> hit(s), last: <code>${esc(fmtTime(e.lastSeen))}</code>`
    );
    bot.sendMessage(msg.chat.id, `🔝 <b>Top ${n} IP</b>\n${lines.join('\n')}`, { parse_mode: 'HTML' });
  });

  bot.onText(/^\/ip\s+(.+)/, (msg, match) => {
    if (!guard(msg)) return;
    const ip = match[1].trim();
    const s = stats.getStats();
    const e = s.ips[ip];
    if (!e) {
      bot.sendMessage(msg.chat.id, `IP <code>${esc(ip)}</code> не найден.`, { parse_mode: 'HTML' });
      return;
    }
    const agents = Object.entries(e.agents)
      .map(([k, v]) => `  • ${esc(k)}: <b>${v}</b>`)
      .join('\n');
    const text =
      `📍 <code>${esc(ip)}</code>\n` +
      `Hits: <b>${e.hits}</b>\n` +
      `First seen: <code>${esc(fmtTime(e.firstSeen))}</code>\n` +
      `Last seen: <code>${esc(fmtTime(e.lastSeen))}</code>\n` +
      `Last page: <code>${esc(e.lastPage)}</code>\n\n` +
      `<b>Agents:</b>\n${agents}\n\n` +
      `<b>Last UA:</b>\n<code>${esc(e.lastUA)}</code>`;
    bot.sendMessage(msg.chat.id, text, { parse_mode: 'HTML' });
  });

  bot.onText(/^\/pages\b/, (msg) => {
    if (!guard(msg)) return;
    const s = stats.getStats();
    const list = Object.entries(s.pageViews).sort((a, b) => b[1] - a[1]);
    const body = list.length
      ? list.map(([k, v]) => `  • ${esc(k)}: <b>${v}</b>`).join('\n')
      : '  —';
    bot.sendMessage(msg.chat.id, `📄 <b>Страницы</b>\n${body}`, { parse_mode: 'HTML' });
  });

  bot.onText(/^\/agents\b/, (msg) => {
    if (!guard(msg)) return;
    const s = stats.getStats();
    const list = Object.entries(s.uaBreakdown).sort((a, b) => b[1] - a[1]);
    const body = list.length
      ? list.map(([k, v]) => `  • ${esc(k)}: <b>${v}</b>`).join('\n')
      : '  —';
    bot.sendMessage(msg.chat.id, `🧭 <b>Категории UA</b>\n${body}`, { parse_mode: 'HTML' });
  });

  bot.onText(/^\/recent(?:\s+(\d+))?/, (msg, match) => {
    if (!guard(msg)) return;
    const n = Math.min(parseInt(match[1] || '10', 10) || 10, 50);
    const s = stats.getStats();
    const list = s.recent.slice(0, n);
    if (!list.length) {
      bot.sendMessage(msg.chat.id, 'Пока пусто.');
      return;
    }
    const body = list
      .map((h) => `<code>${esc(fmtTime(h.time))}</code> <code>${esc(h.ip)}</code> → ${esc(h.page)} [${esc(h.category)}]`)
      .join('\n');
    bot.sendMessage(msg.chat.id, `🕒 <b>Last ${n}</b>\n${body}`, { parse_mode: 'HTML' });
  });

  bot.onText(/^\/uptime\b/, (msg) => {
    if (!guard(msg)) return;
    const s = stats.getStats();
    bot.sendMessage(
      msg.chat.id,
      `⏱ Uptime: <b>${fmtDuration(stats.uptimeMs())}</b>\nStarted: <code>${esc(fmtTime(s.startedAt))}</code>`,
      { parse_mode: 'HTML' }
    );
  });

  bot.onText(/^\/live\s+(on|off)\b/, (msg, match) => {
    if (!guard(msg)) return;
    const mode = match[1];
    if (mode === 'on') {
      liveChatId = msg.chat.id;
      bot.sendMessage(msg.chat.id, '🔴 Live mode <b>ON</b> — пишу каждое попадание.', { parse_mode: 'HTML' });
    } else {
      liveChatId = null;
      bot.sendMessage(msg.chat.id, '⚫️ Live mode <b>OFF</b>.', { parse_mode: 'HTML' });
    }
  });

  bot.onText(/^\/export\b/, (msg) => {
    if (!guard(msg)) return;
    stats.save();
    bot.sendDocument(msg.chat.id, require('path').join(__dirname, 'stats.json'))
      .catch((e) => bot.sendMessage(msg.chat.id, `Export failed: ${esc(e.message)}`, { parse_mode: 'HTML' }));
  });

  bot.onText(/^\/reset(?:\s+(confirm))?/, (msg, match) => {
    if (!guard(msg)) return;
    if (match[1] !== 'confirm') {
      bot.sendMessage(
        msg.chat.id,
        '⚠️ Это сотрёт всю статистику.\nПодтверди: <code>/reset confirm</code>',
        { parse_mode: 'HTML' }
      );
      return;
    }
    stats.reset();
    bot.sendMessage(msg.chat.id, '✅ Статистика сброшена.');
  });

  // ---- Live notifications ----

  stats.emitter.on('hit', (hit) => {
    if (!liveChatId) return;
    const now = Date.now();
    if (now - lastLiveAt < LIVE_COOLDOWN_MS) return;
    lastLiveAt = now;
    const text =
      `🔔 <b>Hit</b>\n` +
      `<code>${esc(hit.time)}</code>\n` +
      `IP: <code>${esc(hit.ip)}</code>\n` +
      `Page: <b>${esc(hit.page)}</b>  [${esc(hit.category)}]\n` +
      `UA: <code>${esc(hit.ua)}</code>`;
    bot.sendMessage(liveChatId, text, { parse_mode: 'HTML' }).catch(() => {});
  });

  bot.on('polling_error', (err) => {
    console.error('[bot] polling error:', err.message);
  });

  console.log('[bot] started');
  return bot;
}

module.exports = { startBot };
