// ── Data store ──────────────────────────────────────────────
const MAX_POINTS = 1200;
const LS_HISTORY = 'caes_history';

const history = {
  labels: [],
  c1:     [],
  c2:     [],
  p:      [],
  times:  []
};

// Carrega histórico salvo
(function loadHistory() {
  try {
    const saved = JSON.parse(localStorage.getItem(LS_HISTORY));
    if (saved && saved.labels) {
      history.labels = saved.labels.slice(-MAX_POINTS);
      history.c1     = saved.c1.slice(-MAX_POINTS);
      history.c2     = saved.c2.slice(-MAX_POINTS);
      history.p      = saved.p.slice(-MAX_POINTS);
      history.times  = Array.isArray(saved.times)
        ? saved.times.slice(-MAX_POINTS)
        : history.labels.map(label => label.length === 5 ? `--:${label}` : label);
    }
  } catch(_) {}
})();

// ── Chart setup ─────────────────────────────────────────────
const canvas = document.getElementById('chart');
const ctx = canvas.getContext('2d');
let chartPointLayout = null;
let hoverHistoryIndex = null;
let animFrame;
let chartYScrollMax = 0;
let energiaYScrollMax = 0;

function updateYAxisScrollbar(element, offset, maxOffset, visibleRange, totalRange) {
  if (!element) return;
  element.hidden = maxOffset <= 0;
  element.setAttribute('aria-valuemax', String(Math.round(maxOffset)));
  element.setAttribute('aria-valuenow', String(Math.round(offset)));
  if (maxOffset <= 0) return;

  const trackHeight = element.clientHeight;
  const thumb = element.querySelector('.chart-y-scrollbar-thumb');
  const thumbHeight = trackHeight
    ? Math.min(trackHeight, Math.max(18, trackHeight * visibleRange / Math.max(totalRange, visibleRange)))
    : 18;
  const travel = Math.max(0, trackHeight - thumbHeight);
  const top = maxOffset > 0 ? (1 - offset / maxOffset) * travel : 0;
  thumb.style.height = `${thumbHeight}px`;
  thumb.style.top = `${top}px`;
}

function resizeCanvas() {
  const w = canvas.offsetWidth;
  const h = canvas.offsetHeight;
  if (w > 0 && h > 0 && (canvas.width !== w || canvas.height !== h)) {
    canvas.width  = w;
    canvas.height = h;
  }
}
window.addEventListener('resize', drawChart);

const COLORS = {
  total:   '#12FF80',
  rede:    '#00CFFF',
  gerador: '#FFB800',
  energia: '#FF3C00'
};

// ── Scroll state ─────────────────────────────────────────────
const LS_XAXIS = 'syscore_xaxis';
const LS_SCROLL_FIX = 'caes_scroll_fix';
const LS_INFO_FIX = 'caes_info_fix';
const LS_LINK_CHARTS = 'caes_link_charts';
function loadTogglePreference(key, defaultValue) {
  try {
    const saved = localStorage.getItem(key);
    return saved === null ? defaultValue : saved === 'true';
  } catch (_) {
    return defaultValue;
  }
}
let X_AXIS       = Math.max(0, parseInt(localStorage.getItem(LS_XAXIS) || '0', 10));
let scrollOffset  = 0;   // X scroll — pontos atrás no histórico
let yScrollOffset = 0;   // Y scroll — deslocamento para cima do viewport
let scrollFixEnabled = loadTogglePreference(LS_SCROLL_FIX, true);
let infoFixEnabled = loadTogglePreference(LS_INFO_FIX, false);
let chartLinkEnabled = loadTogglePreference(LS_LINK_CHARTS, true);

// Retorna a fatia do histórico atual conforme X_AXIS e scroll
function getView() {
  const total = history.labels.length;
  // X_AXIS = 0 → exibe tudo
  if (X_AXIS === 0 || total <= X_AXIS) {
    scrollOffset = 0;
    return { start: 0, end: total };
  }
  const end   = Math.max(X_AXIS, total - scrollOffset);
  const start = end - X_AXIS;
  return { start: Math.max(0, start), end };
}

function parseAxisValue(val) {
  const text = String(val).trim();
  if (!/^\d+$/.test(text)) return 0;
  const value = Number(text);
  return Number.isSafeInteger(value) && value > 0 ? value : 0;
}

function commitAxisInput(axis, input) {
  const value = parseAxisValue(input.value);
  input.value = value > 0 ? String(value) : '';
  if (axis === 'x') onXAxisChange(value);
  else if (axis === 'y') onYMaxChange(value);
  else if (axis === 'energia-x') onEAxisChange('x', value);
  else if (axis === 'energia-y') onEAxisChange('y', value);
}

function onXAxisChange(val) {
  const n = parseAxisValue(val);
  X_AXIS = n;
  scrollOffset = 0; // volta ao vivo ao mudar a janela
  if (chartLinkEnabled) eScrollOffset = 0;
  try { localStorage.setItem(LS_XAXIS, n); } catch(_) {}
  if (chartLinkEnabled) syncLinkedChartAxes();
  drawChart();
}

