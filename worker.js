/* * DEVICE PROPOSER ADMIN WORKER - MULTI ADMIN */



const CORS_HEADERS = {

  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',

  'Access-Control-Allow-Headers': 'Content-Type, Authorization',

  'Access-Control-Max-Age': '86400'

};



const ROOT_ADMIN_EMAIL = 'admin@deviceproposer.invalid';



const json = (data, status = 200, origin = '*') =>

  new Response(JSON.stringify(data), {

    status,

    headers: {

      'Content-Type': 'application/json; charset=utf-8',

      ...CORS_HEADERS,

      'Access-Control-Allow-Origin': origin

    }

  });



const enc = value => new TextEncoder().encode(value);



const b64url = bytes =>

  btoa(String.fromCharCode(...new Uint8Array(bytes)))

    .replace(/=/g, '')

    .replace(/\+/g, '-')

    .replace(/\//g, '_');



function parseBearer(request) {

  const h = request.headers.get('Authorization') || '';

  return h.startsWith('Bearer ') ? h.slice(7).trim() : '';

}



function decodeValue(v) {

  if (!v || typeof v !== 'object') return null;

  if ('stringValue' in v) return v.stringValue;

  if ('booleanValue' in v) return v.booleanValue;

  if ('integerValue' in v) return Number(v.integerValue);

  if ('doubleValue' in v) return v.doubleValue;

  if ('timestampValue' in v) return v.timestampValue;

  if ('nullValue' in v) return null;

  if ('mapValue' in v) return decodeFields(v.mapValue.fields || {});

  if ('arrayValue' in v) return (v.arrayValue.values || []).map(decodeValue);

  return null;

}



function decodeFields(fields = {}) {

  return Object.fromEntries(

    Object.entries(fields).map(([k, v]) => [k, decodeValue(v)])

  );

}



function firestoreFields(obj) {

  const fields = {};



  for (const [k, v] of Object.entries(obj)) {

    if (v === undefined) continue;



    if (v === null) fields[k] = { nullValue: null };

    else if (typeof v === 'string') fields[k] = { stringValue: v };

    else if (typeof v === 'boolean') fields[k] = { booleanValue: v };

    else if (typeof v === 'number' && Number.isInteger(v))

      fields[k] = { integerValue: String(v) };

    else if (typeof v === 'number')

      fields[k] = { doubleValue: v };

    else if (v instanceof Date)

      fields[k] = { timestampValue: v.toISOString() };

  }



  return fields;

}



async function googleAccessToken(env) {

  const sa = JSON.parse(env.GOOGLE_SERVICE_ACCOUNT_JSON || '{}');



  if (!sa.client_email || !sa.private_key) {

    throw new Error('Service account JSON non valido.');

  }



  const now = Math.floor(Date.now() / 1000);



  const header = b64url(

    enc(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))

  );



  const claim = b64url(enc(JSON.stringify({

    iss: sa.client_email,

    scope: 'https://www\.googleapis.com/auth/datastore https://www\.googleapis.com/auth/identitytoolkit',

    aud: sa.token_uri || 'https://oauth2.googleapis.com/token',

    iat: now,

    exp: now + 3600

  })));



  const unsigned = header + '.' + claim;



  const pem = sa.private_key.replace(

    /-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g,

    ''

  );



  const key = await crypto.subtle.importKey(

    'pkcs8',

    Uint8Array.from(atob(pem), c => c.charCodeAt(0)),

    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },

    false,

    ['sign']

  );



  const signature = await crypto.subtle.sign(

    'RSASSA-PKCS1-v1_5',

    key,

    enc(unsigned)

  );



  const assertion = unsigned + '.' + b64url(signature);



  const response = await fetch(

    sa.token_uri || 'https://oauth2.googleapis.com/token',

    {

      method: 'POST',

      headers: {

        'Content-Type': 'application/x-www-form-urlencoded'

      },

      body: new URLSearchParams({

        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',

        assertion

      })

    }

  );



  const data = await response.json();



  if (!response.ok || !data.access_token) {

    throw new Error(

      data.error_description || data.error || 'Token Google non ottenuto.'

    );

  }



  return data.access_token;

}



async function identityLookup(idToken, env) {

  const r = await fetch(

    `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${env.FIREBASE_API_KEY}`,

    {

      method: 'POST',

      headers: { 'Content-Type': 'application/json' },

      body: JSON.stringify({ idToken })

    }

  );



  const d = await r.json();



  if (!r.ok || !d.users?.[0]) {

    throw new Error('Token Firebase non valido o scaduto.');

  }



  return d.users[0];

}



