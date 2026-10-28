// EIN Diagramm mit allen Werten (Betreiber 02.10.): links ppm (O2, H2O), rechts °C (Kuehlschrank mit Soll + Grenzen +
// Min–Max-Band wie bisher, Boxtemperatur als reine Info). Live (Betreiber 28.10.): alle 30 s frische Daten von
// GET /diagrams/:id/data, neuester Live-Wert als Punkt. Einzelne Messpunkte werden als Punkt gezeichnet (Fund 28.10.:
// ein einziger Mittelwert ergab keine sichtbare Linie). Turbo fuehrt das Skript je Besuch aus -> eine Schleife je Seite.
(function () {
  const POLL_MS = 30000;
  if (window.__diagramLive) clearInterval(window.__diagramLive.timer);
  const state = window.__diagramLive = { timer: null, chart: null };

  const C = { o2: '#1565c0', h2o: '#0f766e', fridge: '#d97706', band: 'rgba(245,158,11,0.18)', box: '#7c3aed',
              target: '#2e7d32', yellow: '#f59e0b', red: '#e53935', manual: '#1e293b' };

  // Wenige Punkte -> sichtbar machen, viele -> nur Linie
  const dots = data => (data.filter(p => p.y !== null).length <= 3 ? 3 : 0);

  function hline(label, y, color, dash, xs) {
    return { label, data: [{ x: xs[0], y }, { x: xs[1], y }], borderColor: color, borderWidth: 1, borderDash: dash,
             pointRadius: 0, fill: false, tension: 0, yAxisID: 'temp', order: 9 };
  }

  function datasets(c) {
    const xs = [c.window.from, c.window.to];
    const out = [];
    // ppm nur mit Werten im Zeitraum (Fund 28.10.: leere linke Achse verschwendete Platz)
    if (c.ppm && c.ppm.hasData) {
      if (c.ppm.o2) out.push({ label: 'O₂ (ppm)', data: c.ppm.o2, borderColor: C.o2, backgroundColor: C.o2, tension: 0.2, pointRadius: 3, yAxisID: 'ppm' });
      if (c.ppm.h2o) out.push({ label: 'H₂O (ppm)', data: c.ppm.h2o, borderColor: C.h2o, backgroundColor: C.h2o, tension: 0.2, pointRadius: 3, yAxisID: 'ppm' });
    }
    if (c.temp) {
      const t = c.temp;
      out.push({ label: 'Max', data: t.max, borderWidth: 0, pointRadius: 0, fill: false, backgroundColor: C.band, yAxisID: 'temp' });
      out.push({ label: 'Min', data: t.min, borderWidth: 0, pointRadius: 0, fill: '-1', backgroundColor: C.band, yAxisID: 'temp' });
      out.push({ label: 'Fridge (°C)', data: t.avg, borderColor: C.fridge, backgroundColor: C.fridge, borderWidth: 2,
                 pointRadius: dots(t.avg), tension: 0.2, fill: false, yAxisID: 'temp' });
      if (t.manual.length) out.push({ label: 'Fridge, manual', data: t.manual, borderColor: C.manual, backgroundColor: C.manual,
                                      showLine: false, pointRadius: 4, yAxisID: 'temp' });
      if (c.live.fridge) out.push({ label: 'Fridge now', data: [c.live.fridge], borderColor: C.fridge, backgroundColor: '#fff',
                                    borderWidth: 2, pointRadius: 5, showLine: false, yAxisID: 'temp' });
      if (t.target !== null) {
        out.push(hline('Target', t.target, C.target, [], xs));
        out.push(hline('±' + t.limits.yellow + ' °C', t.target + t.limits.yellow, C.yellow, [3, 3], xs));
        out.push(hline('', t.target - t.limits.yellow, C.yellow, [3, 3], xs));
        out.push(hline('±' + t.limits.red + ' °C', t.target + t.limits.red, C.red, [6, 4], xs));
        out.push(hline('', t.target - t.limits.red, C.red, [6, 4], xs));
      }
    }
    if (c.boxTemp) {
      out.push({ label: 'Box (°C)', data: c.boxTemp.avg, borderColor: C.box, backgroundColor: C.box, borderWidth: 2,
                 pointRadius: dots(c.boxTemp.avg), tension: 0.2, fill: false, yAxisID: 'temp' });
      if (c.live.box) out.push({ label: 'Box now', data: [c.live.box], borderColor: C.box, backgroundColor: '#fff',
                                 borderWidth: 2, pointRadius: 5, showLine: false, yAxisID: 'temp' });
    }
    return out;
  }

  function options(c) {
    const w = c.window;
    const short = w.to - w.from <= 2 * 24 * 3600 * 1000;
    const fmtTick = ms => short
      ? new Date(ms).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
      : new Date(ms).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
    const fmtFull = ms => new Date(ms).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
    const hasTemp = !!(c.temp || c.boxTemp);
    const ppm = !!(c.ppm && c.ppm.hasData);
    const scales = {
      x: { type: 'linear', min: w.from, max: w.to, grid: { display: false },
           ticks: { callback: v => fmtTick(v), maxTicksLimit: window.innerWidth < 600 ? 4 : 8 } }
    };
    if (ppm) scales.ppm = { position: 'left', beginAtZero: true, suggestedMax: 12, title: { display: true, text: 'ppm' } };
    if (hasTemp) scales.temp = { position: ppm ? 'right' : 'left', title: { display: true, text: '°C' },
                                 grid: { drawOnChartArea: !ppm } };
    return {
      responsive: true, maintainAspectRatio: false, animation: false,
      interaction: { mode: 'nearest', axis: 'x', intersect: false },
      scales,
      plugins: {
        legend: { position: 'top', labels: { boxWidth: 12, usePointStyle: true,
                  filter: item => item.text && item.text !== 'Max' && item.text !== 'Min' } },
        tooltip: { callbacks: { title: items => items.length ? fmtFull(items[0].parsed.x) : '' } }
      }
    };
  }

  function draw(c) {
    const el = document.getElementById('mainChart');
    if (!el || !window.Chart) return;
    if (state.chart && state.chart.canvas === el) {
      state.chart.data.datasets = datasets(c);
      state.chart.options = options(c);
      state.chart.update('none');
    } else {
      if (state.chart) state.chart.destroy();
      state.chart = new Chart(el, { type: 'line', data: { datasets: datasets(c) }, options: options(c) });
    }
  }

  async function poll() {
    const el = document.getElementById('mainChart');
    if (!el) { clearInterval(state.timer); state.timer = null; return; }   // Seite verlassen
    try {
      const res = await fetch(el.dataset.liveUrl, { headers: { Accept: 'application/json' } });
      if (!res.ok) return;   // Stoerung ist kein Befund: altes Bild bleibt stehen
      const d = await res.json();
      draw(Object.assign({}, d.charts, { window: d.window }));
      const stamp = document.querySelector('[data-chart-updated]');
      if (stamp) stamp.textContent = 'Updated ' + new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    } catch (e) { /* Netz weg: naechster Versuch in 30 s */ }
  }

  const src = document.getElementById('chartData');
  if (src) draw(JSON.parse(src.textContent));
  state.timer = setInterval(poll, POLL_MS);
})();
