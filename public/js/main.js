// Flash messages auto-dismiss (errors stay longer).
// Laeuft sofort, falls die Seite schon steht: unter Turbo (Seitenwechsel ohne Neuladen) feuert
// DOMContentLoaded nach einem Wechsel nicht mehr, dieses Skript wird aber je Besuch neu ausgefuehrt.
(function () {
  function dismissFlashes() {
    document.querySelectorAll('.flash').forEach(el => {
      var delay = el.classList.contains('flash-error') ? 8000 : 5000;
      setTimeout(() => {
        el.style.transition = 'opacity 0.5s';
        el.style.opacity = '0';
        setTimeout(() => el.remove(), 500);
      }, delay);
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', dismissFlashes);
  else dismissFlashes();
})();
