import { createInterface, type Interface } from 'node:readline';
import { db } from '../db.ts';
import { findUserByEmail, setPassword } from '../auth.ts';

/**
 * Şifre değiştirme aracı.
 *
 *   npm run sifre -- ornek@mail.com
 *
 * Şifre ekrana yazılmaz ve komut geçmişine düşmez; girildikten sonra o kullanıcının
 * tüm cihazlardaki oturumları kapanır.
 */

interface MutableInterface extends Interface {
  muted?: boolean;
  output?: NodeJS.WritableStream;
  _writeToOutput?: (text: string) => void;
}

function ask(question: string, hidden = false): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout }) as MutableInterface;
    if (hidden) {
      const original = rl._writeToOutput!.bind(rl);
      rl._writeToOutput = (text: string) => {
        if (rl.muted) rl.output?.write('*');
        else original(text);
      };
    }
    rl.question(question, (answer) => {
      rl.muted = false;
      rl.close();
      if (hidden) process.stdout.write('\n');
      resolve(answer.trim());
    });
    rl.muted = hidden;
  });
}

const email = process.argv[2];
db(); // şema hazır olsun

if (!email) {
  const users = db().prepare('SELECT email, role FROM users ORDER BY created_at').all() as {
    email: string;
    role: string;
  }[];
  console.log('Kullanım: npm run sifre -- ornek@mail.com\n');
  console.log('Kayıtlı hesaplar:');
  for (const user of users) console.log(`  ${user.email} (${user.role})`);
  process.exit(1);
}

const user = findUserByEmail(email);
if (!user) {
  console.error(`Böyle bir hesap yok: ${email}`);
  process.exit(1);
}

const first = await ask(`${user.email} için yeni şifre: `, true);
if (first.length < 12 || first.length > 256) {
  console.error('Şifre 12 ile 256 karakter arasında olmalı.');
  process.exit(1);
}
const second = await ask('Yeni şifre (tekrar): ', true);
if (first !== second) {
  console.error('Şifreler uyuşmadı.');
  process.exit(1);
}

setPassword(user.id, first);
console.log(`\n${user.email} şifresi güncellendi. Açık tüm oturumlar kapatıldı.`);
