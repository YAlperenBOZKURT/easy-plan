import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api.ts';
import {
  CARD_COLORS,
  CARD_PRIORITY_OPTIONS,
  type CardPriority,
  type CardTemplate,
  type ChecklistItem,
} from '../lib/types.ts';
import { normalizeChecklist } from '../lib/checklist.ts';
import ReminderPicker from './ReminderPicker.tsx';
import TagPicker from './TagPicker.tsx';

const freshItem = (text = ''): ChecklistItem => ({
  id: globalThis.crypto?.randomUUID?.() ?? `item-${Date.now()}-${Math.random()}`,
  text,
  done: false,
});

export default function CardTemplatesModal({
  onClose,
  onChanged,
}: {
  onClose: () => void;
  onChanged: () => void;
}) {
  const [templates, setTemplates] = useState<CardTemplate[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [name, setName] = useState('');
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [color, setColor] = useState('blue');
  const [priority, setPriority] = useState<CardPriority>('none');
  const [tags, setTags] = useState<string[]>([]);
  const [reminders, setReminders] = useState<number[]>([]);
  const [checklist, setChecklist] = useState<ChecklistItem[]>([]);
  const [images, setImages] = useState<CardTemplate['images']>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);

  const selected = templates.find((template) => template.id === selectedId);

  const fill = (template: CardTemplate) => {
    setSelectedId(template.id);
    setName(template.name);
    setTitle(template.title);
    setNote(template.note);
    setStartTime(template.startTime ?? '');
    setEndTime(template.endTime ?? '');
    setColor(template.color);
    setPriority(template.priority);
    setTags(template.tags);
    setReminders(template.reminders);
    setChecklist(template.checklist.map((item) => freshItem(item.text)));
    setImages(template.images);
    setError('');
  };

  const load = async (preferredId?: string) => {
    const response = await api.cardTemplates();
    setTemplates(response.templates);
    const next = response.templates.find((item) => item.id === (preferredId ?? selectedId)) ?? response.templates[0];
    if (next) fill(next);
    else setSelectedId('');
  };

  useEffect(() => {
    void load().catch(() => setError('Şablonlar yüklenemedi.'));
  }, []);

  const save = async () => {
    if (!selected || !name.trim()) return;
    setBusy(true);
    setError('');
    try {
      await api.updateCardTemplate(selected.id, {
        name: name.trim(), title: title.trim(), note: note.trim(),
        startTime: startTime || null, endTime: endTime || null,
        color, priority, tags, reminders, checklist: normalizeChecklist(checklist),
      });
      await load(selected.id);
      onChanged();
    } catch {
      setError('Şablon kaydedilemedi.');
    } finally {
      setBusy(false);
    }
  };

  const create = async () => {
    setBusy(true);
    setError('');
    try {
      const response = await api.createCardTemplate({ name: 'Yeni şablon', color: 'blue' });
      await load(response.template.id);
      onChanged();
    } catch {
      setError('Şablon oluşturulamadı.');
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!selected || !window.confirm(`“${selected.name}” şablonu silinsin mi? Bağlı kartlar mevcut hâliyle kalır.`)) return;
    setBusy(true);
    try {
      await api.deleteCardTemplate(selected.id);
      await load();
      onChanged();
    } catch {
      setError('Şablon silinemedi.');
    } finally {
      setBusy(false);
    }
  };

  const upload = async (files: FileList | null) => {
    if (!selected || !files?.length) return;
    setBusy(true);
    try {
      await api.uploadCardTemplateImages(selected.id, [...files]);
      await load(selected.id);
      onChanged();
    } catch {
      setError('Görseller yüklenemedi.');
    } finally {
      setBusy(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  const removeImage = async (id: string) => {
    if (!selected) return;
    setBusy(true);
    try {
      await api.deleteCardTemplateImage(id);
      await load(selected.id);
      onChanged();
    } catch {
      setError('Görsel kaldırılamadı.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="overlay" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="modal wide template-manager-modal" role="dialog" aria-modal="true" aria-labelledby="templates-title">
        <div className="modal-head">
          <h2 className="modal-title" id="templates-title">Şablonlar</h2>
          <span className="topbar-range">Bağlı kartlar, şablon kaydedilince otomatik güncellenir.</span>
          <div className="spacer" />
          <button className="btn btn-ghost btn-icon" onClick={onClose} aria-label="Kapat">✕</button>
        </div>
        <div className="modal-body">
          <div className="template-toolbar">
            <select value={selectedId} onChange={(event) => {
              const template = templates.find((item) => item.id === event.target.value);
              if (template) fill(template);
            }} aria-label="Şablon seç">
              {templates.length === 0 && <option value="">Henüz şablon yok</option>}
              {templates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}
            </select>
            <button type="button" className="btn" disabled={busy} onClick={() => void create()}>+ Yeni şablon</button>
            <button type="button" className="btn btn-red" disabled={!selected || busy} onClick={() => void remove()}>Sil</button>
          </div>

          {selected && (
            <>
              <div className="row">
                <div className="field"><label className="label" htmlFor="template-edit-name">Şablon adı</label><input id="template-edit-name" value={name} maxLength={100} onChange={(e) => setName(e.target.value)} /></div>
                <div className="field"><label className="label" htmlFor="template-edit-title">Kart başlığı</label><input id="template-edit-title" value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} /></div>
              </div>
              <div className="row">
                <div className="field"><label className="label" htmlFor="template-start">Başlangıç</label><input id="template-start" type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} /></div>
                <div className="field"><label className="label" htmlFor="template-end">Bitiş</label><input id="template-end" type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} /></div>
              </div>
              <div className="field"><span className="label">Renk</span><div className="swatches">{CARD_COLORS.map((option) => <button key={option} type="button" aria-label={option} className={`swatch${color === option ? ' on' : ''}`} style={{ ['--c' as string]: `var(--c-${option})` }} onClick={() => setColor(option)} />)}</div></div>
              <div className="field"><span className="label">Öncelik</span><div className="priority-picker">{CARD_PRIORITY_OPTIONS.map((option) => <button key={option.value} type="button" className={`priority-option priority-${option.value}${priority === option.value ? ' on' : ''}`} onClick={() => setPriority(option.value)}>{option.label}</button>)}</div></div>
              <TagPicker value={tags} suggestions={[]} onChange={setTags} />
              <div className="field"><label className="label" htmlFor="template-note">Not</label><textarea id="template-note" value={note} maxLength={5000} onChange={(e) => setNote(e.target.value)} /></div>
              <div className="field">
                <div className="checklist-heading"><span className="label">Checklist</span><span className="hint">{checklist.length}/50</span></div>
                <div className="checklist-editor">{checklist.map((item) => <div className="checklist-editor-row" key={item.id}><input value={item.text} maxLength={500} aria-label="Şablon checklist maddesi" onChange={(e) => setChecklist((current) => current.map((entry) => entry.id === item.id ? { ...entry, text: e.target.value } : entry))} /><button type="button" className="btn btn-ghost btn-icon" onClick={() => setChecklist((current) => current.filter((entry) => entry.id !== item.id))}>✕</button></div>)}</div>
                <button type="button" className="btn checklist-add" disabled={checklist.length >= 50} onClick={() => setChecklist((current) => [...current, freshItem()])}>+ Madde ekle</button>
              </div>
              <ReminderPicker value={reminders} onChange={setReminders} />
              <div className="field">
                <span className="label">Görseller</span>
                {images.length > 0 && <div className="thumbs">{images.map((image) => <div className="thumb" key={image.id}><img src={image.thumbUrl} alt="" /><button className="x" type="button" aria-label="Şablon görselini kaldır" onClick={() => void removeImage(image.id)}>✕</button></div>)}</div>}
                <button type="button" className="btn" disabled={busy} onClick={() => fileInput.current?.click()}>+ Görsel ekle</button>
                <input ref={fileInput} type="file" accept="image/*" multiple hidden onChange={(e) => void upload(e.target.files)} />
              </div>
              <p className="hint template-link-note">Bağlı bir kart üzerinde yapılan en küçük değişiklik bağlantıyı kalıcı olarak kaldırır.</p>
            </>
          )}
          {error && <p className="error-text" role="alert">{error}</p>}
        </div>
        <div className="modal-foot">
          <button className="btn btn-primary" disabled={!selected || !name.trim() || busy} onClick={() => void save()}>{busy ? 'Kaydediliyor…' : 'Değişiklikleri kaydet'}</button>
          <button className="btn" disabled={busy} onClick={onClose}>Kapat</button>
        </div>
      </div>
    </div>
  );
}
