import Swal from 'sweetalert2';

/**
 * Warna Swal dari token aplikasi di index.css (`.swal2-container`), jadi ikut class `dark`/`light` pada <html>
 * tanpa opsi `theme`. Tombol utama di kanan, "Tidak"/batal di kiri.
 */
const base = () => Swal.mixin({ reverseButtons: true });

/** Notifikasi singkat (toast pojok kanan bawah). */
export const toast = (title: string, icon: 'success' | 'error' = 'success', text?: string) =>
  void base().fire({ toast: true, position: 'bottom-end', icon, title, text, timer: text ? 6000 : 3000, timerProgressBar: true, showConfirmButton: false });

export const toastError = (title: string, text?: string) => toast(title, 'error', text);

/**
 * `subject`: nama data yang diubah/dihapus, ditampilkan menonjol di bawah teks.
 * `target`: pasang dialog di dalam elemen ini (mis. modal yang mengunci fokus), agar tombol Ya/Tidak tetap bisa difokus.
 */
type Confirm = { title: string; text: string; confirm: string; cancel: string; subject?: string; target?: HTMLElement | null };

const ask = async (c: Confirm, danger: boolean): Promise<boolean> =>
  (await base().fire({
    ...(c.target && { target: c.target }),
    icon: danger ? 'warning' : 'question',
    title: c.title,
    text: c.text,
    // Nama data dipasang lewat textContent (berasal dari pengguna), bukan diinterpolasi ke HTML.
    didOpen: (popup) => {
      if (!c.subject) return;
      const el = Object.assign(document.createElement('div'), { className: 'swal-subject', textContent: c.subject });
      popup.querySelector('.swal2-html-container')?.append(el);
    },
    showCancelButton: true,
    confirmButtonText: c.confirm,
    cancelButtonText: c.cancel,
    customClass: danger ? { confirmButton: 'swal-danger' } : {},
    // Hapus: fokus awal di "Tidak" agar Enter tidak langsung menghapus.
    focusCancel: danger,
  })).isConfirmed;

/** Konfirmasi Ya/Tidak untuk aksi berbahaya (hapus). Resolve true bila "Ya". */
export const confirmDanger = (c: Confirm) => ask(c, true);

/** Konfirmasi Ya/Tidak sebelum menyimpan perubahan data. Resolve true bila "Ya". */
export const confirmEdit = (c: Confirm) => ask(c, false);

/** Pesan sukses besar (mis. pendaftaran terkirim, unggahan selesai). */
export const success = async (title: string, text: string, ok: string): Promise<boolean> =>
  (await base().fire({ icon: 'success', title, text, confirmButtonText: ok })).isConfirmed;

