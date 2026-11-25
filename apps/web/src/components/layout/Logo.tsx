/** Logo dashboard (`data/logo 2.png`, rasio 650:773), dirasterisasi ke WebP tinggi 96/192 px. */
export function Logo({ size = 40 }: { size?: number }) {
  return (
    <img
      src="/logo-96.webp"
      srcSet="/logo-96.webp 1x, /logo-192.webp 2x"
      alt="Logo Dashboard Bapperida Kulon Progo"
      width={Math.round((size * 650) / 773)}
      height={size}
      decoding="async"
      className="shrink-0 object-contain"
      style={{ height: size, width: 'auto' }}
    />
  );
}
