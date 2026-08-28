import { useRef, useState } from 'react';
import { api } from '../lib/api.ts';

type TransferFormat = 'json' | 'csv' | 'ics';

const formatCopy: Record<TransferFormat, { title: string; detail: string }> = {
  json: { title: 'JSON', detail: 'Easy Plan verilerini tekrar içe aktarmak için en uygun biçim.' },
  csv: { title: 'CSV', detail: 'Excel ve elektronik tablo uygulamalarında açılabilir.' },
  ics: { title: 'iCalendar', detail: 'Google Calendar, Apple Calendar ve Outlook ile uyumludur.' },
};

export default function DataTransferModal({
  initialFrom,
  initialTo,
  onClose,
  onImported,
}: {
  initialFrom: string;
  initialTo: string;
  onClose: () => void;
  onImported: () => void;
}) {
  const [from, setFrom] = useState(initialFrom);
  const [to, setTo] = useState(initialTo);
  const [format, setFormat] = useState<TransferFormat>('json');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const input = useRef<HTMLInputElement>(null);

  const exportFile = async () => {
    if (!from || !to || from > to) {
      setError('Geçerli bir tarih aralığı seç.');
      return;
    }
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const result = await api.exportData(format, from, to);
      const url = URL.createObjectURL(result.blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = result.filename;
      anchor.click();
      URL.revokeObjectURL(url);
      setMessage(`${formatCopy[format].title} dosyası hazırlandı.`);
    } catch {
      setError('Dışa aktarma tamamlanamadı.');
    } finally {
      setBusy(false);
    }
  };

  const importFile = async (file?: File) => {
    if (!file) return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const result = await api.importData(file);
      setMessage(`${result.imported} kart içe aktarıldı${result.skipped ? `, ${result.skipped} kayıt atlandı` : ''}.`);
      onImported();
    } catch {
      setError('Dosya içe aktarılamadı. JSON, CSV veya ICS biçimini kontrol et.');
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  };

  return (
    <div className="overlay" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="modal transfer-modal" role="dialog" aria-modal="true" aria-labelledby="transfer-title">
        <div className="modal-head">
          <h2 className="modal-title" id="transfer-title">İçe / Dışa Aktar</h2>
          <div className="spacer" />
          <button className="btn btn-ghost btn-icon" onClick={onClose} aria-label="Kapat">✕</button>
        </div>
        <div className="modal-body transfer-body">
          <section>
            <h3>Dışa aktar</h3>
            <p className="hint">Seçilen aralıktaki aktif kartlar aktarılır. Görsel dosyaları pakete dahil edilmez.</p>
            <div className="row">
              <div className="field"><label className="label" htmlFor="transfer-from">Başlangıç</label><input id="transfer-from" type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></div>
              <div className="field"><label className="label" htmlFor="transfer-to">Bitiş</label><input id="transfer-to" type="date" value={to} onChange={(event) => setTo(event.target.value)} /></div>
            </div>
            <div className="transfer-formats" role="radiogroup" aria-label="Dosya biçimi">
              {(Object.keys(formatCopy) as TransferFormat[]).map((value) => (
                <button key={value} type="button" role="radio" aria-checked={format === value} className={format === value ? 'active' : ''} onClick={() => setFormat(value)}>
                  <strong>{formatCopy[value].title}</strong><small>{formatCopy[value].detail}</small>
                </button>
              ))}
            </div>
            <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void exportFile()}>Dosyayı indir</button>
          </section>
          <section>
            <h3>İçe aktar</h3>
            <p className="hint">En fazla 5 MB ve 1.000 kart. İçe aktarılan kartlar mevcut kartların üzerine yazılmaz.</p>
            <button type="button" className="btn" disabled={busy} onClick={() => input.current?.click()}>JSON, CSV veya ICS seç</button>
            <input ref={input} aria-label="Aktarım dosyası" hidden type="file" accept=".json,.csv,.ics,application/json,text/csv,text/calendar" onChange={(event) => void importFile(event.target.files?.[0])} />
          </section>
          {message && <p className="success-text" role="status">{message}</p>}
          {error && <p className="error-text" role="alert">{error}</p>}
        </div>
        <div className="modal-foot"><button className="btn" disabled={busy} onClick={onClose}>Kapat</button></div>
      </div>
    </div>
  );
}
