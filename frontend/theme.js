/* One accessible theme switch shared by Login, Generator and Administration. */
(() => {
  const key = 'signaturee.theme';
  let saved = null;
  try { saved = localStorage.getItem(key); } catch {}
  const apply = (mode) => {
    const theme = mode === 'light' ? 'light' : 'dark';
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
  };
  apply(saved || 'light');

  document.addEventListener('DOMContentLoaded', () => {
    const slot = document.querySelector('.top-actions') ||
      document.querySelector('.login-card .brand-row');
    if (!slot) return;
    const button = document.createElement('button');
    button.id = 'themeToggle';
    button.type = 'button';
    button.className = 'theme-toggle secondary';
    button.setAttribute('aria-label','Erscheinungsbild wechseln');
    button.setAttribute('title','Zwischen hellem und dunklem Design wechseln');
    const refresh = () => {
      const isDark = document.documentElement.dataset.theme === 'dark';
      button.textContent = isDark ? 'Hell' : 'Dunkel';
      button.setAttribute('aria-pressed',String(isDark));
    };
    refresh();
    button.addEventListener('click', () => {
      const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
      apply(next);
      try { localStorage.setItem(key,next); } catch {}
      refresh();
    });
    slot.prepend(button);
  });
})();
