const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const html = fs.readFileSync(new URL('../index.html', 'file://' + __filename), 'utf8');
const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
const classicScript = scripts.find(([, attrs, body]) => !/\btype\s*=\s*["']module["']/i.test(attrs) && body.trim());

test('inline application JavaScript parses without syntax errors', () => {
  assert.ok(classicScript, 'classic application script must exist');
  assert.doesNotThrow(() => new vm.Script(classicScript[2], { filename: 'index.html:inline-script' }));
});

test('QR is static and contains the shop identifier but never the PIN', () => {
  assert.match(html, /const url=location\.origin\+location\.pathname\+'\?shop='\+encodeURIComponent\(shopId\)/);
  assert.doesNotMatch(html, /location\.origin[^;]{0,250}pin/i);
  assert.match(html, /new QRCode\(host,\{text:url/);
});

test('QR customer flow validates a six-digit PIN and exchanges it for a Firebase custom token', () => {
  assert.match(html, /async function verifyClientPin\(\)/);
  assert.match(html, /!\/\^\\d\{6\}\$\/\.test\(pin\)/);
  assert.match(html, /fetch\(CLIENT_WORKER_URL\+'\/client\/access'/);
  assert.match(html, /signInWithCustomToken\(api\.auth,data\.customToken\)/);
  assert.match(html, /await loadClientCatalogForShop\(data\.shopId\)/);
});

test('QR client catalog is loaded only from the selected shop enabled-device list', () => {
  assert.match(html, /async function loadClientCatalogForShop\(shopId\)/);
  assert.match(html, /await loadShopCatalog\(shopId\)/);
  assert.match(html, /new Set\(enabledDeviceIds\)/);
  assert.match(html, /api\.getDoc\(api\.doc\(api\.db,'devices',id\)\)/);
  assert.match(html, /if\(currentUserProfile\?\.role!==['"]client['"]\)/);
});

test('QR startup waits for Firebase initialization before opening the PIN panel', () => {
  assert.match(html, /while\(!window\.firebaseApi\)[\s\S]{0,180}firebase-ready/);
  assert.match(html, /if\(qrShopFromUrl\(\)\)\{await startQrClientEntry\(\);return\}/);
});

test('QR client failures and expiry clear client state and cancel the timer', () => {
  assert.match(html, /function clearClientSessionState\(\)/);
  assert.match(html, /if\(clientExpiryTimer\)\{clearTimeout\(clientExpiryTimer\);clientExpiryTimer=null;\}/);
  assert.match(html, /catch\(e\)\{\s*clearClientSessionState\(\)/);
  assert.match(html, /clientExpiryTimer=setTimeout\(async\(\)=>\{/);
  assert.match(html, /clearClientSessionState\(\);\s*document\.getElementById\('clientView'\)/);
});

test('QR print stylesheet isolates the printable card from admin controls', () => {
  assert.match(html, /@media print\{\s*body \*\{visibility:hidden!important\}/);
  assert.match(html, /#shopQrPrintCard,#shopQrPrintCard \*\{visibility:visible!important\}/);
  assert.match(html, /@page\{size:A4;margin:10mm\}/);
  assert.doesNotMatch(html, /#shopQrUrl[^}]*display:\s*none/);
});
