// Pasang tema & bahasa sebelum React dirender agar tidak berkedip. File terpisah karena CSP melarang inline script.
try {
  var t = localStorage.getItem('theme') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  document.documentElement.classList.add(t === 'dark' ? 'dark' : 'light');
  document.documentElement.lang = localStorage.getItem('lang') || 'id';
} catch (e) {}
