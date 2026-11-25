// Pasang tema & bahasa sebelum React dirender agar tidak berkedip. File terpisah karena CSP melarang inline script.
try {
  var t = localStorage.getItem('theme') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  document.documentElement.classList.add(t === 'dark' ? 'dark' : 'light');
  document.documentElement.lang = localStorage.getItem('lang') || 'id';
} catch (e) {}

// Aktifkan stylesheet font yang dimuat async (lihat index.html).
var f = document.querySelector('link[data-async-font]');
if (f) {
  if (f.sheet) f.media = 'all';
  else f.addEventListener('load', function () { f.media = 'all'; });
}
