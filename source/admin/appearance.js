// Carry the blog's theme into its standalone administration documents.
(function () {
  const system = matchMedia('(prefers-color-scheme: dark)');
  function apply() {
    let theme;
    try { theme = localStorage.getItem('nisconder-theme'); } catch {}
    if (theme !== 'light' && theme !== 'dark') theme = system.matches ? 'dark' : 'light';
    document.documentElement.style.colorScheme = theme;
    document.documentElement.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]').content = theme === 'dark' ? '#0b1114' : '#f6f8f7';
  }
  apply();
  system.addEventListener('change', apply);
  window.addEventListener('pageshow', apply);
  window.addEventListener('storage', (event) => { if (event.key === 'nisconder-theme' || event.key === null) apply(); });
}());