async function identityLookupByEmail(email, env, googleToken) {

  const url = `https://identitytoolkit.googleapis.com/v1/projects/${encodeURIComponent(env.FIREBASE_PROJECT_ID)}/accounts:lookup`;



  const r = await fetch(url, {

    method: 'POST',

    headers: {

      Authorization: `Bearer ${googleToken}`,

      'Content-Type': 'application/json'

    },

    body: JSON.stringify({ email: [email] })

  });



  const d = await r.json().catch(() => ({}));



  if (r.ok && d.users?.[0]) return d.users[0];



  const message = d.error?.message || '';



  if (/EMAIL_NOT_FOUND|USER_NOT_FOUND/i.test(message)) return null;



  throw new Error(`Errore nella ricerca dell'account ${email}: ${message || `HTTP ${r.status}`}`);

}



async function fsRequest(path, token, method = 'GET', body) {

  const r = await fetch(

    `https://firestore.googleapis.com/v1/${path}`,

    {

      method,

      headers: {

        Authorization: `Bearer ${token}`,

        'Content-Type': 'application/json'

      },

      body: body ? JSON.stringify(body) : undefined

    }

  );



  const d = await r.json().catch(() => ({}));



  if (!r.ok) {

    throw new Error(d.error?.message || `Firestore HTTP ${r.status}`);

  }



  return d;

}



const userDocPath = (project, uid) =>

  `projects/${project}/databases/(default)/documents/users/${encodeURIComponent(uid)}`;



async function getProfile(project, uid, token) {

  try {

    const d = await fsRequest(userDocPath(project, uid), token);

    return decodeFields(d.fields || {});

  } catch (e) {

    if (/NOT_FOUND|404/.test(e.message)) return null;

    throw e;

  }

}



/* Qualsiasi amministratore attivo può gestire gli account. */

async function requireAdmin(request, env, googleToken) {

  const idToken = parseBearer(request);

  if (!idToken) throw new Error('Autenticazione richiesta.');



  let authUser;



  try {

    authUser = await identityLookup(idToken, env);

  } catch (e) {

    throw new Error(`ADMIN_IDENTITY_LOOKUP: ${e.message}`);

  }



  let profile;



  try {

    profile = await getProfile(

      env.FIREBASE_PROJECT_ID,

      authUser.localId,

      googleToken

    );

  } catch (e) {

    throw new Error(`ADMIN_FIRESTORE_PROFILE: ${e.message}`);

  }



  if (!profile || profile.role !== 'admin' || profile.active !== true) {

    throw new Error('Account amministratore non valido o disattivato.');

  }



  return authUser;

}



async function requireActiveSeller(request, env, googleToken) {

  const idToken = parseBearer(request);



  if (!idToken) throw new Error('Autenticazione richiesta.');



  const authUser = await identityLookup(idToken, env);



  const profile = await getProfile(

    env.FIREBASE_PROJECT_ID,

    authUser.localId,

    googleToken

  );



  if (!profile || profile.role !== 'seller' || profile.active !== true) {

    throw new Error('Account dipendente non valido o disattivato.');

  }



  return { authUser, profile };

}



async function getShop(project, shopId, token) {

  if (!shopId || shopId.includes('/')) {

    throw new Error('Negozio non valido.');

  }



  const d = await fsRequest(

    `projects/${project}/databases/(default)/documents/shops/${encodeURIComponent(shopId)}`,

    token

  );



  const shop = decodeFields(d.fields || {});



  if (shop.active === false) {

    throw new Error('Il negozio selezionato è disattivato.');

  }



  return shop;

}



async function identityCreate(email, password, env) {

  const r = await fetch(

    `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${env.FIREBASE_API_KEY}`,

    {

      method: 'POST',

      headers: { 'Content-Type': 'application/json' },

      body: JSON.stringify({

        email,

        password,

        returnSecureToken: false

      })

    }

  );



  const d = await r.json();



  if (!r.ok || !d.localId) {

    throw new Error(

      d.error?.message || 'Creazione account Firebase non riuscita.'

    );

  }



  return d.localId;

}



async function identitySetPassword(uid, password, env, googleToken) {

  const url = `https://identitytoolkit.googleapis.com/v1/projects/${encodeURIComponent(env.FIREBASE_PROJECT_ID)}/accounts:update`;



  const r = await fetch(url, {

    method: 'POST',

    headers: {

      Authorization: `Bearer ${googleToken}`,

      'Content-Type': 'application/json'

    },

    body: JSON.stringify({ localId: uid, password })

  });



  const d = await r.json().catch(() => ({}));



  if (!r.ok) {

    throw new Error(d.error?.message || `Aggiornamento password non riuscito (HTTP ${r.status}).`);

  }

}



