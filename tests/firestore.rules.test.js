import fs from 'node:fs';
import { after, before, beforeEach, describe, it } from 'mocha';
import { strict as assert } from 'node:assert';
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds
} from '@firebase/rules-unit-testing';
import {
  doc, getDoc, setDoc, Timestamp
} from 'firebase/firestore';

const PROJECT_ID = 'demo-listino-smartphones';
let env;

const future = () => Timestamp.fromDate(new Date(Date.now() + 60 * 60 * 1000));
const past = () => Timestamp.fromDate(new Date(Date.now() - 60 * 1000));

async function seed() {
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    await setDoc(doc(db, 'users/seller-a'), {
      role: 'seller', active: true, shopId: 'SHOP_A'
    });
    await setDoc(doc(db, 'users/admin-a'), {
      role: 'admin', active: true
    });
    await setDoc(doc(db, 'shops/SHOP_A'), { name: 'Shop A', active: true });
    await setDoc(doc(db, 'shops/SHOP_B'), { name: 'Shop B', active: true });
    await setDoc(doc(db, 'shopCatalog/SHOP_A'), {
      enabledDeviceIds: ['DEVICE_A']
    });
    await setDoc(doc(db, 'shopCatalog/SHOP_B'), {
      enabledDeviceIds: ['DEVICE_B']
    });
    await setDoc(doc(db, 'devices/DEVICE_A'), { name: 'Device A' });
    await setDoc(doc(db, 'devices/DEVICE_B'), { name: 'Device B' });
    await setDoc(doc(db, 'stock/STOCK_A'), { quantity: 9, shopId: 'SHOP_A' });
    await setDoc(doc(db, 'shopAccess/SHOP_A'), {
      active: true, sessionVersion: 3
    });
    await setDoc(doc(db, 'clientSessions/SESSION_OK'), {
      active: true, shopId: 'SHOP_A', expiresAt: future(), sessionVersion: 3
    });
    await setDoc(doc(db, 'clientSessions/SESSION_EXPIRED'), {
      active: true, shopId: 'SHOP_A', expiresAt: past(), sessionVersion: 3
    });
    await setDoc(doc(db, 'clientSessions/SESSION_OLD_VERSION'), {
      active: true, shopId: 'SHOP_A', expiresAt: future(), sessionVersion: 2
    });
  });
}

function client(sid = 'SESSION_OK') {
  return env.authenticatedContext('qr-client', {
    role: 'client', shopId: 'SHOP_A', sid
  }).firestore();
}
function seller() {
  return env.authenticatedContext('seller-a').firestore();
}
function admin() {
  return env.authenticatedContext('admin-a').firestore();
}

describe('Firestore security rules — QR/PIN catalog', () => {
  before(async () => {
    env = await initializeTestEnvironment({
      projectId: PROJECT_ID,
      firestore: {
        host: '127.0.0.1',
        port: 8080,
        rules: fs.readFileSync('firestore.rules', 'utf8')
      }
    });
  });

  beforeEach(async () => {
    await env.clearFirestore();
    await seed();
  });

  after(async () => {
    await env.cleanup();
  });

  it('permits a QR client to read only enabled devices in its own shop', async () => {
    const db = client();
    await assertSucceeds(getDoc(doc(db, 'devices/DEVICE_A')));
    await assertFails(getDoc(doc(db, 'devices/DEVICE_B')));
    await assertFails(getDoc(doc(db, 'shops/SHOP_B')));
  });

  it('denies QR clients all stock reads and writes', async () => {
    const db = client();
    await assertFails(getDoc(doc(db, 'stock/STOCK_A')));
    await assertFails(setDoc(doc(db, 'stock/CLIENT_WRITE'), { quantity: 1 }));
  });

  it('denies expired, revoked-version and inactive sessions', async () => {
    await assertFails(getDoc(doc(client('SESSION_EXPIRED'), 'devices/DEVICE_A')));
    await assertFails(getDoc(doc(client('SESSION_OLD_VERSION'), 'devices/DEVICE_A')));
    await env.withSecurityRulesDisabled(async context => {
      await setDoc(doc(context.firestore(), 'shopAccess/SHOP_A'), {
        active: false, sessionVersion: 3
      });
    });
    await assertFails(getDoc(doc(client(), 'devices/DEVICE_A')));
  });

  it('allows Seller to manage own shop catalog but not another shop or stock', async () => {
    const db = seller();
    await assertSucceeds(getDoc(doc(db, 'shopCatalog/SHOP_A')));
    await assertSucceeds(setDoc(doc(db, 'shopCatalog/SHOP_A'), {
      enabledDeviceIds: ['DEVICE_A', 'DEVICE_B']
    }));
    await assertFails(getDoc(doc(db, 'shopCatalog/SHOP_B')));
    await assertFails(setDoc(doc(db, 'shopCatalog/SHOP_B'), {
      enabledDeviceIds: ['DEVICE_B']
    }));
    await assertFails(getDoc(doc(db, 'stock/STOCK_A')));
  });

  it('allows Admin to read stock and shop catalogs', async () => {
    const db = admin();
    await assertSucceeds(getDoc(doc(db, 'stock/STOCK_A')));
    await assertSucceeds(getDoc(doc(db, 'shopCatalog/SHOP_B')));
  });
});
