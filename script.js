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
  usina:   '#00CFFF',
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
let chartLinkEnabled = loadTogglePreference(LS_LINK_CHARTS, false);

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
    syncHoveredChartPoint();
    return;
  }

  const pad = { top: 20, right: 20, bottom: 36, left: 64 };
  const plotW = W - pad.left - pad.right;
  const plotH = H - pad.top  - pad.bottom;

  // Fatia visível conforme scroll
  const { start, end } = getView();
  const slice = (arr) => arr.slice(start, end);

  const sliceC1 = slice(history.c1);
  const sliceC2 = slice(history.c2);
  const sliceLb = slice(history.labels);

  const dispTotal   = sliceC1.map((v, i) => v * MULT_POTENCIA_USINA + sliceC2[i] * MULT_POTENCIA_GERADOR);
  const dispUsina   = sliceC1.map(v => v * MULT_POTENCIA_USINA);
  const dispGerador = sliceC2.map(v => v * MULT_POTENCIA_GERADOR);
  // Y máximo base: fixo (Y_MAX > 0) ou automático (maior valor da janela)
  const allVals   = [...dispTotal, ...dispUsina, ...dispGerador];
  const dataMax   = Math.max(...allVals, 1);
  const yMaxBase  = Y_MAX > 0 ? Y_MAX : dataMax;
  const yRange    = yMaxBase; // span visível no eixo Y = altura fixa

  // yScrollOffset: quanto subimos acima do zero.
  // Limite superior: o ponto mais alto dos dados (ou Y_MAX se fixo)
  const absoluteMax = Math.max(dataMax, yMaxBase);
  const maxYScroll  = Math.max(0, absoluteMax - yMaxBase);
  yScrollOffset     = Math.max(0, Math.min(maxYScroll, yScrollOffset));

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
    const label = (minVal + (i / gridLines) * range).toFixed(1);
    ctx.fillStyle = getThemeColor('--chart-label', '#9AA5B8');
    ctx.font = '11px "Share Tech Mono"';
    ctx.textAlign = 'right';
    ctx.fillText(label, pad.left - 8, y + 4);
  }

  // X labels
  const n = sliceLb.length;
  if (n < 2) {
    syncHoveredChartPoint();
    return;
  }
  chartPointLayout = { start, count: n, left: pad.left, top: pad.top, width: plotW, height: plotH };
  const step = Math.max(1, Math.floor(n / 8));
  ctx.fillStyle = getThemeColor('--chart-label', '#9AA5B8');
  ctx.textAlign = 'center';
  ctx.font = '11px "Share Tech Mono"';
  sliceLb.forEach((lbl, i) => {
    if (i % step === 0) {
      const x = pad.left + (i / (n - 1)) * plotW;
      ctx.fillText(lbl, x, H - 8);
    }
  });

  // Séries
  const series = [
    { key: 'total',   data: dispTotal   },
    { key: 'usina',   data: dispUsina   },
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
const elUsina   = document.getElementById('val-usina');
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
const helpToggle = document.getElementById('help-toggle');
const helpOverlay = document.getElementById('help-overlay');
const helpClose = document.getElementById('help-close');

function closeHelp() {
  helpOverlay.classList.remove('is-open');
  helpOverlay.setAttribute('aria-hidden', 'true');
  helpToggle.focus();
}

helpToggle.addEventListener('click', () => {
  helpOverlay.classList.add('is-open');
  helpOverlay.setAttribute('aria-hidden', 'false');
  helpClose.focus();
});
helpClose.addEventListener('click', closeHelp);
helpOverlay.addEventListener('click', (e) => {
  if (e.target === helpOverlay) closeHelp();
});
document.addEventListener('keydown', (e) => {
  if (helpOverlay.classList.contains('is-open') && e.key === 'Escape') closeHelp();
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
const MULT_DEFAULTS = { usina: 220, gerador: 180, energia: 420 };

function _loadMult() {
  try {
    const saved = JSON.parse(localStorage.getItem(LS_MULT));
    if (saved) return saved;
  } catch(_) {}
  return { ...MULT_DEFAULTS };
}

function _saveMult() {
  try {
    localStorage.setItem(LS_MULT, JSON.stringify({
      usina:   MULT_POTENCIA_USINA,
      gerador: MULT_POTENCIA_GERADOR,
      energia: MULT_ENERGIA_POTENCIAL,
    }));
  } catch(_) {}
}

// Y máximo (0 = automático, baseado na janela visível)
let Y_MAX = Math.max(0, parseInt(localStorage.getItem(LS_YMAX) || '0', 10) || 0);

const _initMult = _loadMult();
let MULT_POTENCIA_USINA    = _initMult.usina;
let MULT_POTENCIA_GERADOR  = _initMult.gerador;
let MULT_ENERGIA_POTENCIAL = _initMult.energia;

// Aplica os valores carregados nos inputs
document.getElementById('mult-usina').value   = MULT_POTENCIA_USINA;
document.getElementById('mult-gerador').value = MULT_POTENCIA_GERADOR;
document.getElementById('mult-energia').value = MULT_ENERGIA_POTENCIAL;
document.getElementById('ymax-input').value   = Y_MAX  > 0 ? Y_MAX  : '';
document.getElementById('xaxis-input').value  = X_AXIS > 0 ? X_AXIS : '';

function onMultChange(which, val) {
  const n = parseFloat(val);
  if (isNaN(n)) return;
  if (which === 'usina')   MULT_POTENCIA_USINA    = n;
  if (which === 'gerador') MULT_POTENCIA_GERADOR  = n;
  if (which === 'energia') MULT_ENERGIA_POTENCIAL = n;
  _saveMult();
  drawChart();
}

function resetMultipliers() {
  MULT_POTENCIA_USINA = MULT_DEFAULTS.usina;
  MULT_POTENCIA_GERADOR = MULT_DEFAULTS.gerador;
  MULT_ENERGIA_POTENCIAL = MULT_DEFAULTS.energia;
  document.getElementById('mult-usina').value = MULT_POTENCIA_USINA;
  document.getElementById('mult-gerador').value = MULT_POTENCIA_GERADOR;
  document.getElementById('mult-energia').value = MULT_ENERGIA_POTENCIAL;
  _saveMult();

  const lastIndex = history.labels.length - 1;
  if (lastIndex >= 0) {
    const usina = history.c1[lastIndex] * MULT_POTENCIA_USINA;
    const gerador = history.c2[lastIndex] * MULT_POTENCIA_GERADOR;
    setVal(elTotal, usina + gerador, 2);
    setVal(elUsina, usina, 2);
    setVal(elGerador, gerador, 2);
    setVal(elEnergia, history.p[lastIndex] * MULT_ENERGIA_POTENCIAL, 1);
    setBar('bar-total', usina + gerador, 5000);
    setBar('bar-usina', usina, 4000);
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
  const usina   = c1 * MULT_POTENCIA_USINA;
  const gerador = c2 * MULT_POTENCIA_GERADOR;
  const total   = usina + gerador;
  const energia = p  * MULT_ENERGIA_POTENCIAL;

  // Atualiza cards com valores calculados
  const fmt = (el, v, dec) => {
    const unit = el.querySelector('.metric-unit');
    el.firstChild.textContent = v.toFixed(dec);
    el.classList.remove('flicker');
    void el.offsetWidth; el.classList.add('flicker');
  };

  fmt(elTotal,   total,   2);
  fmt(elUsina,   usina,   2);
  fmt(elGerador, gerador, 2);
  fmt(elEnergia, energia, 1);

  // Sensores brutos diretos
  elRaw1.textContent = c1.toFixed(2);
  elRaw2.textContent = c2.toFixed(2);
  elRawP.textContent = p.toFixed(1);

  setBar('bar-total',   total,   5000);
  setBar('bar-usina',   usina,   4000);
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

// ── Scroll: mouse wheel ──────────────────────────────────────
const chartWrap = document.querySelector('.chart-wrap');
const chartTooltip = document.getElementById('chart-tooltip');
const chartHoverLine = document.getElementById('chart-hover-line');
const scrollFixToggle = document.getElementById('scroll-fix-toggle');
const infoFixToggle = document.getElementById('info-fix-toggle');
const linkChartsToggle = document.getElementById('link-charts-toggle');
scrollFixToggle.checked = scrollFixEnabled;
infoFixToggle.checked = infoFixEnabled;
let hoverPointerClientX = null;
const tooltipTime = chartTooltip.querySelector('[data-tooltip-time]');
const tooltipValues = {
  total: chartTooltip.querySelector('[data-tooltip-value="total"]'),
  usina: chartTooltip.querySelector('[data-tooltip-value="usina"]'),
  gerador: chartTooltip.querySelector('[data-tooltip-value="gerador"]'),
  energia: chartTooltip.querySelector('[data-tooltip-value="energia"]')
};

function hideChartTooltip() {
  chartTooltip.style.display = 'none';
  chartTooltip.setAttribute('aria-hidden', 'true');
  chartHoverLine.style.display = 'none';
  hoverHistoryIndex = null;
  hoverPointerClientX = null;
}

function updateChartTooltipValues(historyIndex) {
  const usina = history.c1[historyIndex] * MULT_POTENCIA_USINA;
  const gerador = history.c2[historyIndex] * MULT_POTENCIA_GERADOR;
  const energia = history.p[historyIndex] * MULT_ENERGIA_POTENCIAL;
  tooltipTime.textContent = history.times[historyIndex] || '--:--:--';
  tooltipValues.total.textContent = (usina + gerador).toFixed(2);
  tooltipValues.usina.textContent = usina.toFixed(2);
  tooltipValues.gerador.textContent = gerador.toFixed(2);
  tooltipValues.energia.textContent = energia.toFixed(1);
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
  updateChartTooltipValues(hoverHistoryIndex);
  positionHoverLine();
}

function showChartTooltip(e) {
  const layout = chartPointLayout;
  if (!layout || (e.pointerType && e.pointerType !== 'mouse' && e.pointerType !== 'pen')) {
    hideChartTooltip();
    return;
  }

  const canvasRect = canvas.getBoundingClientRect();
  const wrapRect = chartWrap.getBoundingClientRect();
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
  updateChartTooltipValues(hoverHistoryIndex);

  chartTooltip.style.display = 'block';
  chartTooltip.setAttribute('aria-hidden', 'false');
  const wrapX = e.clientX - wrapRect.left - chartWrap.clientLeft;
  const wrapY = e.clientY - wrapRect.top - chartWrap.clientTop;
  const maxLeft = chartWrap.clientWidth - chartTooltip.offsetWidth - 6;
  const maxTop = chartWrap.clientHeight - chartTooltip.offsetHeight - 6;
  chartTooltip.style.left = `${Math.max(6, Math.min(maxLeft, wrapX + 14))}px`;
  chartTooltip.style.top = `${Math.max(6, Math.min(maxTop, wrapY + 14))}px`;
  positionHoverLine();
}

chartWrap.addEventListener('pointermove', showChartTooltip);
chartWrap.addEventListener('pointerleave', hideChartTooltip);

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
  }
  setLinkedAxisInputs();
  drawChart();
});

chartWrap.addEventListener('wheel', (e) => {
  const mobileViewport = window.matchMedia('(max-width: 767px)').matches;
  if (e.shiftKey) {
    // Shift + scroll → move eixo Y para cima/baixo
    const delta = Math.sign(e.deltaY);
    // delta > 0 = scroll down = desce viewport = yScrollOffset diminui
    // delta < 0 = scroll up   = sobe viewport  = yScrollOffset aumenta
    const allVals  = history.c1.map((v,i) =>
      Math.max(v * MULT_POTENCIA_USINA + history.c2[i] * MULT_POTENCIA_GERADOR,
               v * MULT_POTENCIA_USINA,
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
chartWrap.addEventListener('touchstart', (e) => {
  touchStartX = e.touches[0].clientX;
  touchStartY = e.touches[0].clientY;
}, { passive: true });

chartWrap.addEventListener('touchmove', (e) => {
  if (touchStartX === null) return;
  const dx = touchStartX - e.touches[0].clientX;
  const dy = touchStartY - e.touches[0].clientY;
  const mobileViewport = window.matchMedia('(max-width: 767px)').matches;

  if (Math.abs(dy) > Math.abs(dx)) {
    // Swipe vertical → Y scroll
    if (Math.abs(dy) < 5) return;
    const allVals  = history.c1.map((v,i) =>
      Math.max(v * MULT_POTENCIA_USINA + history.c2[i] * MULT_POTENCIA_GERADOR,
               v * MULT_POTENCIA_USINA,
               history.c2[i] * MULT_POTENCIA_GERADOR));
    const dataMax  = allVals.length ? Math.max(...allVals, 1) : 1;
    const yMaxBase = Y_MAX > 0 ? Y_MAX : dataMax;
    const step     = Math.max(1, Math.round(yMaxBase * 0.02));
    const maxYScroll = Math.max(0, Math.max(dataMax, yMaxBase) - yMaxBase);
    if (mobileViewport && (maxYScroll === 0 || (dy > 0 ? yScrollOffset >= maxYScroll : yScrollOffset <= 0))) return;
    e.preventDefault();
    // dy > 0 = dedo subiu = queremos ver mais para cima
    yScrollOffset  = Math.max(0, Math.min(maxYScroll, yScrollOffset + Math.sign(dy) * step));
    if (chartLinkEnabled) eYScrollOffset = yScrollOffset;
  } else {
    // Swipe horizontal → X scroll
    if (X_AXIS === 0 || Math.abs(dx) < 5) return;
    const maxOffset = Math.max(0, history.labels.length - X_AXIS);
    if (mobileViewport && (maxOffset === 0 || (dx > 0 ? scrollOffset >= maxOffset : scrollOffset <= 0))) return;
    e.preventDefault();
    scrollOffset = Math.max(0, Math.min(maxOffset, scrollOffset + Math.sign(dx) * 2));
    if (chartLinkEnabled) eScrollOffset = scrollOffset;
  }

  touchStartX = e.touches[0].clientX;
  touchStartY = e.touches[0].clientY;
  drawChart();
}, { passive: false });

chartWrap.addEventListener('touchend', () => { touchStartX = null; touchStartY = null; });

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
  ['val-total','val-usina','val-gerador','val-energia'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.firstChild.textContent = '—';
  });
  elRaw1.textContent = '—';
  elRaw2.textContent = '—';
  elRawP.textContent = '—';
  ['bar-total','bar-usina','bar-gerador','bar-energia'].forEach(id => {
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
    corrente1: (simState.c1 / MULT_DEFAULTS.usina).toFixed(4),
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
document.addEventListener('keydown', (e) => {
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
  if (e.target.tagName === 'INPUT' || e.target.isContentEditable) return;
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
  try {
    localStorage.setItem(LS_E_XAXIS, E_X_AXIS);
    localStorage.setItem(LS_E_YMAX, E_Y_MAX);
  } catch (_) {}
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

function resizeCanvasE() {
  const w = canvasE.offsetWidth, h = canvasE.offsetHeight;
  if (w > 0 && h > 0 && (canvasE.width !== w || canvasE.height !== h)) {
    canvasE.width = w; canvasE.height = h;
  }
}

function drawEnergia() {
  resizeCanvasE();
  const W = canvasE.width, H = canvasE.height;
  ctxE.clearRect(0, 0, W, H);
  const noDataOverlay = document.getElementById('no-data-energia');
  const showNoData = history.labels.length < 2;
  noDataOverlay.style.opacity = showNoData ? '1' : '0';
  noDataOverlay.style.pointerEvents = showNoData ? 'auto' : 'none';
  if (history.labels.length < 2 || W === 0 || H === 0) return;

  const mobileLayout = window.matchMedia('(max-width: 767px)').matches;
  const pad = mobileLayout
    ? { top: 20, right: 20, bottom: 36, left: 64 }
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
    const lbl = (minVal + (i / gridLines) * range).toFixed(1);
    ctxE.fillStyle = getThemeColor('--chart-label', '#9AA5B8'); ctxE.font = `${mobileLayout ? 11 : 9}px "Share Tech Mono"`;
    ctxE.textAlign = 'right'; ctxE.fillText(lbl, pad.left - 4, y + 3);
  }

  // X labels
  const n = sliceLb.length;
  if (n < 2) return;
  const step = Math.max(1, Math.floor(n / (mobileLayout ? 8 : 5)));
  ctxE.fillStyle = getThemeColor('--chart-label', '#9AA5B8'); ctxE.textAlign = 'center'; ctxE.font = `${mobileLayout ? 11 : 9}px "Share Tech Mono"`;
  sliceLb.forEach((lbl, i) => {
    if (i % step === 0) {
      const x = pad.left + (i / (n - 1)) * plotW;
      ctxE.fillText(lbl, x, H - (mobileLayout ? 8 : 5));
    }
  });

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

let eTouchX = null, eTouchY = null;
energiaWrap.addEventListener('touchstart', (e) => {
  eTouchX = e.touches[0].clientX; eTouchY = e.touches[0].clientY;
}, { passive: true });

energiaWrap.addEventListener('touchmove', (e) => {
  if (eTouchX === null) return;
  const dx = eTouchX - e.touches[0].clientX;
  const dy = eTouchY - e.touches[0].clientY;
  const mobileViewport = window.matchMedia('(max-width: 767px)').matches;
  if (Math.abs(dy) > Math.abs(dx)) {
    const allVals  = history.p.map(v => v * MULT_ENERGIA_POTENCIAL);
    const dataMax  = allVals.length ? Math.max(...allVals, 1) : 1;
    const eYBase   = E_Y_MAX > 0 ? E_Y_MAX : dataMax;
    const step     = Math.max(1, Math.round(eYBase * 0.02));
    const maxScroll = Math.max(0, Math.max(dataMax, eYBase) - eYBase);
    if (Math.abs(dy) < 5) return;
    if (mobileViewport && (maxScroll === 0 || (dy > 0 ? eYScrollOffset >= maxScroll : eYScrollOffset <= 0))) return;
    e.preventDefault();
    eYScrollOffset = Math.max(0, Math.min(maxScroll, eYScrollOffset + Math.sign(dy) * step));
    if (chartLinkEnabled) yScrollOffset = eYScrollOffset;
  } else {
    if (E_X_AXIS === 0 || Math.abs(dx) < 5) return;
    const maxOffset = Math.max(0, history.labels.length - E_X_AXIS);
    if (mobileViewport && (maxOffset === 0 || (dx > 0 ? eScrollOffset >= maxOffset : eScrollOffset <= 0))) return;
    e.preventDefault();
    eScrollOffset = Math.max(0, Math.min(maxOffset, eScrollOffset + Math.sign(dx) * 2));
    if (chartLinkEnabled) scrollOffset = eScrollOffset;
  }
  eTouchX = e.touches[0].clientX; eTouchY = e.touches[0].clientY;
  chartLinkEnabled ? drawChart() : drawEnergia();
}, { passive: false });

energiaWrap.addEventListener('touchend', () => { eTouchX = null; eTouchY = null; });

// Chama drawEnergia junto com drawChart
const _drawChartOrig = drawChart;
drawChart = function() { _drawChartOrig(); drawEnergia(); };

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

const chartResizeObserver = new ResizeObserver(() => drawChart());
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