async function identityLookupByUid(uid, env, googleToken) {

  const url = `https://identitytoolkit.googleapis.com/v1/projects/${encodeURIComponent(env.FIREBASE_PROJECT_ID)}/accounts:lookup`;



  const r = await fetch(url, {

    method: 'POST',

    headers: {

      Authorization: `Bearer ${googleToken}`,

      'Content-Type': 'application/json'

    },

    body: JSON.stringify({ localId: [uid] })

  });



  const d = await r.json().catch(() => ({}));



  if (r.ok && d.users?.[0]) return d.users[0];



  const message = d.error?.message || '';



  if (/USER_NOT_FOUND|EMAIL_NOT_FOUND/i.test(message)) return null;



  throw new Error(`Impossibile verificare l'account Firebase (${message || `HTTP ${r.status}`}).`);

}



async function identityDeleteUser(uid, project, googleToken, env) {

  const r = await fetch(

    `https://identitytoolkit.googleapis.com/v1/projects/${encodeURIComponent(project)}/accounts:delete`,

    {

      method: 'POST',

      headers: {

        Authorization: `Bearer ${googleToken}`,

        'Content-Type': 'application/json'

      },

      body: JSON.stringify({ localId: uid })

    }

  );



  const d = await r.json().catch(() => ({}));



  // Se l'utente Auth è già stato cancellato, possiamo comunque ripulire Firestore.*

  if (!r.ok) {

    throw new Error(d.error?.message || 'Eliminazione da Firebase Authentication non riuscita.');

  }



  const remaining = await identityLookupByUid(uid, env, googleToken);



  if (remaining) {

    throw new Error('L’account risulta ancora presente in Firebase. Profilo Firestore lasciato intatto.');

  }

}



async function isRootAdmin(uid, env, googleToken) {

  const target = await identityLookupByUid(uid, env, googleToken);



  if (!target) throw new Error('Account Firebase non trovato. Nessuna cancellazione eseguita.');



  return String(target.email || '').toLowerCase() === ROOT_ADMIN_EMAIL.toLowerCase();

}