function drawChart() {
  resizeCanvas();
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);

  chartPointLayout = null;
  if (history.labels.length < 2 || W === 0 || H === 0) {
    chartYScrollMax = 0;
    updateYAxisScrollbar(document.getElementById('chart-y-scrollbar'), 0, 0, 1, 1);
    syncHoveredChartPoint();
    return;
  }

  const mobileLayout = window.matchMedia('(max-width: 767px)').matches;
  const pad = { top: 20, right: 20, bottom: 36, left: mobileLayout ? 58 : 64 };
  const plotW = W - pad.left - pad.right;
  const plotH = H - pad.top  - pad.bottom;

  // Fatia visível conforme scroll
  const { start, end } = getView();
  const slice = (arr) => arr.slice(start, end);

  const sliceC1 = slice(history.c1);
  const sliceC2 = slice(history.c2);
  const sliceLb = slice(history.labels);

  const dispTotal   = sliceC1.map((v, i) => v * MULT_POTENCIA_REDE + sliceC2[i] * MULT_POTENCIA_GERADOR);
  const dispRede    = sliceC1.map(v => v * MULT_POTENCIA_REDE);
  const dispGerador = sliceC2.map(v => v * MULT_POTENCIA_GERADOR);
  // Y máximo base: fixo (Y_MAX > 0) ou automático (maior valor da janela)
  const allVals   = [...dispTotal, ...dispRede, ...dispGerador];
  const dataMax   = Math.max(...allVals, 1);
  const yMaxBase  = Y_MAX > 0 ? Y_MAX : dataMax;
  const yRange    = yMaxBase; // span visível no eixo Y = altura fixa

  // yScrollOffset: quanto subimos acima do zero.
  // Limite superior: o ponto mais alto dos dados (ou Y_MAX se fixo)
  const absoluteMax = Math.max(dataMax, yMaxBase);
  const maxYScroll  = Math.max(0, absoluteMax - yMaxBase);
  yScrollOffset     = Math.max(0, Math.min(maxYScroll, yScrollOffset));
  chartYScrollMax = maxYScroll;
  updateYAxisScrollbar(document.getElementById('chart-y-scrollbar'), yScrollOffset, maxYScroll, yRange, yRange + maxYScroll);

  const minVal = yScrollOffset;
  const maxVal = yScrollOffset + yRange;
  const range  = yRange || 1;

  // Indicador de scroll (quando não estamos ao vivo e há limite)
  if (scrollOffset > 0 && X_AXIS > 0) {
    ctx.save();
    ctx.fillStyle = 'rgba(255,184,0,0.025)';
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
    ctx.save();
    ctx.font = '10px "Share Tech Mono"';
    ctx.fillStyle = '#FFB800';
    ctx.textAlign = 'left';
    ctx.fillText(`◀ ${scrollOffset} pontos atrás`, pad.left + 4, pad.top - 4);
    ctx.restore();
  }

  // Grid
  ctx.strokeStyle = getThemeColor('--chart-grid', 'rgba(42,48,64,0.8)');
  ctx.lineWidth = 1;
  const gridLines = 5;
  for (let i = 0; i <= gridLines; i++) {
    const y = pad.top + plotH - (i / gridLines) * plotH;
    ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(pad.left + plotW, y); ctx.stroke();
    const label = `${(minVal + (i / gridLines) * range).toFixed(1)}W`;
    ctx.fillStyle = getThemeColor('--chart-label', '#9AA5B8');
    ctx.font = `${mobileLayout ? 10 : 11}px "Share Tech Mono"`;
    const labelX = pad.left - (mobileLayout ? 4 : 8);
    if (ctx.measureText(label).width > labelX - 2) {
      ctx.textAlign = 'left';
      ctx.fillText(label, 2, y + 4);
    } else {
      ctx.textAlign = 'right';
      ctx.fillText(label, labelX, y + 4);
    }
  }

  // X labels
  const n = sliceLb.length;
  if (n < 2) {
    syncHoveredChartPoint();
    return;
  }
  chartPointLayout = { start, count: n, left: pad.left, top: pad.top, width: plotW, height: plotH };
  const maxTicks = Math.max(2, Math.floor(plotW / (mobileLayout ? 64 : 58)));
  const tickCount = Math.min(n, maxTicks);
  const visibleLabels = new Set();
  ctx.fillStyle = getThemeColor('--chart-label', '#9AA5B8');
  ctx.textAlign = 'center';
  ctx.font = '11px "Share Tech Mono"';
  for (let tick = 0; tick < tickCount; tick++) {
    const i = Math.round(tick * (n - 1) / (tickCount - 1));
    const label = sliceLb[i];
    if (visibleLabels.has(label)) continue;
    visibleLabels.add(label);
    const x = pad.left + (i / (n - 1)) * plotW;
    ctx.fillText(label, x, H - 8);
  }

  // Séries
  const series = [
    { key: 'total',   data: dispTotal   },
    { key: 'rede',    data: dispRede    },
    { key: 'gerador', data: dispGerador }
  ];

  series.forEach(({ key, data }) => {
    const color = COLORS[key];
    const n = data.length;
    if (n < 2) return;

    const clamped = Y_MAX > 0 ? data.map(v => Math.min(v, maxVal)) : data;

    ctx.save();
    ctx.beginPath();
    clamped.forEach((v, i) => {
      const x = pad.left + (i / (n - 1)) * plotW;
      const y = pad.top + plotH - ((v - minVal) / range) * plotH;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.lineTo(pad.left + plotW, pad.top + plotH);
    ctx.lineTo(pad.left, pad.top + plotH);
    ctx.closePath();
    ctx.fillStyle = hexToRgba(color, 0.06);
    ctx.fill();
    ctx.restore();

    strokeCappedSeries(ctx, data, Y_MAX > 0, maxVal,
      i => pad.left + (i / (n - 1)) * plotW,
      v => pad.top + plotH - ((v - minVal) / range) * plotH,
      color, 2, 8);

    // Ponto final (só se estiver ao vivo)
    if (scrollOffset === 0) {
      const lv = clamped[n - 1];
      const lx = pad.left + plotW;
      const ly = pad.top + plotH - ((lv - minVal) / range) * plotH;
      ctx.save();
      ctx.shadowColor = color; ctx.shadowBlur = 16;
      ctx.fillStyle = color;
      ctx.beginPath(); ctx.arc(lx, ly, 4, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
  });
  syncHoveredChartPoint();
}

function hexToRgba(hex, alpha) {
  const r = parseInt(hex.slice(1,3),16);
  const g = parseInt(hex.slice(3,5),16);
  const b = parseInt(hex.slice(5,7),16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function getThemeColor(variable, fallback) {
  return getComputedStyle(document.documentElement).getPropertyValue(variable).trim() || fallback;
}

function strokeCappedSeries(context, values, hasLimit, maxValue, xAt, yAt, color, lineWidth, shadowBlur) {
  context.save();
  context.shadowColor = color;
  context.shadowBlur = shadowBlur;
  context.strokeStyle = color;
  context.lineWidth = lineWidth;
  context.lineJoin = 'round';
  context.lineCap = 'round';

  let currentStyle = null;
  let pathEnd = null;
  const flush = () => {
    if (currentStyle !== null) context.stroke();
  };
  const addSegment = (style, x1, y1, x2, y2) => {
    if (style !== currentStyle || !pathEnd || pathEnd.x !== x1 || pathEnd.y !== y1) {
      flush();
      context.beginPath();
      context.setLineDash(style === 'capped' ? [3, 4] : []);
      context.moveTo(x1, y1);
      currentStyle = style;
    }
    context.lineTo(x2, y2);
    pathEnd = { x: x2, y: y2 };
  };

  for (let i = 0; i < values.length - 1; i++) {
    const first = values[i];
    const second = values[i + 1];
    const x1 = xAt(i);
    const x2 = xAt(i + 1);

    if (!hasLimit || (first <= maxValue && second <= maxValue)) {
      addSegment('normal', x1, yAt(first), x2, yAt(second));
    } else if (first >= maxValue && second >= maxValue) {
      const capY = yAt(maxValue);
      addSegment('capped', x1, capY, x2, capY);
    } else {
      const crossing = (maxValue - first) / (second - first);
      const crossingX = x1 + (x2 - x1) * crossing;
      const capY = yAt(maxValue);
      if (first < maxValue) {
        addSegment('normal', x1, yAt(first), crossingX, capY);
        addSegment('capped', crossingX, capY, x2, capY);
      } else {
        addSegment('capped', x1, capY, crossingX, capY);
        addSegment('normal', crossingX, capY, x2, yAt(second));
      }
    }
  }
  flush();
  context.setLineDash([]);
  context.restore();
}

// ── UI helpers ───────────────────────────────────────────────
const elTotal   = document.getElementById('val-total');
const elRede    = document.getElementById('val-rede');
const elGerador = document.getElementById('val-gerador');
const elEnergia = document.getElementById('val-energia');
const elRaw1    = document.getElementById('raw-i1');
const elRaw2    = document.getElementById('raw-i2');
const elRawP    = document.getElementById('raw-p');
const elRelay   = document.getElementById('relay-state');
const elTs      = document.getElementById('timestamp');
const elNoData  = document.getElementById('no-data');
const btnConn   = document.getElementById('btn-connect');
const btnConnLabel = btnConn.querySelector('.connect-label');
const themeToggle = document.getElementById('theme-toggle');
const installButton = document.getElementById('install-app');
let pendingInstallPrompt = null;

if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./service-worker.js', { updateViaCache: 'none' }).catch(() => {});
  });
}

window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  pendingInstallPrompt = event;
  installButton.hidden = false;
});

installButton.addEventListener('click', async () => {
  if (!pendingInstallPrompt) return;
  pendingInstallPrompt.prompt();
  await pendingInstallPrompt.userChoice;
  pendingInstallPrompt = null;
  installButton.hidden = true;
});

window.addEventListener('appinstalled', () => {
  pendingInstallPrompt = null;
  installButton.hidden = true;
});

const helpToggle = document.getElementById('help-toggle');
const helpOverlay = document.getElementById('help-overlay');
const helpClose = document.getElementById('help-close');

function closeHelp() {
  helpOverlay.classList.remove('is-open');
  helpOverlay.setAttribute('aria-hidden', 'true');
  helpToggle.setAttribute('aria-label', 'Abrir índice de controles');
  helpToggle.title = 'Índice de controles';
  helpToggle.focus();
}

function toggleHelp() {
  const isOpen = helpOverlay.classList.contains('is-open');
  if (isOpen) {
    closeHelp();
    return;
  }
  helpOverlay.classList.add('is-open');
  helpOverlay.setAttribute('aria-hidden', 'false');
  helpToggle.setAttribute('aria-label', 'Fechar índice de controles');
  helpToggle.title = 'Fechar índice de controles';
  helpClose.focus();
}

helpToggle.addEventListener('click', () => {
  toggleHelp();
});
helpClose.addEventListener('click', closeHelp);
helpOverlay.addEventListener('click', (e) => {
  if (e.target === helpOverlay) closeHelp();
});
// Com o índice aberto, Tab não navega pelos campos da tela: o foco circula só entre o botão de fechar e o link.
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Tab' || !helpOverlay.classList.contains('is-open')) return;
  e.preventDefault();
  const focusables = Array.from(helpOverlay.querySelectorAll('button, a[href]'));
  const i = focusables.indexOf(document.activeElement);
  const next = e.shiftKey ? (i <= 0 ? focusables.length - 1 : i - 1) : (i + 1) % focusables.length;
  focusables[next].focus();
}, true);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    e.preventDefault();
    toggleHelp();
  }
  if (e.key === 'Enter' && e.target instanceof HTMLInputElement) {
    e.preventDefault();
    e.stopPropagation();
    e.target.blur();
  }
});

function updateThemeButton() {
  const nextTheme = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
  const label = nextTheme === 'light' ? 'Ativar modo claro' : 'Ativar modo escuro';
  themeToggle.setAttribute('aria-label', label);
  themeToggle.title = label;
}

themeToggle.addEventListener('click', () => {
  const nextTheme = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
  document.documentElement.dataset.theme = nextTheme;
  try { localStorage.setItem('caes_color_theme', nextTheme); } catch (_) {}
  updateThemeButton();
  drawChart();
});
updateThemeButton();

