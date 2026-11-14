/* Keep the existing navigation available as a compact disclosure on phones. */
(() => {
  const gallery = document.getElementById('gallery');
  const menu = document.getElementById('mobileMenu');
  function close() {
    gallery.classList.remove('menu-open');
    menu.setAttribute('aria-expanded', 'false');
  }
  menu.addEventListener('click', () => {
    const open = gallery.classList.toggle('menu-open');
    menu.setAttribute('aria-expanded', String(open));
  });
  document.getElementById('mobileNav').addEventListener('click', event => {
    if (event.target.closest('nav button')) { close(); menu.focus(); }
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && gallery.classList.contains('menu-open')) { close(); menu.focus(); }
  });
  addEventListener('hashchange', close);
})();
