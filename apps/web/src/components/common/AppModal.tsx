import { Modal } from '@heroui/react';
import type { ReactNode } from 'react';

/**
 * Modal HeroUI yang selalu terbuka selama dirender; menutup lewat `onClose` (Esc, tombol X, dan backdrop).
 * `dismissable={false}` untuk form: klik backdrop yang tak sengaja tidak membuang isian. `footer` = tombol aksi yang tetap
 * terlihat di dasar modal (tidak ikut tergulir bersama isi panjang).
 */
export function AppModal({ title, description, onClose, size = 'md', dismissable = true, footer, children }: { title: ReactNode; description?: ReactNode; onClose: () => void; size?: 'md' | 'lg' | 'xl'; dismissable?: boolean; footer?: ReactNode; children: ReactNode }) {
  return (
    <Modal.Backdrop isOpen isDismissable={dismissable} onOpenChange={(o) => !o && onClose()}>
      <Modal.Container scroll="inside" className={{ md: 'sm:max-w-lg', lg: 'sm:max-w-2xl', xl: 'sm:max-w-5xl' }[size]}>
        {/* max-w-none: lebar mengikuti container (md 32rem / lg 42rem), bukan batas 448px bawaan Modal.Dialog. */}
        <Modal.Dialog className="max-h-[92dvh] w-full max-w-none">
          <Modal.CloseTrigger />
          <Modal.Header className="flex-col items-start gap-1">
            <Modal.Heading>{title}</Modal.Heading>
            {description && <p className="text-sm text-muted">{description}</p>}
          </Modal.Header>
          <Modal.Body className="flex flex-col gap-4">{children}</Modal.Body>
          {footer && <Modal.Footer className="flex justify-end gap-2">{footer}</Modal.Footer>}
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}
