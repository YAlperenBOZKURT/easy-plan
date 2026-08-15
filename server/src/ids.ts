import { randomUUID, randomBytes, createHash } from 'node:crypto';

export const newId = () => randomUUID();
export const nowIso = () => new Date().toISOString();

/** URL'e güvenli rastgele jeton (davet, oturum, şifre sıfırlama) */
export const newToken = () => randomBytes(32).toString('base64url');

/** Jetonların kendisi değil, yalnızca hash'i saklanır */
export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