function setVal(el, val, decimals = 2) {
  const unit = el.querySelector('.metric-unit');
  const unitHTML = unit ? unit.outerHTML : '';
  if (unit) unit.remove();
  el.childNodes[0].nodeValue = val.toFixed(decimals);
  if (unit) el.appendChild(unit);
  el.classList.remove('flicker');
  void el.offsetWidth;
  el.classList.add('flicker');
}

function setBar(id, val, max) {
  const pct = Math.min(100, Math.max(0, (val / max) * 100));
  document.getElementById(id).style.width = pct + '%';
}

function pushHistory(label, c1, c2, p, time) {
  if (scrollFixEnabled && scrollOffset > 0) scrollOffset++;
  if (scrollFixEnabled && eScrollOffset > 0) eScrollOffset++;
  history.labels.push(label);
  history.c1.push(c1);
  history.c2.push(c2);
  history.p.push(p);
  history.times.push(time || label);
  if (history.labels.length > MAX_POINTS) {
    history.labels.shift();
    history.c1.shift();
    history.c2.shift();
    history.p.shift();
    history.times.shift();
    if (hoverHistoryIndex !== null) hoverHistoryIndex--;
  }
  scrollOffset = X_AXIS > 0
    ? Math.min(scrollOffset, Math.max(0, history.labels.length - X_AXIS))
    : 0;
  eScrollOffset = E_X_AXIS > 0
    ? Math.min(eScrollOffset, Math.max(0, history.labels.length - E_X_AXIS))
    : 0;
  // Persiste no localStorage
  try {
    localStorage.setItem(LS_HISTORY, JSON.stringify(history));
  } catch(_) {}
}

// ── Multiplicadores de cálculo ───────────────────────────────
const LS_MULT = 'syscore_mult';
const LS_YMAX = 'syscore_ymax';
const MULT_DEFAULTS = { rede: 220, gerador: 180, energia: 420 };

function _loadMult() {
  try {
    const saved = JSON.parse(localStorage.getItem(LS_MULT));
    // Preserva o multiplicador salvo antes da renomeação para Rede.
    if (saved) return { ...saved, rede: saved.rede ?? saved.usina ?? MULT_DEFAULTS.rede };
  } catch(_) {}
  return { ...MULT_DEFAULTS };
}

function _saveMult() {
  try {
    localStorage.setItem(LS_MULT, JSON.stringify({
      rede:    MULT_POTENCIA_REDE,
      gerador: MULT_POTENCIA_GERADOR,
      energia: MULT_ENERGIA_POTENCIAL,
    }));
  } catch(_) {}
}

// Y máximo (0 = automático, baseado na janela visível)
let Y_MAX = Math.max(0, parseInt(localStorage.getItem(LS_YMAX) || '0', 10) || 0);

const _initMult = _loadMult();
let MULT_POTENCIA_REDE     = _initMult.rede;
let MULT_POTENCIA_GERADOR  = _initMult.gerador;
let MULT_ENERGIA_POTENCIAL = _initMult.energia;

// Aplica os valores carregados nos inputs
document.getElementById('mult-rede').value    = MULT_POTENCIA_REDE;
document.getElementById('mult-gerador').value = MULT_POTENCIA_GERADOR;
document.getElementById('mult-energia').value = MULT_ENERGIA_POTENCIAL;
document.getElementById('ymax-input').value   = Y_MAX  > 0 ? Y_MAX  : '';
document.getElementById('xaxis-input').value  = X_AXIS > 0 ? X_AXIS : '';

function onMultChange(which, val) {
  const n = parseFloat(val);
  if (isNaN(n)) return;
  if (which === 'rede')    MULT_POTENCIA_REDE     = n;
  if (which === 'gerador') MULT_POTENCIA_GERADOR  = n;
  if (which === 'energia') MULT_ENERGIA_POTENCIAL = n;
  _saveMult();
  drawChart();
}

function resetMultipliers() {
  MULT_POTENCIA_REDE = MULT_DEFAULTS.rede;
  MULT_POTENCIA_GERADOR = MULT_DEFAULTS.gerador;
  MULT_ENERGIA_POTENCIAL = MULT_DEFAULTS.energia;
  document.getElementById('mult-rede').value = MULT_POTENCIA_REDE;
  document.getElementById('mult-gerador').value = MULT_POTENCIA_GERADOR;
  document.getElementById('mult-energia').value = MULT_ENERGIA_POTENCIAL;
  _saveMult();

  const lastIndex = history.labels.length - 1;
  if (lastIndex >= 0) {
    const rede = history.c1[lastIndex] * MULT_POTENCIA_REDE;
    const gerador = history.c2[lastIndex] * MULT_POTENCIA_GERADOR;
    setVal(elTotal, rede + gerador, 2);
    setVal(elRede, rede, 2);
    setVal(elGerador, gerador, 2);
    setVal(elEnergia, history.p[lastIndex] * MULT_ENERGIA_POTENCIAL, 1);
    setBar('bar-total', rede + gerador, 5000);
    setBar('bar-rede', rede, 4000);
    setBar('bar-gerador', gerador, 1000);
    setBar('bar-energia', history.p[lastIndex] * MULT_ENERGIA_POTENCIAL, 40000);
  }
  drawChart();
}

function processPacket(data) {
  const c1 = parseFloat(data.corrente1) || 0;
  const c2 = parseFloat(data.corrente2) || 0;
  const p  = parseFloat(data.pressao)   || 0;

  // Multiplicadores (aplicados APENAS para exibição no gráfico)
  const rede    = c1 * MULT_POTENCIA_REDE;
  const gerador = c2 * MULT_POTENCIA_GERADOR;
  const total   = rede + gerador;
  const energia = p  * MULT_ENERGIA_POTENCIAL;

  // Atualiza cards com valores calculados
  const fmt = (el, v, dec) => {
    const unit = el.querySelector('.metric-unit');
    el.firstChild.textContent = v.toFixed(dec);
    el.classList.remove('flicker');
    void el.offsetWidth; el.classList.add('flicker');
  };

  fmt(elTotal,   total,   2);
  fmt(elRede,    rede,    2);
  fmt(elGerador, gerador, 2);
  fmt(elEnergia, energia, 1);

  // Sensores brutos diretos
  elRaw1.textContent = c1.toFixed(2);
  elRaw2.textContent = c2.toFixed(2);
  elRawP.textContent = p.toFixed(1);

  setBar('bar-total',   total,   5000);
  setBar('bar-rede',    rede,    4000);
  setBar('bar-gerador', gerador, 1000);
  setBar('bar-energia', energia, 40000);

  const relOn = data.rele === true || data.rele === 'true';
  elRelay.textContent = relOn ? 'ON' : 'OFF';
  elRelay.className = 'relay-state ' + (relOn ? 'on' : 'off');

  const now = new Date();
  const ts = now.toTimeString().slice(0,8);
  elTs.textContent = ts;
  const elTsMobile = document.getElementById('timestamp-mobile');
  if (elTsMobile) elTsMobile.textContent = ts;

  // Salva os valores BRUTOS no histórico (sem multiplicadores)
  pushHistory(ts.slice(3), c1, c2, p, ts);
  updateNoData();
  drawChart();
}

// ── Serial (Web Serial API) ──────────────────────────────────
let port, reader, readLoop, serialPipe;
let connected = false;
let connecting = false;

async function clearSerialResources() {
  const activeReader = reader;
  const activePort = port;
  const activePipe = serialPipe;
  reader = null;
  port = null;
  readLoop = null;
  serialPipe = null;

  if (activeReader) {
    try { await activeReader.cancel(); } catch (_) {}
    try { activeReader.releaseLock(); } catch (_) {}
  }
  if (activePipe) {
    try { await activePipe; } catch (_) {}
  }
  if (activePort) {
    try { await activePort.close(); } catch (_) {}
  }
}

function updateNoData() {
  const show = history.labels.length === 0;
  elNoData.style.opacity       = show ? '1' : '0';
  elNoData.style.pointerEvents = show ? 'auto' : 'none';
}

function setConnected(state, msg) {
  connected = state;
  btnConnLabel.textContent = state ? 'DESCONECTAR' : msg === 'ERRO' ? 'ERRO' : 'CONECTAR';
  btnConn.className = state ? 'connected' : '';
  updateNoData();
}

