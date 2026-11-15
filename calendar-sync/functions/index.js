const { timingSafeEqual } = require('node:crypto');
const { initializeApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore } = require('firebase-admin/firestore');
const { defineJsonSecret } = require('firebase-functions/params');
const { onRequest } = require('firebase-functions/v2/https');

initializeApp();
const family = defineJsonSecret('FAMILY_CALENDAR_ACCESS');

function tokenMatches(received, expected){
  if(typeof expected !== 'string' || !/^[a-f0-9]{64}$/.test(expected)) return false;
  return received.length === expected.length &&
    timingSafeEqual(Buffer.from(received), Buffer.from(expected));
}

function isDate(value){
  if(typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + 'T00:00:00Z');
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function validateSnapshot(body){
  const events = body?.events;
  const capturedAt = Date.parse(body?.capturedAt);
  if(!Array.isArray(events) || events.length > 1500 ||
     !Number.isFinite(capturedAt) || capturedAt > Date.now() + 300000 ||
     capturedAt < Date.now() - 86400000) return null;

  const unique = new Map();
  for(const event of events){
    if(!event || !isDate(event.start) || !isDate(event.end) || event.end < event.start ||
       typeof event.title !== 'string' || !event.title.trim() || event.title.length > 160 ||
       typeof event.calendar !== 'string' || !event.calendar.trim() || event.calendar.length > 100) return null;
    const clean = {title:event.title.trim(), start:event.start, end:event.end, calendar:event.calendar.trim()};
    unique.set(JSON.stringify(clean), clean);
  }
  return { capturedAt, events: [...unique.values()] };
}

exports.familyCalendar = onRequest({
  region: 'asia-northeast3',
  cors: ['https://jkm29.github.io'],
  secrets: [family],
  maxInstances: 2
}, async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const bearer = (req.get('authorization') || '').match(/^Bearer ([\x21-\x7e]+)$/)?.[1];
  if(!bearer) return res.sendStatus(401);
  const access = family.value();
  const snapshots = getFirestore().collection('calendarSnapshots');

  if(req.method === 'GET'){
    let identity;
    try{
      identity = await getAuth().verifyIdToken(bearer, true);
    }catch{
      return res.sendStatus(401);
    }
    if(!identity.email_verified || identity.firebase.sign_in_provider !== 'google.com' ||
       !access.emails.includes(identity.email?.toLowerCase())) return res.sendStatus(403);

    const docs = await snapshots.get();
    const unique = new Map();
    for(const doc of docs.docs){
      const { events } = doc.data();
      for(const event of events) unique.set(JSON.stringify(event), event);
    }
    return res.json({ events: [...unique.values()].sort((a, b) => a.start.localeCompare(b.start)) });
  }

  if(req.method !== 'PUT') return res.sendStatus(405);
  const source = Object.keys(access.devices).find(id => tokenMatches(bearer, access.devices[id]));
  if(!source) return res.sendStatus(403);
  const snapshot = validateSnapshot(req.body);
  if(!snapshot) return res.status(400).json({ error: 'Invalid calendar snapshot' });

  const doc = snapshots.doc(source);
  const applied = await getFirestore().runTransaction(async transaction => {
    const previous = await transaction.get(doc);
    if((previous.data()?.capturedAt || 0) >= snapshot.capturedAt) return false;
    transaction.set(doc, snapshot);
    return true;
  });
  return res.json({ applied });
});
