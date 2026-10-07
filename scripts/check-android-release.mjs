import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const build = join(root, 'mobile/build');
const bundle = join(build, 'app/outputs/bundle/release/app-release.aab');
if (existsSync(bundle)) {
  throw new Error('An existing release AAB is present. Move it to a safe location before running this verification check.');
}
await mkdir(build, { recursive: true });
const temporary = await mkdtemp(join(build, 'signing-check-'));
const javaBin = process.env.JAVA_HOME ? join(process.env.JAVA_HOME, 'bin') : '';
const javaTool = name => javaBin ? join(javaBin, name + (process.platform === 'win32' ? '.exe' : '')) : name;
let builtTestBundle = false;
async function run(command, args, env = process.env, flutter = false) {
  const child = flutter && process.platform === 'win32'
    ? spawn(process.env.ComSpec ?? 'cmd.exe', ['/d', '/c', 'flutter', ...args], { cwd: join(root, 'mobile'), env })
    : spawn(command, args, { cwd: join(root, 'mobile'), env });
  let output = '';
  for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => { output += chunk; });
  const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); });
  return { code, output };
}
try {
  // Disposable verification certificate, never a product upload key.
  const password = randomUUID();
  const keystore = join(temporary, 'verification-only.jks');
  const env = { ...process.env, ANDROID_KEYSTORE_PATH: keystore,
    ANDROID_KEYSTORE_PASSWORD: password, ANDROID_KEY_PASSWORD: password, ANDROID_KEY_ALIAS: 'verification-only' };
  const generated = await run(javaTool('keytool'), ['-genkeypair', '-noprompt', '-keystore', keystore,
    '-storetype', 'JKS', '-keyalg', 'RSA', '-keysize', '2048', '-validity', '2',
    '-alias', 'verification-only', '-dname', 'CN=Easy Plan verification only',
    '-storepass:env', 'ANDROID_KEYSTORE_PASSWORD', '-keypass:env', 'ANDROID_KEY_PASSWORD'], env);
  assert.equal(generated.code, 0, generated.output);
  const flutterBuild = (url, signing = env) => run('flutter', ['build', 'appbundle', '--release', '--no-pub',
    `--dart-define=PLANNER_API_URL=${url}`], signing, true);
  const missing = await flutterBuild('https://release-check.invalid', { ...env, ANDROID_KEYSTORE_PASSWORD: '' });
  assert.notEqual(missing.code, 0);
  assert.match(missing.output, /Release signing is required/);
  console.log('PASS: release rejects missing signing configuration.');
  const insecure = await flutterBuild('http://localhost:3000');
  assert.notEqual(insecure.code, 0);
  assert.match(insecure.output, /Android release requires.*PLANNER_API_URL/);
  console.log('PASS: release rejects an HTTP API origin.');
  console.log('Building verification-only Android bundle (not for distribution)...');
  builtTestBundle = true;
  const valid = await flutterBuild('https://release-check.invalid');
  assert.equal(valid.code, 0, valid.output);
  const verified = await run(javaTool('jarsigner'), ['-J-Duser.language=en', '-verify', bundle]);
  assert.equal(verified.code, 0, verified.output);
  assert.match(verified.output, /jar verified/);
  console.log('PASS: signed release bundle verified with jarsigner; temporary certificate removed.');
} finally {
  // Check the resolved target before recursive deletion on Windows.
  assert.equal(dirname(resolve(temporary)), resolve(build));
  assert.ok(basename(temporary).startsWith('signing-check-'));
  await rm(temporary, { recursive: true, force: true });
  // Do not leave a test-signed bundle where it could be mistaken for a release.
  if (builtTestBundle) await rm(bundle, { force: true });
}
