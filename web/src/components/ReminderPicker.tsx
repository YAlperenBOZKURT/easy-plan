import { REMINDER_OPTIONS } from '../lib/types.ts';

/**
 * Hatırlatma seçici: her aralık bağımsız açılıp kapanır, hiçbiri seçilmeyebilir.
 * Kartın başlangıç saatine göre geri sayar; saat girilmemişse günün 09:00'ı baz alınır.
 */
export default function ReminderPicker({
  value,
  onChange,
  hint,
}: {
  value: number[];
  onChange: (next: number[]) => void;
  hint?: string;
}) {
  const toggle = (minutes: number) =>
    onChange(
      value.includes(minutes) ? value.filter((m) => m !== minutes) : [...value, minutes].sort((a, b) => b - a),
    );

  const all = REMINDER_OPTIONS.map((o) => o.minutes);
  const allSelected = all.every((m) => value.includes(m));

  return (
    <div className="field">
      <span className="label">Hatırlat (e-posta)</span>
      <div className="chips">
        {/* Tek dokunuşla hepsini seç; tekrar basınca hiçbiri kalmaz */}
        <button
          type="button"
          className={`chip${allSelected ? ' on' : ''}`}
          onClick={() => onChange(allSelected ? [] : [...all])}
        >
          {allSelected ? 'Hiçbiri' : 'Hepsi'}
        </button>
        {REMINDER_OPTIONS.map((option) => (
          <button
            key={option.minutes}
            type="button"
            className={`chip${value.includes(option.minutes) ? ' on' : ''}`}
            onClick={() => toggle(option.minutes)}
          >
            {option.label}
          </button>
        ))}
      </div>
      <span style={{ fontSize: 11.5, color: 'var(--text-faint)' }}>
        {hint ?? 'Başlangıç saatine bu kadar kala mail gelir. Saat girilmezse 09:00 baz alınır.'}
      </span>
    </div>
  );
}
