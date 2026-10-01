// Meldungs-Pillen (Betreiber 01.10.): Bestaetigung verschwindet nach 5 s, Fehler bleibt bis zum Wegklicken.
// Der Server rendert sie an Ort und Stelle (views/partials/flash.ejs); hier wandern sie in den Stapel
// #toast-stack (Footer, data-turbo-permanent: bleibt bei Morphing und Seitenwechsel stehen).
// Fund 01.10.: Nach einem Formular mit Weiterleitung auf dieselbe Seite morpht Turbo nur und fuehrt dieses
// Skript NICHT erneut aus -> zusaetzlich auf turbo:load/render/morph uebernehmen; jede Pille nur einmal.
(function () {
  const AUTOCLOSE_MS = 5000;
  function close(el) {
    if (!el || el.dataset.closing) return;
    el.dataset.closing = '1';
    el.classList.add('is-leaving');
    setTimeout(() => el.remove(), 250);
  }
  function adopt() {
    const stack = document.getElementById('toast-stack');
    document.querySelectorAll('[data-toast]:not([data-adopted])').forEach(el => {
      el.dataset.adopted = '1';
      // dieselbe Meldung steht schon im Stapel (z. B. zweimal "Please log in") -> nicht doppelt zeigen
      const same = stack && Array.from(stack.children).some(o => o !== el && !o.dataset.closing &&
        o.className === el.className && o.textContent === el.textContent);
      if (same) { el.remove(); return; }
      if (stack && !stack.contains(el)) stack.appendChild(el);
      if (el.hasAttribute('data-autoclose')) setTimeout(() => close(el), AUTOCLOSE_MS);
    });
  }
  if (!window.__toastHooked) {
    window.__toastHooked = true;
    document.addEventListener('click', e => {
      const btn = e.target.closest && e.target.closest('.toast__close');
      if (btn) close(btn.closest('[data-toast]'));
    });
    ['turbo:load', 'turbo:render', 'turbo:morph'].forEach(ev => document.addEventListener(ev, adopt));
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', adopt);
  else adopt();
})();

// Menue-Knopf fuer schmale Bildschirme (Handy/Tablet): klappt die Navigation auf und zu
(function () {
  function bindNavToggle() {
    const btn = document.querySelector('.nav-toggle');
    const nav = btn && btn.closest('.sidebar');
    if (!btn || !nav || btn.dataset.bound) return;
    btn.dataset.bound = '1';
    btn.addEventListener('click', () => {
      const open = nav.classList.toggle('is-open');
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bindNavToggle);
  else bindNavToggle();
})();

// Nutz-Nummer in der Benutzerverwaltung: versteckt, Klick zeigt bzw. versteckt sie wieder (Betreiber 01.10.)
document.addEventListener('click', e => {
  const btn = e.target.closest('[data-access-code]');
  if (!btn) return;
  const shown = btn.getAttribute('aria-pressed') === 'true';
  btn.setAttribute('aria-pressed', String(!shown));
  btn.setAttribute('aria-label', shown ? 'Show access number' : 'Hide access number');
  btn.querySelector('[data-access-code-value]').textContent = shown ? '••••••' : btn.dataset.accessCode;
  btn.querySelector('[data-access-code-action]').textContent = shown ? 'Show' : 'Hide';
});
