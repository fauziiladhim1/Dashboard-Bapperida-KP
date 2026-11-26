// Fitur animasi motion (domMax: termasuk layoutId di AuthPage) dimuat terpisah dari bundel awal. Komponen `m`
// tampil tanpa animasi selama chunk ini belum tiba (pola LazyMotion async dari dokumentasi motion).
export { domMax as default } from 'motion/react';
