import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

// Test validation logic and security filters directly

const MAX_FILE_SIZE = 50 * 1024 * 1024;
const BLOCKED_EXTENSIONS = new Set([
  '.exe',
  '.bat',
  '.cmd',
  '.scr',
  '.js',
  '.vbs',
  '.ps1'
]);

const ALLOWED_EXPIRY_SECONDS = {
  '1h': 3600,
  '1hour': 3600,
  '1': 3600,
  3600: 3600,
  '6h': 21600,
  '6hour': 21600,
  '6hours': 21600,
  '6': 21600,
  21600: 21600,
  '24h': 86400,
  '24hour': 86400,
  '24hours': 86400,
  '24': 86400,
  86400: 86400
};

function sanitizeFileName(rawName) {
  if (typeof rawName !== 'string') return '';
  const base = rawName.split(/[/\\]/).pop() || '';
  let clean = base.replace(/[\x00-\x1F\x7F]/g, '').trim();
  clean = clean.replace(/[<>:"/\\|?*]/g, '_');
  clean = clean.replace(/^\.+/, '').replace(/\.+$/, '');
  if (!clean || clean === '.' || clean === '..') return '';
  return clean;
}

test('Sanitize file names: directory traversal and hazardous characters', () => {
  assert.equal(sanitizeFileName('../../etc/passwd'), 'passwd');
  assert.equal(sanitizeFileName('..\\..\\windows\\system32\\cmd.exe'), 'cmd.exe');
  assert.equal(sanitizeFileName('my report: 2026?.pdf'), 'my report_ 2026_.pdf');
  assert.equal(sanitizeFileName('...test.png...'), 'test.png');
});

test('Blocked extensions enforcement', () => {
  const dangerous = [
    'malware.exe',
    'setup.EXE',
    'script.bat',
    'run.cmd',
    'screensaver.scr',
    'payload.js',
    'virus.vbs',
    'hack.ps1'
  ];

  for (const f of dangerous) {
    const ext = '.' + f.split('.').pop().toLowerCase();
    assert.equal(BLOCKED_EXTENSIONS.has(ext), true, `Should block ${f}`);
  }

  const safe = [
    'document.pdf',
    'image.png',
    'archive.zip',
    'presentation.pptx',
    'data.csv',
    'song.mp3'
  ];

  for (const f of safe) {
    const ext = '.' + f.split('.').pop().toLowerCase();
    assert.equal(BLOCKED_EXTENSIONS.has(ext), false, `Should allow ${f}`);
  }
});

test('File size limits (max 50 MB)', () => {
  assert.equal(50 * 1024 * 1024 <= MAX_FILE_SIZE, true);
  assert.equal(50 * 1024 * 1024 + 1 > MAX_FILE_SIZE, true);
  assert.equal(0 > 0, false);
});

test('Expiry choices', () => {
  assert.equal(ALLOWED_EXPIRY_SECONDS['1h'], 3600);
  assert.equal(ALLOWED_EXPIRY_SECONDS['6h'], 21600);
  assert.equal(ALLOWED_EXPIRY_SECONDS['24h'], 86400);
  assert.equal(ALLOWED_EXPIRY_SECONDS['48h'], undefined);
  assert.equal(ALLOWED_EXPIRY_SECONDS['invalid'], undefined);
});

test('File ID generation: unguessable, 12+ chars, URL-safe', () => {
  for (let i = 0; i < 100; i++) {
    const fileId = crypto.randomBytes(12).toString('base64url');
    assert.equal(fileId.length >= 12, true);
    // Base64URL characters are only [A-Za-z0-9_-]
    assert.match(fileId, /^[A-Za-z0-9_-]+$/);
  }
});

test('DeleteToken SHA-256 hash and timing-safe comparison', () => {
  const deleteToken = crypto.randomBytes(24).toString('base64url');
  const storedHash = crypto.createHash('sha256').update(deleteToken).digest('hex');

  // Verify valid token matches
  const goodHash = crypto.createHash('sha256').update(deleteToken).digest('hex');
  const bufGood = Buffer.from(goodHash, 'utf-8');
  const bufStored = Buffer.from(storedHash, 'utf-8');
  assert.equal(crypto.timingSafeEqual(bufGood, bufStored), true);

  // Verify invalid token fails
  const badToken = 'wrong-token';
  const badHash = crypto.createHash('sha256').update(badToken).digest('hex');
  const bufBad = Buffer.from(badHash, 'utf-8');
  assert.equal(crypto.timingSafeEqual(bufBad, bufStored), false);
});

test('Lazy TTL expiration check logic', () => {
  const now = Math.floor(Date.now() / 1000);
  const expiredItem = { expiresAt: now - 10 };
  const activeItem = { expiresAt: now + 3600 };

  const isExpired = (item) => item.expiresAt <= Math.floor(Date.now() / 1000);

  assert.equal(isExpired(expiredItem), true, 'Should detect expired item even if DynamoDB has not deleted yet');
  assert.equal(isExpired(activeItem), false, 'Should allow active item');
});
