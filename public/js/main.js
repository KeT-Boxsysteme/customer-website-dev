// Flash messages auto-dismiss (errors stay longer)
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.flash').forEach(el => {
    var delay = el.classList.contains('flash-error') ? 8000 : 5000;
    setTimeout(() => {
      el.style.transition = 'opacity 0.5s';
      el.style.opacity = '0';
      setTimeout(() => el.remove(), 500);
    }, delay);
  });
});