async function connect() {
  if (connecting || connected) return;
  if (!('serial' in navigator)) {
    alert('Web Serial API não suportada neste browser.\nUse o Google Chrome ou Microsoft Edge (versão recente).');
    return;
  }
  connecting = true;
  try {
    port = await navigator.serial.requestPort();
    await port.open({ baudRate: 9600 });
    setConnected(true, 'CONECTADO');

    const decoder = new TextDecoderStream();
    serialPipe = port.readable.pipeTo(decoder.writable);
    serialPipe.catch(() => {});
    const inputStream = decoder.readable;
    reader = inputStream.getReader();
    const activeReader = reader;

    let buffer = '';
    readLoop = (async () => {
      try {
        while (true) {
          const { value, done } = await activeReader.read();
          if (done) break;
          buffer += value;
          let idx;
          while ((idx = buffer.indexOf('\n')) !== -1) {
            const line = buffer.slice(0, idx).trim();
            buffer = buffer.slice(idx + 1);
            if (line.startsWith('{')) {
              try {
                const data = JSON.parse(line);
                processPacket(data);
              } catch {}
            }
          }
        }
      } catch (e) {
        if (connected) {
          console.error('Conexão serial interrompida:', e);
          await disconnect();
        }
      }
      if (connected) await disconnect();
    })();
  } catch (e) {
    console.error('Erro ao conectar:', e);
    setConnected(false, 'DESCONECTADO');
    await clearSerialResources();
    if (e.name === 'NotFoundError') {
      // usuário cancelou a seleção de porta — não é erro real
      return;
    }
    let msg = 'Falha ao conectar com o Arduino.\n\n';
    if (e.name === 'NetworkError' || /already open|failed to open/i.test(e.message)) {
      msg += 'A porta serial já está sendo usada por outro programa.\n\n'
           + 'Verifique se:\n'
           + '• O Arduino IDE (Serial Monitor / Serial Plotter) está fechado\n'
           + '• Nenhuma outra aba do navegador está conectada à porta\n'
           + '• Nenhum outro software (PuTTY, etc.) está usando a porta COM\n\n'
           + 'Depois de liberar a porta, clique em CONECTAR para tentar novamente.';
    } else {
      msg += 'Erro: ' + e.name + ' — ' + e.message;
    }
    alert(msg);
  } finally {
    connecting = false;
  }
}

async function disconnect() {
  setConnected(false, 'DESCONECTADO');
  await clearSerialResources();
}

btnConn.addEventListener('click', () => {
  if (simInterval) {
    toggleSim();
    return;
  }
  connected ? disconnect() : connect();
});

function toggleControl(control) {
  control.checked = !control.checked;
  control.dispatchEvent(new Event('change', { bubbles: true }));
}

// ── Scroll: mouse wheel ──────────────────────────────────────
const chartWrap = document.querySelector('.chart-wrap');
const chartModeControls = document.querySelector('.chart-mode-controls');
const desktopChartModeHome = document.getElementById('chart-mode-controls-home');
const mobileChartModeHome = document.getElementById('mobile-chart-mode-controls');
const chartLegend = document.querySelector('.chart-legend');
const desktopChartLegendHome = document.getElementById('chart-legend-home');
const mobileChartLegendHome = document.getElementById('mobile-chart-legend');
const energiaTitle = document.querySelector('.energia-title');
const desktopEnergiaTitleHome = document.getElementById('energia-title-home');
const mobileEnergiaTitleHome = document.getElementById('mobile-energia-title');
let chartModeIsMobile = null;
function placeChartModeControls() {
  const isMobile = window.matchMedia('(max-width: 767px)').matches;
  if (isMobile === chartModeIsMobile) return;
  (isMobile ? mobileChartModeHome : desktopChartModeHome).appendChild(chartModeControls);
  (isMobile ? mobileChartLegendHome : desktopChartLegendHome).appendChild(chartLegend);
  (isMobile ? mobileEnergiaTitleHome : desktopEnergiaTitleHome).appendChild(energiaTitle);
  chartModeIsMobile = isMobile;
}
placeChartModeControls();
window.addEventListener('resize', placeChartModeControls);
const chartTooltip = document.getElementById('chart-tooltip');
const energiaTooltip = document.getElementById('energia-tooltip');
const chartHoverLine = document.getElementById('chart-hover-line');
const scrollFixToggle = document.getElementById('scroll-fix-toggle');
const infoFixToggle = document.getElementById('info-fix-toggle');
const linkChartsToggle = document.getElementById('link-charts-toggle');
scrollFixToggle.checked = scrollFixEnabled;
infoFixToggle.checked = infoFixEnabled;
let hoverPointerClientX = null;
function hideChartTooltip() {
  chartTooltip.style.display = 'none';
  chartTooltip.setAttribute('aria-hidden', 'true');
  energiaTooltip.style.display = 'none';
  energiaTooltip.setAttribute('aria-hidden', 'true');
  chartHoverLine.style.display = 'none';
  hoverHistoryIndex = null;
  hoverPointerClientX = null;
}

function updateTooltipValues(tooltip, historyIndex) {
  const rede = history.c1[historyIndex] * MULT_POTENCIA_REDE;
  const gerador = history.c2[historyIndex] * MULT_POTENCIA_GERADOR;
  const energia = history.p[historyIndex] * MULT_ENERGIA_POTENCIAL;
  tooltip.querySelector('[data-tooltip-time]').textContent = history.times[historyIndex] || '--:--:--';
  tooltip.querySelector('[data-tooltip-value="total"]').textContent = (rede + gerador).toFixed(2);
  tooltip.querySelector('[data-tooltip-value="rede"]').textContent = rede.toFixed(2);
  tooltip.querySelector('[data-tooltip-value="gerador"]').textContent = gerador.toFixed(2);
  tooltip.querySelector('[data-tooltip-value="energia"]').textContent = energia.toFixed(1);
}

function positionTooltip(tooltip, wrap, clientX, clientY) {
  tooltip.style.display = 'block';
  tooltip.setAttribute('aria-hidden', 'false');
  const wrapRect = wrap.getBoundingClientRect();
  const x = clientX - wrapRect.left - wrap.clientLeft;
  const y = clientY - wrapRect.top - wrap.clientTop;
  const maxLeft = Math.max(6, wrap.clientWidth - tooltip.offsetWidth - 6);
  const maxTop = Math.max(6, wrap.clientHeight - tooltip.offsetHeight - 6);
  tooltip.style.left = `${Math.max(6, Math.min(maxLeft, x + 14))}px`;
  tooltip.style.top = `${Math.max(6, Math.min(maxTop, y + 14))}px`;
}

function positionHoverLine() {
  const layout = chartPointLayout;
  if (hoverHistoryIndex === null || !layout || hoverHistoryIndex < layout.start ||
      hoverHistoryIndex >= layout.start + layout.count) {
    chartHoverLine.style.display = 'none';
    return;
  }

  const canvasRect = canvas.getBoundingClientRect();
  const wrapRect = chartWrap.getBoundingClientRect();
  const point = hoverHistoryIndex - layout.start;
  const pointX = canvasRect.left - wrapRect.left - chartWrap.clientLeft + layout.left +
    (point / (layout.count - 1)) * layout.width;
  const pointY = canvasRect.top - wrapRect.top - chartWrap.clientTop + layout.top;
  chartHoverLine.style.left = `${pointX}px`;
  chartHoverLine.style.top = `${pointY}px`;
  chartHoverLine.style.height = `${layout.height}px`;
  chartHoverLine.style.display = 'block';
}

function syncHoveredChartPoint() {
  if (hoverHistoryIndex === null) {
    chartHoverLine.style.display = 'none';
    return;
  }
  if (!chartPointLayout) {
    chartHoverLine.style.display = 'none';
    return;
  }
  if (hoverHistoryIndex < 0 || hoverHistoryIndex >= history.labels.length) {
    hideChartTooltip();
    return;
  }
  if (!infoFixEnabled && hoverPointerClientX !== null && chartTooltip.style.display !== 'none') {
    const canvasRect = canvas.getBoundingClientRect();
    const pointerX = hoverPointerClientX - canvasRect.left;
    if (pointerX < chartPointLayout.left || pointerX > chartPointLayout.left + chartPointLayout.width) {
      chartHoverLine.style.display = 'none';
      return;
    }
    const point = Math.round(((pointerX - chartPointLayout.left) / chartPointLayout.width) * (chartPointLayout.count - 1));
    hoverHistoryIndex = chartPointLayout.start + point;
  }
  updateTooltipValues(chartTooltip, hoverHistoryIndex);
  positionHoverLine();
}

function showChartTooltip(e) {
  const layout = chartPointLayout;
  if (!layout || (e.pointerType && e.pointerType !== 'mouse' && e.pointerType !== 'pen')) {
    hideChartTooltip();
    return;
  }

  const canvasRect = canvas.getBoundingClientRect();
  const pointerX = e.clientX - canvasRect.left;
  const pointerY = e.clientY - canvasRect.top;
  if (pointerX < layout.left || pointerX > layout.left + layout.width ||
      pointerY < layout.top || pointerY > layout.top + layout.height) {
    hideChartTooltip();
    return;
  }

  const point = Math.round(((pointerX - layout.left) / layout.width) * (layout.count - 1));
  hoverHistoryIndex = layout.start + point;
  hoverPointerClientX = e.clientX;
  energiaTooltip.style.display = 'none';
  updateTooltipValues(chartTooltip, hoverHistoryIndex);
  positionTooltip(chartTooltip, chartWrap, e.clientX, e.clientY);
  positionHoverLine();
}

