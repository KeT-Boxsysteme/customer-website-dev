// Dashboard live halten (Betreiber 01.10.: Kacheln live, Kuehlschrank-Alarm sichtbar ohne Neuladen).
// Fragt alle 5 s GET /dashboard/live: Live-Temperatur je Kachel direkt eintragen; aendert sich der
// Zustands-Schluessel einer Box (Ampel, Done, Werte von einem anderen Geraet) oder die Zahl der Boxen,
// aktualisiert sich die Seite per Turbo-Morphing (services/boxState.js, wie public/js/live-sensor.js).
// Morphing ersetzt Elemente und fuehrt dieses Skript nicht erneut aus: Elemente bei JEDER Abfrage neu
// suchen, eine Schleife fuer die ganze Seite (window.__dashboardLive).
(function () {
  const POLL_MS = 5000;
  if (window.__dashboardLive) clearInterval(window.__dashboardLive.timer);   // Skript erneut geladen
  const state = window.__dashboardLive = { timer: null, refreshing: false };

  async function poll() {
    const root = document.querySelector('[data-dashboard-live]');
    if (!root) { clearInterval(state.timer); state.timer = null; return; }   // Seite verlassen (Turbo)
    let data;
    try {
      const res = await fetch(root.dataset.liveUrl, { headers: { Accept: 'application/json' } });
      if (!res.ok) return;   // Stoerung ist kein Befund: Kacheln bleiben, wie sie sind
      data = await res.json();
    } catch (err) {
      return;
    }
    const boxes = data.boxes || [];
    const tiles = document.querySelectorAll('[data-box-tile]');
    let changed = tiles.length !== boxes.length;
    for (const b of boxes) {
      const tile = document.querySelector('[data-box-tile="' + b.id + '"]');
      if (!tile) { changed = true; continue; }
      const t = tile.querySelector('[data-live-temp]');
      if (t) t.textContent = b.temp !== null ? Number(b.temp).toFixed(1) + ' °C' : '— °C';
      if (b.stateKey !== tile.dataset.stateKey) changed = true;
    }
    if (!changed || state.refreshing) return;
    state.refreshing = true;   // Schleife laeuft weiter; nach dem Morphen wieder frei
    if (window.Turbo) window.Turbo.visit(location.href, { action: 'replace' });
    else location.reload();
  }

  if (!window.__dashboardLiveHooked) {
    window.__dashboardLiveHooked = true;
    const after = () => {
      const st = window.__dashboardLive;
      if (!st) return;
      st.refreshing = false;
      if (document.querySelector('[data-dashboard-live]') && !st.timer) st.timer = setInterval(st.poll, POLL_MS);
    };
    document.addEventListener('turbo:morph', after);
    document.addEventListener('turbo:render', after);
  }

  state.poll = poll;
  state.timer = setInterval(poll, POLL_MS);
})();
