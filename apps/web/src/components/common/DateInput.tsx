import { Calendar, DateField, DatePicker, Label } from '@heroui/react';
import { parseDate, type CalendarDate, type DateValue } from '@internationalized/date';
import { useState } from 'react';

/** 'YYYY-MM-DD' → tanggal kalender; kosong/tidak sah = null (tidak melempar). */
const toDate = (s?: string | null): CalendarDate | null => {
  try { return s ? parseDate(s.slice(0, 10)) : null; } catch { return null; }
};

/**
 * Pemilih tanggal tunggal seragam di seluruh aplikasi (pengganti `<input type="date">` bawaan browser yang tampilannya
 * beda tiap browser): kotak isian setinggi Input, kalender di popover bergaya sama dengan dropdown (radius, bayangan,
 * sorot item). Nilai keluar-masuk tetap string ISO `YYYY-MM-DD`; dengan `name`, ikut terkirim di FormData.
 */
export function DateInput({ id, label, hideLabel, value, defaultValue, onChange, name, max, isRequired, isDisabled, isReadOnly, className }: {
  id?: string; label: string; hideLabel?: boolean;
  value?: string | null; defaultValue?: string | null; onChange?: (v: string | null) => void;
  name?: string; max?: string; isRequired?: boolean; isDisabled?: boolean; isReadOnly?: boolean; className?: string;
}) {
  // Isi kotak disimpan sendiri: tahun yang sedang diketik (0002 → 0020 → 0202) tampil apa adanya tetapi tidak dikirim
  // ke induk, jadi tidak tersimpan tiap ketukan. Nilai dari induk berubah (mis. data dimuat ulang) = isi ikut berganti.
  const [cur, setCur] = useState<DateValue | null>(() => toDate(value ?? defaultValue));
  const [prev, setPrev] = useState(value);
  if (value !== prev) {
    setPrev(value);
    if (value !== undefined && (cur?.toString() ?? null) !== (value || null)) setCur(toDate(value));
  }
  return (
    <DatePicker id={id} name={name} aria-label={hideLabel ? label : undefined} isRequired={isRequired} isDisabled={isDisabled} isReadOnly={isReadOnly}
      maxValue={toDate(max)} value={cur}
      onChange={(d) => { setCur(d); if (!d || d.year >= 1000) onChange?.(d ? d.toString() : null); }} className={className ?? 'flex w-full flex-col gap-2'}>
      {!hideLabel && <Label>{label}</Label>}
      <DateField.Group>
        <DateField.Input>{(segment) => <DateField.Segment segment={segment} />}</DateField.Input>
        <DateField.Suffix>
          <DatePicker.Trigger aria-label={label}><DatePicker.TriggerIndicator /></DatePicker.Trigger>
        </DateField.Suffix>
      </DateField.Group>
      <DatePicker.Popover>
        <Calendar aria-label={label}>
          <Calendar.Header>
            <Calendar.YearPickerTrigger>
              <Calendar.YearPickerTriggerHeading />
              <Calendar.YearPickerTriggerIndicator />
            </Calendar.YearPickerTrigger>
            <Calendar.NavButton slot="previous" />
            <Calendar.NavButton slot="next" />
          </Calendar.Header>
          <Calendar.Grid>
            <Calendar.GridHeader>{(day) => <Calendar.HeaderCell>{day}</Calendar.HeaderCell>}</Calendar.GridHeader>
            <Calendar.GridBody>{(date) => <Calendar.Cell date={date} />}</Calendar.GridBody>
          </Calendar.Grid>
        </Calendar>
      </DatePicker.Popover>
    </DatePicker>
  );
}