function showTouchTooltip(touch, wrap, chartCanvas, layout, tooltip, isMainChart) {
  if (!layout) return;
  const canvasRect = chartCanvas.getBoundingClientRect();
  const x = touch.clientX - canvasRect.left;
  const y = touch.clientY - canvasRect.top;
  if (x < layout.left || x > layout.left + layout.width ||
      y < layout.top || y > layout.top + layout.height) return;

  const point = Math.round(((x - layout.left) / layout.width) * (layout.count - 1));
  const historyIndex = layout.start + point;
  updateTooltipValues(tooltip, historyIndex);
  if (isMainChart) {
    energiaTooltip.style.display = 'none';
    hoverHistoryIndex = historyIndex;
    hoverPointerClientX = touch.clientX;
  } else {
    chartTooltip.style.display = 'none';
    chartHoverLine.style.display = 'none';
  }
  positionTooltip(tooltip, wrap, touch.clientX, touch.clientY);
  if (isMainChart) positionHoverLine();
}

chartWrap.addEventListener('pointermove', showChartTooltip);
chartWrap.addEventListener('pointerleave', (e) => {
  if (!e.pointerType || e.pointerType === 'mouse' || e.pointerType === 'pen') hideChartTooltip();
});

scrollFixToggle.addEventListener('change', () => {
  scrollFixEnabled = scrollFixToggle.checked;
  try { localStorage.setItem(LS_SCROLL_FIX, String(scrollFixEnabled)); } catch (_) {}
});
infoFixToggle.addEventListener('change', () => {
  infoFixEnabled = infoFixToggle.checked;
  try { localStorage.setItem(LS_INFO_FIX, String(infoFixEnabled)); } catch (_) {}
  syncHoveredChartPoint();
});
linkChartsToggle.checked = chartLinkEnabled;
linkChartsToggle.addEventListener('change', () => {
  chartLinkEnabled = linkChartsToggle.checked;
  try { localStorage.setItem(LS_LINK_CHARTS, String(chartLinkEnabled)); } catch (_) {}
  if (chartLinkEnabled) {
    syncLinkedChartAxes();
    eScrollOffset = scrollOffset;
    eYScrollOffset = yScrollOffset;
  } else {
    restoreIndependentChartAxes();
  }
  setLinkedAxisInputs();
  drawChart();
});

chartWrap.addEventListener('wheel', (e) => {
  const mobileViewport = window.matchMedia('(max-width: 767px)').matches;
  if (e.shiftKey) {
    if (mobileViewport) return;
    // Shift + scroll → move eixo Y para cima/baixo
    const delta = Math.sign(e.deltaY);
    // delta > 0 = scroll down = desce viewport = yScrollOffset diminui
    // delta < 0 = scroll up   = sobe viewport  = yScrollOffset aumenta
    const allVals  = history.c1.map((v,i) =>
      Math.max(v * MULT_POTENCIA_REDE + history.c2[i] * MULT_POTENCIA_GERADOR,
               v * MULT_POTENCIA_REDE,
               history.c2[i] * MULT_POTENCIA_GERADOR));
    const dataMax  = allVals.length ? Math.max(...allVals, 1) : 1;
    const yMaxBase = Y_MAX > 0 ? Y_MAX : dataMax;
    const step     = Math.max(1, Math.round(yMaxBase * 0.05));
    const maxYScroll = Math.max(0, Math.max(dataMax, yMaxBase) - yMaxBase);
    if (mobileViewport && (maxYScroll === 0 || (e.deltaY > 0 ? yScrollOffset <= 0 : yScrollOffset >= maxYScroll))) return;
    e.preventDefault();
    yScrollOffset  = Math.max(0, Math.min(maxYScroll, yScrollOffset - delta * step));
    if (chartLinkEnabled) eYScrollOffset = yScrollOffset;
  } else {
    // Scroll normal → move X (histórico)
    if (mobileViewport && Math.abs(e.deltaY) > Math.abs(e.deltaX)) return;
    if (X_AXIS === 0) {
      if (!mobileViewport) e.preventDefault();
      return;
    }
    const delta = Math.sign(e.deltaX || e.deltaY);
    const maxOffset = Math.max(0, history.labels.length - X_AXIS);
    if (mobileViewport && (maxOffset === 0 || (delta > 0 ? scrollOffset >= maxOffset : scrollOffset <= 0))) return;
    e.preventDefault();
    scrollOffset = Math.max(0, Math.min(maxOffset, scrollOffset + delta * 3));
    if (chartLinkEnabled) eScrollOffset = scrollOffset;
  }
  drawChart();
}, { passive: false });

let touchStartX = null;
let touchStartY = null;
let touchDidMove = false;
chartWrap.addEventListener('touchstart', (e) => {
  touchStartX = e.touches[0].clientX;
  touchStartY = e.touches[0].clientY;
  touchDidMove = false;
  hideChartTooltip();
}, { passive: true });

chartWrap.addEventListener('touchmove', (e) => {
  if (touchStartX === null) return;
  const dx = touchStartX - e.touches[0].clientX;
  const dy = touchStartY - e.touches[0].clientY;
  const mobileViewport = window.matchMedia('(max-width: 767px)').matches;
  if (Math.abs(dx) > 5 || Math.abs(dy) > 5) touchDidMove = true;

  if (Math.abs(dy) > Math.abs(dx) || X_AXIS === 0 || Math.abs(dx) < 5) return;
  const maxOffset = Math.max(0, history.labels.length - X_AXIS);
  if (mobileViewport && (maxOffset === 0 || (dx < 0 ? scrollOffset >= maxOffset : scrollOffset <= 0))) return;
  e.preventDefault();
  scrollOffset = Math.max(0, Math.min(maxOffset, scrollOffset - Math.sign(dx) * 2));
  if (chartLinkEnabled) eScrollOffset = scrollOffset;

  touchStartX = e.touches[0].clientX;
  touchStartY = e.touches[0].clientY;
  drawChart();
}, { passive: false });

chartWrap.addEventListener('touchend', (e) => {
  if (!touchDidMove && e.changedTouches.length) {
    showTouchTooltip(e.changedTouches[0], chartWrap, canvas, chartPointLayout, chartTooltip, true);
  }
  touchStartX = null;
  touchStartY = null;
});

// ── Y-max: aceita 0 (automático) e inteiros positivos (fixo) ──
function onYMaxChange(val) {
  const n = parseAxisValue(val);
  Y_MAX = n;
  yScrollOffset = 0;
  if (chartLinkEnabled) eYScrollOffset = 0;
  try { localStorage.setItem(LS_YMAX, Y_MAX); } catch(_) {}
  if (chartLinkEnabled) syncLinkedChartAxes();
  drawChart();
}

// ── Clear: reseta scroll e sidebar ───────────────────────────
function clearChart() {
  history.labels.length = 0;
  history.c1.length     = 0;
  history.c2.length     = 0;
  history.p.length      = 0;
  history.times.length  = 0;
  hideChartTooltip();
  scrollOffset  = 0;
  eScrollOffset = 0;
  yScrollOffset = 0;
  try { localStorage.removeItem(LS_HISTORY); } catch(_) {}

  // Zera os valores nos cards da sidebar
  ['val-total','val-rede','val-gerador','val-energia'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.firstChild.textContent = '—';
  });
  elRaw1.textContent = '—';
  elRaw2.textContent = '—';
  elRawP.textContent = '—';
  ['bar-total','bar-rede','bar-gerador','bar-energia'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.width = '0%';
  });

  updateNoData();
  drawChart();
}

// ── Simulação ─────────────────────────────────────────────────
let simInterval = null;
const simState  = { c1: 5, c2: 8, p: 60, dc1: 0.2, dc2: 0.15, dp: 0.3 };

function simStep() {
  simState.dc1 += (Math.random() - 0.5) * 0.1;
  simState.dc2 += (Math.random() - 0.5) * 0.1;
  simState.dp  += (Math.random() - 0.5) * 0.2;
  simState.dc1 = Math.max(-1, Math.min(1, simState.dc1));
  simState.dc2 = Math.max(-1, Math.min(1, simState.dc2));
  simState.dp  = Math.max(-2, Math.min(2, simState.dp));
  simState.c1  = Math.max(0, Math.min(30, simState.c1 + simState.dc1));
  simState.c2  = Math.max(0, Math.min(30, simState.c2 + simState.dc2));
  simState.p   = Math.max(0, Math.min(200, simState.p  + simState.dp));
  processPacket({
    corrente1: (simState.c1 / MULT_DEFAULTS.rede).toFixed(4),
    corrente2: (simState.c2 / MULT_DEFAULTS.gerador).toFixed(4),
    pressao:   (simState.p / MULT_DEFAULTS.energia).toFixed(4),
    rele: 'false',
  });
}

