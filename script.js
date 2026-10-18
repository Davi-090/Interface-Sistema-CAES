// ── Data store ──────────────────────────────────────────────
const MAX_POINTS = 1200;
const LS_HISTORY = 'caes_history';

const history = {
  labels: [],
  c1:     [],
  c2:     [],
  p:      []
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
    }
  } catch(_) {}
})();

// ── Chart setup ─────────────────────────────────────────────
const canvas = document.getElementById('chart');
const ctx = canvas.getContext('2d');
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
let X_AXIS       = Math.max(0, parseInt(localStorage.getItem(LS_XAXIS) || '0', 10));
let scrollOffset  = 0;   // X scroll — pontos atrás no histórico
let yScrollOffset = 0;   // Y scroll — deslocamento para cima do viewport

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
  try { localStorage.setItem(LS_XAXIS, n); } catch(_) {}
  drawChart();
}

function drawChart() {
  resizeCanvas();
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);

  if (history.labels.length < 2 || W === 0 || H === 0) return;

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
    ctx.fillStyle = 'rgba(255,184,0,0.18)';
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
  ctx.strokeStyle = 'rgba(42,48,64,0.8)';
  ctx.lineWidth = 1;
  const gridLines = 5;
  for (let i = 0; i <= gridLines; i++) {
    const y = pad.top + plotH - (i / gridLines) * plotH;
    ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(pad.left + plotW, y); ctx.stroke();
    const label = (minVal + (i / gridLines) * range).toFixed(1);
    ctx.fillStyle = '#9AA5B8';
    ctx.font = '11px "Share Tech Mono"';
    ctx.textAlign = 'right';
    ctx.fillText(label, pad.left - 8, y + 4);
  }

  // X labels
  const n = sliceLb.length;
  const step = Math.max(1, Math.floor(n / 8));
  ctx.fillStyle = '#9AA5B8';
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

    ctx.save();
    ctx.shadowColor = color; ctx.shadowBlur = 8;
    ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.lineJoin = 'round';
    ctx.beginPath();
    clamped.forEach((v, i) => {
      const x = pad.left + (i / (n - 1)) * plotW;
      const y = pad.top + plotH - ((v - minVal) / range) * plotH;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.stroke();
    ctx.restore();

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
}

function hexToRgba(hex, alpha) {
  const r = parseInt(hex.slice(1,3),16);
  const g = parseInt(hex.slice(3,5),16);
  const b = parseInt(hex.slice(5,7),16);
  return `rgba(${r},${g},${b},${alpha})`;
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

function pushHistory(label, c1, c2, p) {
  history.labels.push(label);
  history.c1.push(c1);
  history.c2.push(c2);
  history.p.push(p);
  if (history.labels.length > MAX_POINTS) {
    history.labels.shift();
    history.c1.shift();
    history.c2.shift();
    history.p.shift();
  }
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
  pushHistory(ts.slice(3), c1, c2, p);
  updateNoData();
  drawChart();
}

// ── Serial (Web Serial API) ──────────────────────────────────
let port, reader, readLoop;
let connected = false;

function updateNoData() {
  const show = history.labels.length === 0;
  elNoData.style.opacity       = show ? '1' : '0';
  elNoData.style.pointerEvents = show ? 'auto' : 'none';
}

function setConnected(state, msg) {
  connected = state;
  if (state) {
    btnConn.textContent = '⬡  DESCONECTAR  ⬡';
  } else {
    btnConn.textContent = msg === 'ERRO' ? '⬡      ERRO     ⬡' : '⬡    CONECTAR   ⬡';
  }
  btnConn.className = state ? 'connected' : '';
  updateNoData();
}

async function connect() {
  if (!('serial' in navigator)) {
    alert('Web Serial API não suportada neste browser.\nUse o Google Chrome ou Microsoft Edge (versão recente).');
    return;
  }
  try {
    port = await navigator.serial.requestPort();
    await port.open({ baudRate: 9600 });
    setConnected(true, 'CONECTADO');

    const decoder = new TextDecoderStream();
    port.readable.pipeTo(decoder.writable);
    const inputStream = decoder.readable;
    reader = inputStream.getReader();

    let buffer = '';
    readLoop = (async () => {
      while (true) {
        const { value, done } = await reader.read();
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
    })();
  } catch (e) {
    console.error('Erro ao conectar:', e);
    if (e.name === 'NotFoundError') {
      // usuário cancelou a seleção de porta — não é erro real
      setConnected(false, 'DESCONECTADO');
      return;
    }
    setConnected(false, 'ERRO');
    let msg = 'Falha ao conectar com o Arduino.\n\n';
    if (e.name === 'NetworkError' || /already open|failed to open/i.test(e.message)) {
      msg += 'A porta serial já está sendo usada por outro programa.\n\n'
           + 'Verifique se:\n'
           + '• O Arduino IDE (Serial Monitor / Serial Plotter) está fechado\n'
           + '• Nenhuma outra aba do navegador está conectada à porta\n'
           + '• Nenhum outro software (PuTTY, etc.) está usando a porta COM';
    } else {
      msg += 'Erro: ' + e.name + ' — ' + e.message;
    }
    alert(msg);
  }
}

async function disconnect() {
  try {
    if (reader)  { await reader.cancel(); reader = null; }
    if (port)    { await port.close();    port   = null; }
  } catch {}
  setConnected(false, 'DESCONECTADO');
}

btnConn.addEventListener('click', () => {
  connected ? disconnect() : connect();
});

// ── Scroll: mouse wheel ──────────────────────────────────────
const chartWrap = document.querySelector('.chart-wrap');

chartWrap.addEventListener('wheel', (e) => {
  e.preventDefault();
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
    yScrollOffset  = Math.max(0, Math.min(maxYScroll, yScrollOffset - delta * step));
  } else {
    // Scroll normal → move X (histórico)
    if (X_AXIS === 0) return;
    const delta = Math.sign(e.deltaX || e.deltaY);
    const maxOffset = Math.max(0, history.labels.length - X_AXIS);
    scrollOffset = Math.max(0, Math.min(maxOffset, scrollOffset + delta * 3));
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
  e.preventDefault();
  const dx = touchStartX - e.touches[0].clientX;
  const dy = touchStartY - e.touches[0].clientY;

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
    // dy > 0 = dedo subiu = queremos ver mais para cima
    yScrollOffset  = Math.max(0, Math.min(maxYScroll, yScrollOffset + Math.sign(dy) * step));
  } else {
    // Swipe horizontal → X scroll
    if (X_AXIS === 0 || Math.abs(dx) < 5) return;
    const maxOffset = Math.max(0, history.labels.length - X_AXIS);
    scrollOffset = Math.max(0, Math.min(maxOffset, scrollOffset + Math.sign(dx) * 2));
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
  try { localStorage.setItem(LS_YMAX, Y_MAX); } catch(_) {}
  drawChart();
}

// ── Clear: reseta scroll e sidebar ───────────────────────────
function clearChart() {
  history.labels.length = 0;
  history.c1.length     = 0;
  history.c2.length     = 0;
  history.p.length      = 0;
  scrollOffset  = 0;
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
    corrente1: simState.c1.toFixed(2),
    corrente2: simState.c2.toFixed(2),
    pressao:   simState.p.toFixed(1),
    rele: 'false',
  });
}

function toggleSim() {
  if (connected) return;
  if (simInterval) {
    clearInterval(simInterval);
    simInterval = null;
    const btn = document.getElementById('btn-sim');
    if (btn) { btn.textContent = '⬡   SIMULANDO   ⬡'; btn.className = ''; }
    btnConn.textContent = '⬡    CONECTAR   ⬡';
    btnConn.className = '';
  } else {
    simInterval = setInterval(simStep, 500);
    simStep();
    const btn = document.getElementById('btn-sim');
    if (btn) { btn.textContent = '⬡ PARAR SIM ⬡'; btn.className = 'simulating'; }
    btnConn.textContent = '⬡   SIMULANDO   ⬡';
    btnConn.className = 'simulating';
  }
}

// ── Keyboard: Tab×2 = simulação ──────────────────────────────
let tabCount = 0, tabTimer = null;
document.addEventListener('keydown', (e) => {
  if (e.key === 'Tab') {
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

function onEAxisChange(axis, val) {
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

  const pad = { top: 14, right: 16, bottom: 24, left: 38 };
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
    ctxE.fillStyle = 'rgba(255,184,0,0.12)';
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
  ctxE.strokeStyle = 'rgba(42,48,64,0.8)'; ctxE.lineWidth = 1;
  const gridLines = 4;
  for (let i = 0; i <= gridLines; i++) {
    const y = pad.top + plotH - (i / gridLines) * plotH;
    ctxE.beginPath(); ctxE.moveTo(pad.left, y); ctxE.lineTo(pad.left + plotW, y); ctxE.stroke();
    const lbl = (minVal + (i / gridLines) * range).toFixed(1);
    ctxE.fillStyle = '#9AA5B8'; ctxE.font = '9px "Share Tech Mono"';
    ctxE.textAlign = 'right'; ctxE.fillText(lbl, pad.left - 4, y + 3);
  }

  // X labels
  const n = sliceLb.length;
  if (n < 2) return;
  const step = Math.max(1, Math.floor(n / 5));
  ctxE.fillStyle = '#9AA5B8'; ctxE.textAlign = 'center'; ctxE.font = '9px "Share Tech Mono"';
  sliceLb.forEach((lbl, i) => {
    if (i % step === 0) {
      const x = pad.left + (i / (n - 1)) * plotW;
      ctxE.fillText(lbl, x, H - 5);
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
  ctxE.save();
  ctxE.shadowColor = color; ctxE.shadowBlur = 6;
  ctxE.strokeStyle = color; ctxE.lineWidth = 1.5; ctxE.lineJoin = 'round';
  ctxE.beginPath();
  clamped.forEach((v, i) => {
    const x = pad.left + (i / (n - 1)) * plotW;
    const y = pad.top + plotH - ((v - minVal) / range) * plotH;
    i === 0 ? ctxE.moveTo(x, y) : ctxE.lineTo(x, y);
  });
  ctxE.stroke(); ctxE.restore();

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
  e.preventDefault();
  if (e.shiftKey) {
    const allVals  = history.p.map(v => v * MULT_ENERGIA_POTENCIAL);
    const dataMax  = allVals.length ? Math.max(...allVals, 1) : 1;
    const eYBase   = E_Y_MAX > 0 ? E_Y_MAX : dataMax;
    const step     = Math.max(1, Math.round(eYBase * 0.05));
    const maxScroll = Math.max(0, Math.max(dataMax, eYBase) - eYBase);
    eYScrollOffset = Math.max(0, Math.min(maxScroll, eYScrollOffset - Math.sign(e.deltaY) * step));
  } else {
    if (E_X_AXIS === 0) return;
    const maxOffset = Math.max(0, history.labels.length - E_X_AXIS);
    eScrollOffset = Math.max(0, Math.min(maxOffset, eScrollOffset + Math.sign(e.deltaX || e.deltaY) * 3));
  }
  drawEnergia();
}, { passive: false });

let eTouchX = null, eTouchY = null;
energiaWrap.addEventListener('touchstart', (e) => {
  eTouchX = e.touches[0].clientX; eTouchY = e.touches[0].clientY;
}, { passive: true });

energiaWrap.addEventListener('touchmove', (e) => {
  if (eTouchX === null) return;
  e.preventDefault();
  const dx = eTouchX - e.touches[0].clientX;
  const dy = eTouchY - e.touches[0].clientY;
  if (Math.abs(dy) > Math.abs(dx)) {
    const allVals  = history.p.map(v => v * MULT_ENERGIA_POTENCIAL);
    const dataMax  = allVals.length ? Math.max(...allVals, 1) : 1;
    const eYBase   = E_Y_MAX > 0 ? E_Y_MAX : dataMax;
    const step     = Math.max(1, Math.round(eYBase * 0.02));
    const maxScroll = Math.max(0, Math.max(dataMax, eYBase) - eYBase);
    eYScrollOffset = Math.max(0, Math.min(maxScroll, eYScrollOffset + Math.sign(dy) * step));
  } else {
    if (E_X_AXIS === 0 || Math.abs(dx) < 5) return;
    const maxOffset = Math.max(0, history.labels.length - E_X_AXIS);
    eScrollOffset = Math.max(0, Math.min(maxOffset, eScrollOffset + Math.sign(dx) * 2));
  }
  eTouchX = e.touches[0].clientX; eTouchY = e.touches[0].clientY;
  drawEnergia();
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
const sidebarMinWidth = 330;

function setSidebarWidth(width, save = false) {
  const maxWidth = Math.max(sidebarMinWidth, mainLayout.clientWidth - 338);
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
