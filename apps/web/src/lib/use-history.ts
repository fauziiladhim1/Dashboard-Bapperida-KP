import { useCallback, useEffect, useState } from 'react';

/**
 * Riwayat urungkan/ulangi (Ctrl+Z / Ctrl+Y) untuk satu nilai. `set(v, true)` mengganti langkah terakhir tanpa
 * menambah riwayat: dipakai saat mengetik, agar satu kata tidak jadi belasan langkah urungkan.
 */
// ponytail: riwayat tak terbatas dalam sesi; batasi panjang `past` bila nilainya besar.
export function useHistory<T>(initial: T) {
  const [h, setH] = useState<{ past: T[]; now: T; future: T[] }>({ past: [], now: initial, future: [] });
  const set = useCallback((next: T, replace = false) =>
    setH((s) => ({ past: replace ? s.past : [...s.past, s.now], now: next, future: [] })), []);
  const undo = useCallback(() => setH((s) => (s.past.length ? { past: s.past.slice(0, -1), now: s.past.at(-1)!, future: [s.now, ...s.future] } : s)), []);
  const redo = useCallback(() => setH((s) => (s.future.length ? { past: [...s.past, s.now], now: s.future[0]!, future: s.future.slice(1) } : s)), []);
  return { value: h.now, set, undo, redo, canUndo: h.past.length > 0, canRedo: h.future.length > 0 };
}

/** Pintasan Ctrl/⌘+Z (urungkan) dan Ctrl+Y / Ctrl+Shift+Z (ulangi) selama `active`; diabaikan saat mengetik di isian. */
export function useUndoKeys(active: boolean, undo: () => void, redo: () => void) {
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || (e.target as HTMLElement | null)?.closest('input, textarea, [contenteditable="true"]')) return;
      const k = e.key.toLowerCase();
      if (k === 'z' && !e.shiftKey) { e.preventDefault(); undo(); } else if (k === 'y' || (k === 'z' && e.shiftKey)) { e.preventDefault(); redo(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, undo, redo]);
}