function toggleSim() {
  if (connected) return;
  if (simInterval) {
    clearInterval(simInterval);
    simInterval = null;
    const btn = document.getElementById('btn-sim');
    if (btn) {
      btn.querySelector('.sim-label').textContent = 'SIMULAR';
      btn.className = '';
    }
    btnConnLabel.textContent = 'CONECTAR';
    btnConn.className = '';
  } else {
    simInterval = setInterval(simStep, 500);
    simStep();
    const btn = document.getElementById('btn-sim');
    if (btn) {
      btn.querySelector('.sim-label').textContent = 'PARAR';
      btn.className = 'simulating';
    }
    btnConnLabel.textContent = 'SIMULANDO';
    btnConn.className = 'simulating';
  }
}

// ── Keyboard: Tab×2 = simulação ──────────────────────────────
let tabCount = 0, tabTimer = null;
let spacePressAt = 0;
document.addEventListener('keydown', (e) => {
  if (e.code === 'Space' && !e.repeat) {
    if (helpOverlay.classList.contains('is-open')) return;
    const target = e.target;
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target.isContentEditable) {
      spacePressAt = 0;
      return;
    }
    e.preventDefault();
    const now = Date.now();
    if (now - spacePressAt <= 450) {
      spacePressAt = 0;
      if (simInterval) toggleSim();
      connected ? disconnect() : connect();
    } else {
      spacePressAt = now;
    }
  }

  if (helpOverlay.classList.contains('is-open')) return;
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) return;
  if (!e.repeat && e.key === '3') themeToggle.click();
  if (!e.repeat && e.key === '4') toggleControl(linkChartsToggle);
  if (!e.repeat && e.key === '5') toggleControl(scrollFixToggle);
  if (!e.repeat && e.key === '6') toggleControl(infoFixToggle);

  if (e.key === 'Tab') {
    if (helpOverlay.classList.contains('is-open')) return;
    e.preventDefault();
    tabCount++;
    clearTimeout(tabTimer);
    if (tabCount >= 2) {
      tabCount = 0;
      toggleSim();
    } else {
      tabTimer = setTimeout(() => { tabCount = 0; }, 600);
    }
  }
});

// ── Keyboard: double-0 = clear ────────────────────────────────
let zeroCount = 0, zeroTimer = null;
document.addEventListener('keydown', (e) => {
  if (helpOverlay.classList.contains('is-open')) return;
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) return;
  if (e.key === '1' && !e.repeat) {
    e.preventDefault();
    resetMultipliers();
    return;
  }
  if (e.key === '0') {
    e.preventDefault();
    zeroCount++;
    clearTimeout(zeroTimer);
    if (zeroCount >= 2) {
      zeroCount = 0;
      clearChart();
    } else {
      zeroTimer = setTimeout(() => { zeroCount = 0; }, 600);
    }
  }
});

// ── Clock — atualiza horário sempre, mesmo sem Arduino ────────
function updateClock() {
  const now = new Date();
  const ts  = now.toTimeString().slice(0, 8); // HH:MM:SS
  elTs.textContent = ts;
  const elTsMobile = document.getElementById('timestamp-mobile');
  if (elTsMobile) elTsMobile.textContent = ts;
}
updateClock();
setInterval(updateClock, 1000);

// ════════════════════════════════════════════════════════════
//  MINI-GRÁFICO — Energia Pot. Armazenada
// ════════════════════════════════════════════════════════════
const LS_E_XAXIS = 'caes_e_xaxis';
const LS_E_YMAX  = 'caes_e_ymax';

let E_X_AXIS      = Math.max(0, parseInt(localStorage.getItem(LS_E_XAXIS) || '0', 10));
let E_Y_MAX       = Math.max(0, parseInt(localStorage.getItem(LS_E_YMAX)  || '0', 10));
let eScrollOffset = 0;
let eYScrollOffset = 0;

// Init inputs
document.getElementById('xaxis-e').value = E_X_AXIS > 0 ? E_X_AXIS : '';
document.getElementById('ymax-e').value  = E_Y_MAX  > 0 ? E_Y_MAX  : '';

function syncLinkedChartAxes() {
  E_X_AXIS = X_AXIS;
  E_Y_MAX = Y_MAX;
  document.getElementById('xaxis-e').value = E_X_AXIS > 0 ? E_X_AXIS : '';
  document.getElementById('ymax-e').value = E_Y_MAX > 0 ? E_Y_MAX : '';
}

function restoreIndependentChartAxes() {
  E_X_AXIS = parseAxisValue(localStorage.getItem(LS_E_XAXIS) || '0');
  E_Y_MAX = parseAxisValue(localStorage.getItem(LS_E_YMAX) || '0');
  eScrollOffset = 0;
  eYScrollOffset = 0;
  document.getElementById('xaxis-e').value = E_X_AXIS > 0 ? E_X_AXIS : '';
  document.getElementById('ymax-e').value = E_Y_MAX > 0 ? E_Y_MAX : '';
}

function setLinkedAxisInputs() {
  document.getElementById('xaxis-e').disabled = chartLinkEnabled;
  document.getElementById('ymax-e').disabled = chartLinkEnabled;
  document.querySelector('.energia-controls').classList.toggle('is-linked', chartLinkEnabled);
}

if (chartLinkEnabled) syncLinkedChartAxes();
setLinkedAxisInputs();

function onEAxisChange(axis, val) {
  if (chartLinkEnabled) return;
  const n = parseAxisValue(val);
  if (axis === 'x') {
    E_X_AXIS = n;
    eScrollOffset = 0;
    try { localStorage.setItem(LS_E_XAXIS, n); } catch(_) {}
  } else {
    E_Y_MAX = n;
    eYScrollOffset = 0;
    try { localStorage.setItem(LS_E_YMAX, n); } catch(_) {}
  }
  drawEnergia();
}

function getEView() {
  const total = history.labels.length;
  if (E_X_AXIS === 0 || total <= E_X_AXIS) { eScrollOffset = 0; return { start: 0, end: total }; }
  const end   = Math.max(E_X_AXIS, total - eScrollOffset);
  const start = end - E_X_AXIS;
  return { start: Math.max(0, start), end };
}

const canvasE = document.getElementById('chart-energia');
const ctxE    = canvasE.getContext('2d');
let energiaPointLayout = null;

function resizeCanvasE() {
  const w = canvasE.offsetWidth, h = canvasE.offsetHeight;
  if (w > 0 && h > 0 && (canvasE.width !== w || canvasE.height !== h)) {
    canvasE.width = w; canvasE.height = h;
  }
}

