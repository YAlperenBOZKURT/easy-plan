import nodemailer, { type Transporter } from 'nodemailer';
import { config } from './config.ts';
import { db } from './db.ts';
import { newId, nowIso } from './ids.ts';

/**
 * Tek SMTP hesabından gönderim. SMTP tanımlı değilse sistem kilitlenmez; gönderim
 * "disabled" olarak kaydedilir ve davet/sıfırlama linkleri arayüzde gösterilir.
 *
 * Gönderimler sıraya alınır: aynı anda çok kullanıcıya mail çıktığında Gmail'in
 * eşzamanlılık sınırına takılmamak için tek tek işlenir.
 */

let transport: Transporter | undefined;
function getTransport(): Transporter | undefined {
  if (!config.mailEnabled) return undefined;
  transport ??= nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.secure,
    auth: { user: config.smtp.user, pass: config.smtp.pass },
  });
  return transport;
}

export type MailKind = 'reminder' | 'daily' | 'test' | 'invite' | 'reset';

export interface MailInput {
  to: string;
  subject: string;
  html: string;
  text?: string;
  kind: MailKind;
  userId?: string | null;
  cardId?: string | null;
  attachments?: { filename: string; path: string; cid: string }[];
}

function log(input: MailInput, status: 'ok' | 'error' | 'disabled', error?: string) {
  db()
    .prepare(
      `INSERT INTO mail_log (id, user_id, kind, card_id, to_addr, subject, status, error, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      newId(),
      input.userId ?? null,
      input.kind,
      input.cardId ?? null,
      input.to,
      input.subject,
      status,
      error ?? null,
      nowIso(),
    );
}

let queue: Promise<unknown> = Promise.resolve();

export function sendMail(input: MailInput): Promise<{ sent: boolean; error?: string }> {
  const task = queue.then(async () => {
    const tx = getTransport();
    if (!tx) {
      log(input, 'disabled');
      return { sent: false, error: 'mail_disabled' };
    }
    try {
      await tx.sendMail({
        from: config.smtp.from,
        to: input.to,
        subject: input.subject,
        html: input.html,
        text: input.text ?? stripHtml(input.html),
        attachments: input.attachments,
      });
      log(input, 'ok');
      return { sent: true };
    } catch (err) {
      const message = (err as Error).message;
      log(input, 'error', message);
      return { sent: false, error: message };
    }
  });
  queue = task.catch(() => undefined);
  return task;
}

const stripHtml = (html: string) =>
  html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|h1|h2|h3)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

/** Tüm maillerde ortak, e-posta istemcilerinde güvenle çalışan basit yerleşim. */
export function layout(title: string, body: string): string {
  return `<!doctype html>
<html lang="tr"><body style="margin:0;padding:24px;background:#f6f6f7;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1c1c1e">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:14px;padding:28px;border:1px solid #e8e8ec">
    <h1 style="margin:0 0 18px;font-size:18px;font-weight:600">${escapeHtml(title)}</h1>
    ${body}
    <p style="margin:28px 0 0;font-size:12px;color:#8a8a8e">Planner · ${config.appUrl}</p>
  </div>
</body></html>`;
}

export function button(label: string, url: string): string {
  return `<p style="margin:20px 0"><a href="${url}" style="display:inline-block;background:#1c1c1e;color:#fff;text-decoration:none;padding:11px 20px;border-radius:9px;font-size:14px;font-weight:500">${escapeHtml(label)}</a></p>
  <p style="margin:0;font-size:12px;color:#8a8a8e;word-break:break-all">${url}</p>`;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
