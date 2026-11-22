// Envía las notificaciones de Mis Horas. Lo ejecuta GitHub Actions cada 15 minutos.
const admin = require('firebase-admin');

if (!process.env.FIREBASE_SERVICE_ACCOUNT) {
  console.log('Falta el secreto FIREBASE_SERVICE_ACCOUNT. No se envía nada.');
  process.exit(0);
}
admin.initializeApp({ credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)) });
const db = admin.firestore();

const ADMIN_EMAIL = 'cesarjluzardo18@gmail.com';
const APP_URL = 'https://josemanuelluzardo4-design.github.io/mis-horas/';
const DEF = { tarifa: 8, nombre: 'Ana Paola', diasTrabajo: [0, 1, 2, 3, 4], horaAvisoEntrada: '10:00', horasAvisoSalida: 9 };

// ---------- fechas en hora de Madrid ----------
function madridNow() {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false, weekday: 'short'
  }).formatToParts(new Date()).map(x => [x.type, x.value]));
  return {
    f: `${p.year}-${p.month}-${p.day}`,
    min: (Number(p.hour) % 24) * 60 + Number(p.minute),
    wd: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(p.weekday)
  };
}
const addDays = (f, n) => { const d = new Date(f + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const toMin = t => { const [h, m] = String(t).split(':').map(Number); return h * 60 + m; };
const dur = (a, b) => { const x = toMin(a), y = toMin(b); return y >= x ? y - x : y + 1440 - x; };
const eur = n => new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(Math.round(n * 100) / 100);
const horas = m => (Math.round(m / 60 * 100) / 100).toLocaleString('es-ES') + ' h';
const hLong = m => { const h = Math.floor(m / 60), r = m % 60; return h + ' h' + (r ? ' ' + r + ' min' : ''); };

// ---------- envío ----------
async function send(users, title, body, key) {
  if (key) {
    const s = await db.collection('avisos_enviados').doc(key).get();
    if (s.exists) return false;
  }
  const pairs = [];
  users.forEach(u => (u.tokens || []).forEach(t => pairs.push({ uid: u.uid, t })));
  if (pairs.length) {
    const res = await admin.messaging().sendEachForMulticast({
      tokens: pairs.map(p => p.t),
      webpush: {
        notification: { title, body, icon: APP_URL + 'icon-192.png', badge: APP_URL + 'icon-192.png' },
        fcmOptions: { link: APP_URL }
      }
    });
    const bad = {};
    res.responses.forEach((r, i) => {
      if (!r.success) {
        const c = r.error && r.error.code || '';
        console.log('Fallo al enviar:', c);
        if (c.includes('registration-token-not-registered') || c.includes('invalid-registration-token') || c.includes('invalid-argument')) {
          (bad[pairs[i].uid] = bad[pairs[i].uid] || []).push(pairs[i].t);
        }
      }
    });
    for (const [uid, ts] of Object.entries(bad)) {
      await db.collection('usuarios').doc(uid).update({ tokens: admin.firestore.FieldValue.arrayRemove(...ts) });
    }
    console.log(`Enviado «${title}» a ${res.successCount}/${pairs.length} dispositivos`);
  } else {
    console.log(`Sin dispositivos para «${title}»`);
  }
  if (key) await db.collection('avisos_enviados').doc(key).set({ enviado: new Date().toISOString(), title });
  return true;
}

(async () => {
  const usersSnap = await db.collection('usuarios').get();
  const users = usersSnap.docs.map(d => Object.assign({ uid: d.id }, d.data()));
  const admins = users.filter(u => (u.email || '').toLowerCase() === ADMIN_EMAIL);
  const workers = users.filter(u => u.estado === 'aprobado' && (u.email || '').toLowerCase() !== ADMIN_EMAIL);
  const everyone = [...admins, ...workers];

  // Aviso de prueba (lanzado a mano desde GitHub)
  const prueba = (process.env.PRUEBA || '').trim().toLowerCase();
  if (prueba) {
    const to = prueba === 'todos' ? everyone : users.filter(u => (u.email || '').toLowerCase() === prueba);
    await send(to, 'Mis Horas', 'Aviso de prueba: las notificaciones funcionan.', null);
    return;
  }

  const cfgSnap = await db.collection('config').doc('ajustes').get();
  const cfg = Object.assign({}, DEF, cfgSnap.exists ? cfgSnap.data() : {});
  const nombre = cfg.nombre || 'Ana Paola';
  const now = madridNow();
  const today = now.f, yesterday = addDays(today, -1);

  const getDay = async f => { const s = await db.collection('dias').doc(f).get(); return s.exists ? s.data() : null; };
  const dT = await getDay(today), dY = await getDay(yesterday);
  const isOpen = d => d && d.entrada && !d.salida;

  // 1. Recordatorio de entrada
  const workDay = (cfg.diasTrabajo || []).map(Number).includes(now.wd);
  if (workDay && !dT && !isOpen(dY) && now.min >= toMin(cfg.horaAvisoEntrada || '10:00')) {
    await send(workers, '¿Ya empezaste?', 'Todavía no has fichado la entrada de hoy.', `${today}_recEntrada`);
  }

  // 2. Recordatorio de salida
  for (const [f, d] of [[today, dT], [yesterday, dY]]) {
    if (!isOpen(d)) continue;
    const startMin = toMin(d.entrada), nowAbs = now.min + (f === yesterday ? 1440 : 0);
    const elapsed = nowAbs - startMin;
    if (elapsed >= (Number(cfg.horasAvisoSalida) || 9) * 60) {
      await send(workers, '¿Ya saliste?', `Sigues fichada desde las ${d.entrada}. Si ya terminaste, ficha la salida.`, `${f}_recSalida`);
    }
  }

  // 3. Aviso para el administrador cuando ella ficha
  for (const [f, d] of [[today, dT], [yesterday, dY]]) {
    if (!d || !d.entrada || (d.por || '').toLowerCase() === ADMIN_EMAIL) continue;
    if (f === today || d.salida) {
      if (f === today) await send(admins, `${nombre} fichó la entrada`, `Entrada a las ${d.entrada}.`, `${f}_fEntrada`);
      if (d.salida) {
        const m = dur(d.entrada, d.salida), rate = typeof d.tarifa === 'number' ? d.tarifa : cfg.tarifa;
        await send(admins, `${nombre} fichó la salida`, `${d.entrada} – ${d.salida} · ${hLong(m)} · ${eur(m / 60 * rate)}`, `${f}_fSalida`);
      }
    }
  }

  // 4. Aviso de pago para ella
  const pagos = await db.collection('pagos').where('fecha', '>=', addDays(today, -2)).get();
  for (const p of pagos.docs) {
    const v = p.data();
    await send(workers, 'Te han pagado', `${eur(Number(v.importe) || 0)} del ${v.desde.split('-').reverse().join('/')} al ${v.hasta.split('-').reverse().join('/')}.`, `pago_${p.id}`);
  }

  // 5. Resumen semanal: domingo desde las 21:00
  if (now.wd === 6 && now.min >= 21 * 60) {
    const monday = addDays(today, -6);
    const snap = await db.collection('dias').where(admin.firestore.FieldPath.documentId(), '>=', monday)
      .where(admin.firestore.FieldPath.documentId(), '<=', today).get();
    let m = 0, e = 0, n = 0;
    snap.docs.forEach(s => {
      const d = s.data();
      if (d && d.entrada && d.salida) {
        const mm = dur(d.entrada, d.salida);
        m += mm; e += mm / 60 * (typeof d.tarifa === 'number' ? d.tarifa : cfg.tarifa); n++;
      }
    });
    const body = n ? `Esta semana: ${horas(m)} en ${n} ${n === 1 ? 'día' : 'días'} · ${eur(e)}` : 'Esta semana no hay horas apuntadas.';
    await send(everyone, 'Resumen de la semana', body, `${monday}_semanal`);
  }
})().catch(e => { console.error(e); process.exit(1); });