function drawEnergia() {
  energiaPointLayout = null;
  resizeCanvasE();
  const W = canvasE.width, H = canvasE.height;
  ctxE.clearRect(0, 0, W, H);
  const noDataOverlay = document.getElementById('no-data-energia');
  const showNoData = history.labels.length < 2;
  noDataOverlay.style.opacity = showNoData ? '1' : '0';
  noDataOverlay.style.pointerEvents = showNoData ? 'auto' : 'none';
  if (history.labels.length < 2 || W === 0 || H === 0) {
    energiaYScrollMax = 0;
    updateYAxisScrollbar(document.getElementById('energia-y-scrollbar'), 0, 0, 1, 1);
    return;
  }

  const mobileLayout = window.matchMedia('(max-width: 767px)').matches;
  const pad = mobileLayout
    ? { top: 20, right: 20, bottom: 36, left: 58 }
    : { top: 14, right: 16, bottom: 24, left: 38 };
  const plotW = W - pad.left - pad.right;
  const plotH = H - pad.top  - pad.bottom;

  const { start, end } = getEView();
  const sliceP  = history.p.slice(start, end);
  const sliceLb = history.labels.slice(start, end);
  const dispE   = sliceP.map(v => v * MULT_ENERGIA_POTENCIAL);

  // Y range
  const dataMax  = Math.max(...dispE, 1);
  const eYBase   = E_Y_MAX > 0 ? E_Y_MAX : dataMax;
  const absMax   = Math.max(dataMax, eYBase);
  const maxEYScroll = Math.max(0, absMax - eYBase);
  eYScrollOffset = Math.max(0, Math.min(maxEYScroll, eYScrollOffset));
  energiaYScrollMax = maxEYScroll;
  updateYAxisScrollbar(document.getElementById('energia-y-scrollbar'), eYScrollOffset, maxEYScroll, eYBase, eYBase + maxEYScroll);

  const minVal = eYScrollOffset;
  const maxVal = eYScrollOffset + eYBase;
  const range  = eYBase || 1;

  // Scroll indicator
  if (eScrollOffset > 0 && E_X_AXIS > 0) {
    ctxE.save();
    ctxE.fillStyle = 'rgba(255,184,0,0.02)';
    ctxE.fillRect(0, 0, W, H);
    ctxE.restore();
    ctxE.save();
    ctxE.font = '9px "Share Tech Mono"';
    ctxE.fillStyle = '#FFB800';
    ctxE.textAlign = 'left';
    ctxE.fillText(`◀ ${eScrollOffset} atrás`, pad.left + 4, pad.top - 2);
    ctxE.restore();
  }

  // Grid
  ctxE.strokeStyle = getThemeColor('--chart-grid', 'rgba(42,48,64,0.8)'); ctxE.lineWidth = 1;
  const gridLines = mobileLayout ? 5 : 4;
  for (let i = 0; i <= gridLines; i++) {
    const y = pad.top + plotH - (i / gridLines) * plotH;
    ctxE.beginPath(); ctxE.moveTo(pad.left, y); ctxE.lineTo(pad.left + plotW, y); ctxE.stroke();
    const lbl = `${(minVal + (i / gridLines) * range).toFixed(1)}J`;
    ctxE.fillStyle = getThemeColor('--chart-label', '#9AA5B8'); ctxE.font = `${mobileLayout ? 10 : 9}px "Share Tech Mono"`;
    const labelX = pad.left - 4;
    if (ctxE.measureText(lbl).width > labelX - 2) {
      ctxE.textAlign = 'left'; ctxE.fillText(lbl, 2, y + 3);
    } else {
      ctxE.textAlign = 'right'; ctxE.fillText(lbl, labelX, y + 3);
    }
  }

  // X labels
  const n = sliceLb.length;
  if (n < 2) return;
  energiaPointLayout = { start, count: n, left: pad.left, top: pad.top, width: plotW, height: plotH };
  ctxE.fillStyle = getThemeColor('--chart-label', '#9AA5B8'); ctxE.textAlign = 'center'; ctxE.font = `${mobileLayout ? 11 : 9}px "Share Tech Mono"`;
  const maxTicks = Math.max(2, Math.floor(plotW / (mobileLayout ? 64 : 58)));
  const tickCount = Math.min(n, maxTicks);
  const visibleLabels = new Set();
  for (let tick = 0; tick < tickCount; tick++) {
    const i = Math.round(tick * (n - 1) / (tickCount - 1));
    const label = sliceLb[i];
    if (visibleLabels.has(label)) continue;
    visibleLabels.add(label);
    const x = pad.left + (i / (n - 1)) * plotW;
    ctxE.fillText(label, x, H - (mobileLayout ? 8 : 5));
  }

  // Clamp
  const clamped = E_Y_MAX > 0 ? dispE.map(v => Math.min(v, maxVal)) : dispE;
  const color   = '#FF3C00';

  // Fill
  ctxE.save();
  ctxE.beginPath();
  clamped.forEach((v, i) => {
    const x = pad.left + (i / (n - 1)) * plotW;
    const y = pad.top + plotH - ((v - minVal) / range) * plotH;
    i === 0 ? ctxE.moveTo(x, y) : ctxE.lineTo(x, y);
  });
  ctxE.lineTo(pad.left + plotW, pad.top + plotH);
  ctxE.lineTo(pad.left, pad.top + plotH);
  ctxE.closePath();
  ctxE.fillStyle = 'rgba(255,60,0,0.07)'; ctxE.fill(); ctxE.restore();

  // Line
  strokeCappedSeries(ctxE, dispE, E_Y_MAX > 0, maxVal,
    i => pad.left + (i / (n - 1)) * plotW,
    v => pad.top + plotH - ((v - minVal) / range) * plotH,
    color, 1.5, 6);

  // Live dot
  if (eScrollOffset === 0) {
    const lv = clamped[n - 1];
    const lx = pad.left + plotW;
    const ly = pad.top + plotH - ((lv - minVal) / range) * plotH;
    ctxE.save();
    ctxE.shadowColor = color; ctxE.shadowBlur = 10;
    ctxE.fillStyle = color;
    ctxE.beginPath(); ctxE.arc(lx, ly, 3, 0, Math.PI * 2); ctxE.fill();
    ctxE.restore();
  }
}

// Wheel and touch for energia chart
const energiaWrap = document.querySelector('.energia-wrap');

energiaWrap.addEventListener('wheel', (e) => {
  const mobileViewport = window.matchMedia('(max-width: 767px)').matches;
  if (e.shiftKey) {
    if (mobileViewport) return;
    const allVals  = history.p.map(v => v * MULT_ENERGIA_POTENCIAL);
    const dataMax  = allVals.length ? Math.max(...allVals, 1) : 1;
    const eYBase   = E_Y_MAX > 0 ? E_Y_MAX : dataMax;
    const step     = Math.max(1, Math.round(eYBase * 0.05));
    const maxScroll = Math.max(0, Math.max(dataMax, eYBase) - eYBase);
    if (mobileViewport && (maxScroll === 0 || (e.deltaY > 0 ? eYScrollOffset <= 0 : eYScrollOffset >= maxScroll))) return;
    e.preventDefault();
    eYScrollOffset = Math.max(0, Math.min(maxScroll, eYScrollOffset - Math.sign(e.deltaY) * step));
    if (chartLinkEnabled) yScrollOffset = eYScrollOffset;
  } else {
    if (mobileViewport && Math.abs(e.deltaY) > Math.abs(e.deltaX)) return;
    if (E_X_AXIS === 0) {
      if (!mobileViewport) e.preventDefault();
      return;
    }
    const maxOffset = Math.max(0, history.labels.length - E_X_AXIS);
    const delta = Math.sign(e.deltaX || e.deltaY);
    if (mobileViewport && (maxOffset === 0 || (delta > 0 ? eScrollOffset >= maxOffset : eScrollOffset <= 0))) return;
    e.preventDefault();
    eScrollOffset = Math.max(0, Math.min(maxOffset, eScrollOffset + delta * 3));
    if (chartLinkEnabled) scrollOffset = eScrollOffset;
  }
  chartLinkEnabled ? drawChart() : drawEnergia();
}, { passive: false });

let eTouchX = null, eTouchY = null, eTouchMoved = false;
energiaWrap.addEventListener('touchstart', (e) => {
  eTouchX = e.touches[0].clientX; eTouchY = e.touches[0].clientY;
  eTouchMoved = false;
  hideChartTooltip();
}, { passive: true });

energiaWrap.addEventListener('touchmove', (e) => {
  if (eTouchX === null) return;
  const dx = eTouchX - e.touches[0].clientX;
  const dy = eTouchY - e.touches[0].clientY;
  const mobileViewport = window.matchMedia('(max-width: 767px)').matches;
  if (Math.abs(dx) > 5 || Math.abs(dy) > 5) eTouchMoved = true;
  if (Math.abs(dy) > Math.abs(dx) || E_X_AXIS === 0 || Math.abs(dx) < 5) return;
  const maxOffset = Math.max(0, history.labels.length - E_X_AXIS);
  if (mobileViewport && (maxOffset === 0 || (dx < 0 ? eScrollOffset >= maxOffset : eScrollOffset <= 0))) return;
  e.preventDefault();
  eScrollOffset = Math.max(0, Math.min(maxOffset, eScrollOffset - Math.sign(dx) * 2));
  if (chartLinkEnabled) scrollOffset = eScrollOffset;
  eTouchX = e.touches[0].clientX; eTouchY = e.touches[0].clientY;
  chartLinkEnabled ? drawChart() : drawEnergia();
}, { passive: false });

energiaWrap.addEventListener('touchend', (e) => {
  const mobileViewport = window.matchMedia('(max-width: 767px)').matches;
  if (mobileViewport && !eTouchMoved && e.changedTouches.length) {
    showTouchTooltip(e.changedTouches[0], energiaWrap, canvasE, energiaPointLayout, energiaTooltip, false);
  }
  eTouchX = null;
  eTouchY = null;
});

// Desenha o mini-gráfico antes do principal para manter a atualização visual alinhada.
const _drawChartOrig = drawChart;
drawChart = function() { drawEnergia(); _drawChartOrig(); };

