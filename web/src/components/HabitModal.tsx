import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api.ts';
import { WEEKDAY_LABELS } from '../lib/dates.ts';
import { CARD_COLORS, type Habit } from '../lib/types.ts';
import ReminderPicker from './ReminderPicker.tsx';

/**
 * Davranış = haftanın seçilen günlerine 1 yıl boyunca otomatik kart üretir.
 * Üretilen her kart bağımsızdır; sonradan tek tek değiştirilebilir, silinebilir.
 * Buradaki düzenlemeler MEVCUT kartlara dokunmaz, yalnızca yeni üretilecekleri etkiler.
 */
export default function HabitModal({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const habits = useQuery({ queryKey: ['habits'], queryFn: api.habits });

  const [editing, setEditing] = useState<Habit | null>(null);
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [color, setColor] = useState('violet');
  const [weekdays, setWeekdays] = useState<number[]>([]);
  const [reminders, setReminders] = useState<number[]>([]);
  const [notice, setNotice] = useState('');

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const reset = () => {
    setEditing(null);
    setTitle('');
    setNote('');
    setStartTime('');
    setEndTime('');
    setColor('violet');
    setWeekdays([]);
    setReminders([]);
  };

  const startEdit = (habit: Habit) => {
    setEditing(habit);
    setTitle(habit.title);
    setNote(habit.note);
    setStartTime(habit.startTime ?? '');
    setEndTime(habit.endTime ?? '');
    setColor(habit.color);
    setWeekdays(habit.weekdays);
    setReminders(habit.reminders);
    setNotice('');
  };

  const save = useMutation({
    mutationFn: async () => {
      const payload = {
        title: title.trim(),
        note: note.trim(),
        startTime: startTime || null,
        endTime: endTime || null,
        color,
        weekdays,
        reminders,
      };
      if (editing) {
        await api.updateHabit(editing.id, payload);
        return { createdCards: 0, edited: true };
      }
      const result = await api.createHabit(payload);
      return { createdCards: result.createdCards, edited: false };
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['habits'] });
      queryClient.invalidateQueries({ queryKey: ['cards'] });
      setNotice(
        result.edited
          ? 'Kaydedildi. Mevcut kartlar olduğu gibi kaldı; değişiklik bundan sonra üretilecek kartlara uygulanır.'
          : `${result.createdCards} kart üretildi (önümüzdeki 1 yıl).`,
      );
      reset();
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.deleteHabit(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['habits'] });
      setNotice('Davranış silindi. Takvimdeki kartlar olduğu gibi duruyor.');
      reset();
    },
  });

  const toggleDay = (value: number) =>
    setWeekdays((current) =>
      current.includes(value) ? current.filter((d) => d !== value) : [...current, value].sort(),
    );

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="habit-modal-title"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <h2 className="modal-title" id="habit-modal-title">{editing ? 'Davranışı düzenle' : 'Davranış ekle'}</h2>
          <div className="spacer" />
          <button className="btn btn-ghost btn-icon" onClick={onClose} aria-label="Kapat">
            ✕
          </button>
        </div>

        <div className="modal-body">
          <div className="field">
            <label className="label" htmlFor="habit-title">
              Başlık
            </label>
            <input
              id="habit-title"
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Sabah koşusu, ilaç, ders…"
            />
          </div>

          <div className="field">
            <span className="label">Hangi günler</span>
            <div className="chips">
              {WEEKDAY_LABELS.map((day) => (
                <button
                  key={day.value}
                  type="button"
                  className={`chip${weekdays.includes(day.value) ? ' on' : ''}`}
                  onClick={() => toggleDay(day.value)}
                >
                  {day.label}
                </button>
              ))}
            </div>
          </div>

          <div className="row">
            <div className="field" style={{ flex: 1 }}>
              <label className="label" htmlFor="habit-start">
                Başlangıç
              </label>
              <input
                id="habit-start"
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
              />
            </div>
            <div className="field" style={{ flex: 1 }}>
              <label className="label" htmlFor="habit-end">
                Bitiş
              </label>
              <input id="habit-end" type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
            </div>
          </div>

          <div className="field">
            <span className="label">Renk</span>
            <div className="swatches">
              {CARD_COLORS.map((option) => (
                <button
                  key={option}
                  type="button"
                  aria-label={option}
                  className={`swatch${color === option ? ' on' : ''}`}
                  style={{ ['--c' as string]: `var(--c-${option})` }}
                  onClick={() => setColor(option)}
                />
              ))}
            </div>
          </div>

          <div className="field">
            <label className="label" htmlFor="habit-note">
              Not
            </label>
            <textarea id="habit-note" value={note} onChange={(e) => setNote(e.target.value)} />
          </div>

          <ReminderPicker
            value={reminders}
            onChange={setReminders}
            hint="Üretilen her karta bu hatırlatmalar kopyalanır; sonradan kart bazında değiştirebilirsin."
          />

          {notice && (
            <p className="auth-sub" style={{ color: 'var(--c-green)' }}>
              {notice}
            </p>
          )}

          {(habits.data?.habits.length ?? 0) > 0 && (
            <div className="field">
              <span className="label">Mevcut davranışlar</span>
              {habits.data!.habits.map((habit) => (
                <div
                  key={habit.id}
                  className="row"
                  style={{ padding: '7px 0', borderBottom: '1px solid var(--border)' }}
                >
                  <span
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: 4,
                      background: `var(--c-${habit.color})`,
                      flexShrink: 0,
                    }}
                  />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 550 }}>{habit.title || '(başlıksız)'}</div>
                    <div style={{ fontSize: 11.5, color: 'var(--text-faint)' }}>
                      {habit.weekdays.map((d) => WEEKDAY_LABELS[d - 1]?.label).join(' · ')}
                      {habit.startTime ? ` · ${habit.startTime}` : ''}
                    </div>
                  </div>
                  <button className="btn btn-sm btn-ghost" onClick={() => startEdit(habit)}>
                    Düzenle
                  </button>
                  <button className="btn btn-sm btn-danger" onClick={() => remove.mutate(habit.id)}>
                    Sil
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="modal-foot">
          <button
            className="btn btn-primary"
            onClick={() => save.mutate()}
            disabled={save.isPending || weekdays.length === 0}
          >
            {save.isPending ? 'Kaydediliyor…' : editing ? 'Değişikliği kaydet' : 'Oluştur ve kartları ekle'}
          </button>
          {editing ? (
            <button className="btn" onClick={reset}>
              Yeni davranış
            </button>
          ) : (
            <button className="btn" onClick={onClose}>
              Kapat
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
