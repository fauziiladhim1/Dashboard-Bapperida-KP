import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** Kapital hanya huruf pertama ("Tata Ruang" -> "Tata ruang"); singkatan semua-kapital (SRS, PJU) dibiarkan. */
export const sentenceCase = (s: string) =>
  s.split(' ').map((w, i) => (i === 0 ? w[0]!.toUpperCase() + w.slice(1) : /^[A-Z0-9]{2,}$/.test(w) ? w : w.toLowerCase())).join(' ');