function bindYAxisScrollbar(element, getMaxOffset, getOffset, setOffset, redraw) {
  let activePointer = null;
  let grabOffset = 0;
  const thumb = element.querySelector('.chart-y-scrollbar-thumb');
  const updateFromPointer = (clientY) => {
    const maxOffset = getMaxOffset();
    if (maxOffset <= 0) return;
    const rect = element.getBoundingClientRect();
    const thumbHeight = thumb.getBoundingClientRect().height;
    const travel = Math.max(1, rect.height - thumbHeight);
    const ratio = Math.max(0, Math.min(1, (clientY - rect.top - grabOffset) / travel));
    setOffset((1 - ratio) * maxOffset);
    redraw();
  };
  element.addEventListener('pointerdown', (e) => {
    if (getMaxOffset() <= 0) return;
    e.preventDefault();
    e.stopPropagation();
    const thumbRect = thumb.getBoundingClientRect();
    grabOffset = e.clientY >= thumbRect.top && e.clientY <= thumbRect.bottom
      ? e.clientY - thumbRect.top
      : thumbRect.height / 2;
    activePointer = e.pointerId;
    element.setPointerCapture(e.pointerId);
    updateFromPointer(e.clientY);
  });
  element.addEventListener('pointermove', (e) => {
    if (activePointer !== e.pointerId) return;
    e.preventDefault();
    updateFromPointer(e.clientY);
  });
  const stopDrag = (e) => {
    if (activePointer !== e.pointerId) return;
    activePointer = null;
    if (element.hasPointerCapture(e.pointerId)) element.releasePointerCapture(e.pointerId);
  };
  element.addEventListener('pointerup', stopDrag);
  element.addEventListener('pointercancel', stopDrag);
  element.addEventListener('keydown', (e) => {
    const maxOffset = getMaxOffset();
    if (maxOffset <= 0) return;
    const step = Math.max(1, maxOffset * (e.key.startsWith('Page') ? 0.2 : 0.05));
    let next = getOffset();
    if (e.key === 'ArrowUp' || e.key === 'PageUp') next += step;
    else if (e.key === 'ArrowDown' || e.key === 'PageDown') next -= step;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = maxOffset;
    else return;
    e.preventDefault();
    setOffset(Math.max(0, Math.min(maxOffset, next)));
    redraw();
  });
}

const chartYScrollBar = document.getElementById('chart-y-scrollbar');
const energiaYScrollBar = document.getElementById('energia-y-scrollbar');
bindYAxisScrollbar(
  chartYScrollBar,
  () => chartYScrollMax,
  () => yScrollOffset,
  value => { yScrollOffset = value; if (chartLinkEnabled) eYScrollOffset = value; },
  () => drawChart()
);
bindYAxisScrollbar(
  energiaYScrollBar,
  () => energiaYScrollMax,
  () => eYScrollOffset,
  value => { eYScrollOffset = value; if (chartLinkEnabled) yScrollOffset = value; },
  () => chartLinkEnabled ? drawChart() : drawEnergia()
);

// Redimensionamento persistente da coluna lateral
const sidebarWidthKey = 'caes_sidebar_width';
const mainLayout = document.querySelector('main');
const sidebarCol = document.querySelector('.sidebar-col');
const sidebarResizer = document.getElementById('sidebar-resizer');
const sidebarMinWidth = 334;

function setSidebarWidth(width, save = false) {
  const maxWidth = Math.max(sidebarMinWidth, Math.min(sidebarMinWidth * 2, mainLayout.clientWidth - 338));
  const nextWidth = Math.max(sidebarMinWidth, Math.min(maxWidth, width));
  sidebarCol.style.setProperty('--sidebar-width', `${nextWidth}px`);
  sidebarResizer.setAttribute('aria-valuenow', String(Math.round(nextWidth)));
  if (save) {
    try { localStorage.setItem(sidebarWidthKey, String(Math.round(nextWidth))); } catch (_) {}
  }
}

let savedSidebarWidth = sidebarMinWidth;
try {
  const storedWidth = parseInt(localStorage.getItem(sidebarWidthKey), 10);
  if (Number.isFinite(storedWidth)) savedSidebarWidth = Math.max(sidebarMinWidth, storedWidth);
} catch (_) {}
setSidebarWidth(savedSidebarWidth);

sidebarResizer.addEventListener('pointerdown', (e) => {
  if (window.matchMedia('(max-width: 767px), (max-width: 900px) and (orientation: landscape)').matches) return;
  e.preventDefault();
  sidebarResizer.classList.add('dragging');
  sidebarResizer.setPointerCapture(e.pointerId);
});

sidebarResizer.addEventListener('pointermove', (e) => {
  if (!sidebarResizer.hasPointerCapture(e.pointerId)) return;
  setSidebarWidth(mainLayout.getBoundingClientRect().right - e.clientX);
});

function finishSidebarResize(e) {
  if (!sidebarResizer.hasPointerCapture(e.pointerId)) return;
  sidebarResizer.releasePointerCapture(e.pointerId);
  sidebarResizer.classList.remove('dragging');
  const width = parseFloat(getComputedStyle(sidebarCol).width);
  setSidebarWidth(width, true);
}

sidebarResizer.addEventListener('pointerup', finishSidebarResize);
sidebarResizer.addEventListener('pointercancel', finishSidebarResize);
sidebarResizer.addEventListener('keydown', (e) => {
  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
  e.preventDefault();
  const width = parseFloat(getComputedStyle(sidebarCol).width);
  setSidebarWidth(width + (e.key === 'ArrowLeft' ? 20 : -20), true);
});

window.addEventListener('resize', () => {
  setSidebarWidth(parseFloat(getComputedStyle(sidebarCol).width));
  drawChart();
});

const chartResizeObserver = new ResizeObserver(() => {
  drawChart();
});
chartResizeObserver.observe(document.querySelector('.chart-wrap'));
chartResizeObserver.observe(document.querySelector('.energia-wrap'));

// Redimensionamento persistente do painel do gráfico de energia
const energiaSplitKey = 'caes_energia_split';
const energiaPanel = document.querySelector('.energia-panel');
const energiaResizer = document.getElementById('energia-resizer');
const energiaMinHeight = 220;
const cardsMinHeight = 180;
let energiaPanelRatio = 0.3;

try {
  const storedRatio = parseFloat(localStorage.getItem(energiaSplitKey));
  if (Number.isFinite(storedRatio) && storedRatio > 0 && storedRatio < 1) energiaPanelRatio = storedRatio;
} catch (_) {}

function setEnergiaPanelHeight(height, save = false) {
  const available = sidebarCol.clientHeight;
  if (available <= 0) return;
  const maxHeight = Math.max(energiaMinHeight, available - cardsMinHeight - 8);
  const nextHeight = Math.max(energiaMinHeight, Math.min(maxHeight, height));
  energiaPanel.style.flexBasis = `${nextHeight}px`;
  energiaResizer.setAttribute('aria-valuenow', String(Math.round(nextHeight)));
  if (save) {
    energiaPanelRatio = nextHeight / available;
    try { localStorage.setItem(energiaSplitKey, String(energiaPanelRatio)); } catch (_) {}
  }
}

function isStackedLayout() {
  return window.matchMedia('(max-width: 767px), (max-width: 900px) and (orientation: landscape)').matches;
}

if (!isStackedLayout()) setEnergiaPanelHeight(sidebarCol.clientHeight * energiaPanelRatio);

energiaResizer.addEventListener('pointerdown', (e) => {
  if (isStackedLayout()) return;
  e.preventDefault();
  energiaResizer.classList.add('dragging');
  energiaResizer.setPointerCapture(e.pointerId);
});

energiaResizer.addEventListener('pointermove', (e) => {
  if (!energiaResizer.hasPointerCapture(e.pointerId)) return;
  setEnergiaPanelHeight(e.clientY - sidebarCol.getBoundingClientRect().top);
});

function finishEnergiaResize(e) {
  if (!energiaResizer.hasPointerCapture(e.pointerId)) return;
  energiaResizer.releasePointerCapture(e.pointerId);
  energiaResizer.classList.remove('dragging');
  setEnergiaPanelHeight(energiaPanel.getBoundingClientRect().height, true);
}

energiaResizer.addEventListener('pointerup', finishEnergiaResize);
energiaResizer.addEventListener('pointercancel', finishEnergiaResize);
energiaResizer.addEventListener('keydown', (e) => {
  if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
  e.preventDefault();
  const height = energiaPanel.getBoundingClientRect().height;
  setEnergiaPanelHeight(height + (e.key === 'ArrowUp' ? 20 : -20), true);
});

window.addEventListener('resize', () => {
  if (!isStackedLayout()) setEnergiaPanelHeight(sidebarCol.clientHeight * energiaPanelRatio);
});

// ── Initial draw ─────────────────────────────────────────────
updateNoData();
drawChart();
requestAnimationFrame(drawChart);