async function handle(request, env) {

  const allowed = env.ALLOWED_ORIGIN || '*';

  const origin = request.headers.get('Origin') || '';

  const url = new URL(request.url);



  /* Health check pubblico */

  if (request.method === 'GET' && url.pathname === '/health') {

    return json(

      { success: true, service: 'device-proposer-admin' },

      200,

      '*'

    );

  }



  /* CORS */

  if (allowed !== '*' && origin !== allowed) {

    return json(

      { success: false, error: 'Origine non autorizzata.' },

      403,

      allowed

    );

  }



  if (request.method === 'OPTIONS') {

    return new Response(null, {

      status: 204,

      headers: {

        ...CORS_HEADERS,

        'Access-Control-Allow-Origin': allowed

      }

    });

  }



  if (

    !env.FIREBASE_PROJECT_ID ||

    !env.FIREBASE_API_KEY ||

    !env.GOOGLE_SERVICE_ACCOUNT_JSON

  ) {

    return json(

      { success: false, error: 'Configurazione Worker incompleta.' },

      500,

      allowed

    );

  }



  if (request.method !== 'POST') {

    return json(

      { success: false, error: 'Metodo non supportato.' },

      405,

      allowed

    );

  }



  let body = {};



  try {

    body = await request.json();

  } catch {

    return json(

      { success: false, error: 'JSON non valido.' },

      400,

      allowed

    );

  }



  let diagnosticStage = 'GOOGLE_ACCESS_TOKEN';



  try {

    const googleToken = await googleAccessToken(env);



    diagnosticStage = 'ROUTE:' + url.pathname;



    /* Caricamento immagini prodotto su GitHub: solo admin, file nuovi, niente overwrite. */

    if (url.pathname === '/images/upload') {

      await requireAdmin(request, env, googleToken);



      if (!env.GITHUB_TOKEN) {

        throw new Error('Segreto GITHUB_TOKEN non configurato nel Worker.');

      }



      const modelId = String(body.modelId || '').toLowerCase();

      const fileName = String(body.fileName || '');

      const contentType = String(body.contentType || '');

      const contentBase64 = String(body.contentBase64 || '').replace(/^data:[^,]+;base64,/, '');



      if (!/^[a-z0-9-]{1,120}$/.test(modelId)) {

        throw new Error('Identificativo modello non valido.');

      }



      if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,100}$/.test(fileName) || fileName.includes('..')) {

        throw new Error('Nome file non valido.');

      }



      const allowedTypes = {

        'image/jpeg': '.jpg',

        'image/png': '.png',

        'image/webp': '.webp'

      };



      if (!allowedTypes[contentType] || !fileName.toLowerCase().endsWith(allowedTypes[contentType])) {

        throw new Error('Formato immagine non supportato. Usa JPG, PNG o WEBP.');

      }



      if (!contentBase64 || contentBase64.length > 8 * 1024 * 1024 * 1.37) {

        throw new Error('Immagine vuota o superiore al limite di 8 MB.');

      }



      const path = `images/models/${modelId}/${fileName}`;

      const apiUrl = `https://api.github.com/repos/MBRP95/ListinoSmartphones/contents/${path.split('/').map(encodeURIComponent).join('/')}`;


      const headers = {

        Authorization: `Bearer ${env.GITHUB_TOKEN}`,

        Accept: 'application/vnd.github+json',

        'X-GitHub-Api-Version': '2022-11-28',

        'Content-Type': 'application/json'

      };



      const existing = await fetch(apiUrl, { headers });



      if (existing.ok) {

        throw new Error('Questa immagine esiste già su GitHub. Non viene sovrascritta.');

      }



      if (existing.status !== 404) {

        const detail = await existing.json().catch(() => ({}));

        throw new Error(detail.message || `Verifica GitHub non riuscita (HTTP ${existing.status}).`);

      }



      const uploaded = await fetch(apiUrl, {

        method: 'PUT',

        headers,

        body: JSON.stringify({

          message: `Aggiunge immagine per ${modelId}`,

          content: contentBase64,

          branch: 'main'

        })

      });



      const result = await uploaded.json().catch(() => ({}));



      if (!uploaded.ok) {

        throw new Error(result.message || `Caricamento GitHub non riuscito (HTTP ${uploaded.status}).`);

      }



      const imageUrl = `https://raw\.githubusercontent.com/MBRP95/ListinoSmartphones/main/${path}`;



      return json({ success: true, path, imageUrl, sha: result.content?.sha || null }, 200, allowed);

    }



    /* Verifica amministratore */

    if (url.pathname === '/verify-admin') {

      await requireAdmin(request, env, googleToken);

      return json({ success: true }, 200, allowed);

    }



    /* Password account condivisi storici */

    if (url.pathname === '/password') {

      await requireAdmin(request, env, googleToken);



      const map = {

        client: 'cliente@deviceproposer.invalid',

        seller: 'dipendenti@deviceproposer.invalid',

        admin: ROOT_ADMIN_EMAIL

      };



      const email = map[body.target];



      if (

        !email ||

        typeof body.newPassword !== 'string' ||

        body.newPassword.length < 8 ||

        body.newPassword.length > 128

      ) {

        throw new Error('Account o password non validi.');

      }



      const target = await identityLookupByEmail(email, env, googleToken);



      if (!target) throw new Error('Account condiviso non trovato.');



      await identitySetPassword(target.localId, body.newPassword, env, googleToken);



      return json({ success: true }, 200, allowed);

    }



    /* Elenco dipendenti e amministratori */

    if (url.pathname === '/users/list') {

      diagnosticStage = 'USERS_LIST_ADMIN_CHECK';



      await requireAdmin(request, env, googleToken);



      diagnosticStage = 'USERS_LIST_FIRESTORE_QUERY';



      const d = await fsRequest(

        `projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents/users?pageSize=1000`,

        googleToken

      );



      const users = (d.documents || [])

        .map(doc => ({

          uid: doc.name.split('/').pop(),

          ...decodeFields(doc.fields || {})

        }))

        .filter(u => ['seller', 'admin'].includes(u.role))

        .map(u => ({

          uid: u.uid,

          username: u.username || '',

          role: u.role,

          displayName: u.displayName || '',

          shopId: u.shopId || '',

          shopName: u.shopName || '',
          active: u.active === true

        }));



      return json({ success: true, users }, 200, allowed);

    }



    /* Creazione account dipendente o amministratore */

    if (url.pathname === '/users/create') {

      await requireAdmin(request, env, googleToken);



      const username = String(body.username || '').trim().toLowerCase();

      const displayName = String(body.displayName || '').trim();

      const role = body.role;

      const password = String(body.password || '');

      const shopId = String(body.shopId || '').trim();



      if (!/^[a-z0-9._-]{3,40}$/.test(username)) {

        throw new Error('Username non valido.');

      }



      if (!['seller', 'admin'].includes(role)) {

        throw new Error('Tipo account non valido.');

      }



      if (password.length < 8 || password.length > 128) {

        throw new Error('La password deve contenere 8–128 caratteri.');

      }



      let shopName = '';



      if (role === 'seller') {

        if (!shopId) throw new Error('Seleziona un negozio.');



        const shop = await getShop(

          env.FIREBASE_PROJECT_ID,

          shopId,

          googleToken

        );



        shopName = shop.name || shopId;

      }



      const uid = await identityCreate(

        `${username}@deviceproposer.invalid`,

        password,

        env

      );



      try {

        const fields = firestoreFields({

          username,

          displayName,

          role,

          shopId: role === 'seller' ? shopId : null,

          shopName: role === 'seller' ? shopName : null,
          active: true,

          createdAt: new Date(),

          updatedAt: new Date()

        });



        await fsRequest(

          `projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents/users?documentId=${encodeURIComponent(uid)}`,

          googleToken,

          'POST',

          { fields }

        );

      } catch (e) {

        throw new Error(

          `Account Firebase creato ma profilo Firestore non salvato. UID: ${uid}. Errore: ${e.message}`

        );

      }



      return json({

        success: true,

        uid,

        username,

        role

      }, 200, allowed);

    }



    /* Eliminazione definitiva account dipendente o amministratore */

    if (url.pathname === '/users/delete') {

      const admin = await requireAdmin(request, env, googleToken);

      const uid = String(body.uid || '');



      if (!uid || uid.includes('/')) {

        throw new Error('UID non valido.');

      }



      if (uid === admin.localId || await isRootAdmin(uid, env, googleToken)) {

        throw new Error('Non puoi eliminare il tuo account o l’amministratore principale.');

      }



      const profile = await getProfile(

        env.FIREBASE_PROJECT_ID,

        uid,

        googleToken

      );



      if (!profile || !['seller', 'admin'].includes(profile.role)) {

        throw new Error('Account non trovato o non eliminabile.');

      }



      // Prima eliminiamo l'identità; poi il profilo.*

      // Se la seconda operazione fallisce, un nuovo tentativo può completare la pulizia.*

      await identityDeleteUser(uid, env.FIREBASE_PROJECT_ID, googleToken, env);



      try {

        await fsRequest(

          userDocPath(env.FIREBASE_PROJECT_ID, uid),

          googleToken,

          'DELETE'

        );

      } catch (e) {

        throw new Error(

          `Utente rimosso da Authentication, ma pulizia del profilo Firestore non completata: ${e.message}. Ripeti l’eliminazione per completare la pulizia.`

        );

      }



      return json({ success: true }, 200, allowed);

    }



    /* Reset password dipendente o amministratore */

    if (url.pathname === '/users/reset-password') {

      await requireAdmin(request, env, googleToken);



      const uid = String(body.uid || '');

      const password = String(body.password || '');



      const profile = await getProfile(

        env.FIREBASE_PROJECT_ID,

        uid,

        googleToken

      );



      if (!profile || !['seller', 'admin'].includes(profile.role)) {

        throw new Error('Account non trovato.');

      }



      if (password.length < 8 || password.length > 128) {

        throw new Error('La password deve contenere 8–128 caratteri.');

      }



      await identitySetPassword(uid, password, env, googleToken);



      return json({ success: true }, 200, allowed);

    }



    /* Cambio password personale dipendente */

    if (url.pathname === '/password/change') {

      const { authUser } = await requireActiveSeller(

        request,

        env,

        googleToken

      );



      const password = String(body.newPassword || '');



      if (password.length < 8 || password.length > 128) {

        throw new Error('La password deve contenere 8–128 caratteri.');

      }



      await identitySetPassword(authUser.localId, password, env, googleToken);



      return json({ success: true }, 200, allowed);

    }



    return json(

      { success: false, error: 'Endpoint non trovato.' },

      404,

      allowed

    );



  } catch (e) {

    console.error('Worker diagnostic:', diagnosticStage, e?.stack || e);



    return json(

      {

        success: false,

        stage: diagnosticStage,

        error: e.message || 'Errore interno.'

      },

      400,

      allowed

    );

  }

}



export default {

  fetch: handle

};