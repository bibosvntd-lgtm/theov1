/* Lokale Laufzeit für Theo's Projekte: ersetzt die Claude-Konto-Funktionen (db, user, assets, downloads)
   durch Speicherung in IndexedDB direkt auf diesem Gerät. Funktioniert vollständig offline. */
(() => {
  'use strict';
  /* Sichtbare Fehleranzeige (hilft bei der Fehlersuche auf dem iPad) */
  const showErr = m => {
    try {
      let b = document.getElementById('kp-err');
      if (!b) { b = document.createElement('div'); b.id = 'kp-err'; b.style.cssText = 'position:fixed;left:8px;right:8px;bottom:8px;z-index:2147483647;background:#7a0c14;color:#fff;font:13px/1.35 -apple-system,sans-serif;padding:10px 12px;border-radius:10px;white-space:pre-wrap;max-height:40vh;overflow:auto';
        b.onclick = () => b.remove(); (document.body || document.documentElement).append(b); }
      b.textContent = 'Fehler (zum Schließen tippen):\n' + String(m).slice(0, 600) + '\n' + (b.dataset.n = (+b.dataset.n || 0) + 1);
    } catch (e) {}
  };
  addEventListener('error', e => showErr((e.message || 'Fehler') + (e.filename ? '\n' + e.filename.split('/').pop() + ':' + e.lineno : '')));
  addEventListener('unhandledrejection', e => showErr('Promise: ' + ((e.reason && (e.reason.message || e.reason.code)) || e.reason)));
  const DBN = 'theos-projekte', ST_DOCS = 'docs', ST_BLOB = 'blobs';
  const idb = new Promise((res, rej) => {
    const to = setTimeout(() => rej(new Error('IndexedDB antwortet nicht')), 8000);
    try {
      const r = indexedDB.open(DBN, 1);
      r.onupgradeneeded = () => { const d = r.result; d.createObjectStore(ST_DOCS); d.createObjectStore(ST_BLOB); };
      r.onsuccess = () => { clearTimeout(to); res(r.result); }; r.onerror = () => { clearTimeout(to); rej(r.error); };
      r.onblocked = () => { clearTimeout(to); rej(new Error('IndexedDB blockiert')); };
    } catch (e) { clearTimeout(to); rej(e); }
  });
  idb.catch(() => {});
  const tx = async (store, mode, fn) => {
    const d = await idb;
    return new Promise((res, rej) => {
      const t = d.transaction(store, mode); let out;
      try { out = fn(t.objectStore(store)); } catch (e) { rej(e); return; }
      t.oncomplete = () => res(out && 'result' in out ? out.result : out); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error);
    });
  };
  const store = new Map();   // "pfad/id" -> data   (Spiegel im Speicher)
  const subs = new Map();    // collectionPath -> Set(fn)
  let ready = null;
  const load = () => ready || (ready = (async () => {
    const d = await idb;
    await new Promise((res, rej) => {
      const t = d.transaction(ST_DOCS, 'readonly'), rq = t.objectStore(ST_DOCS).openCursor();
      rq.onsuccess = () => { const c = rq.result; if (c) { store.set(c.key, c.value); c.continue(); } };
      t.oncomplete = res; t.onerror = () => rej(t.error);
    });
    try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) {}
  })());
  const clone = o => JSON.parse(JSON.stringify(o));
  const deep = (o, n) => { const r = { ...o }; for (const k in n) { r[k] = (n[k] && typeof n[k] === 'object' && !Array.isArray(n[k]) && o && typeof o[k] === 'object' && o[k]) ? deep(o[k], n[k]) : n[k]; } return r; };
  const snapOf = cp => {
    const pre = cp + '/', docs = [];
    for (const [k, v] of store) { if (k.startsWith(pre) && !k.slice(pre.length).includes('/')) docs.push({ id: k.slice(pre.length), exists: true, data: () => clone(v), metadata: { fromCache: false, hasPendingWrites: false } }); }
    docs.sort((a, b) => a.id.localeCompare(b.id));
    return { docs, size: docs.length, empty: !docs.length, metadata: { fromCache: false, hasPendingWrites: false }, docChanges: () => [] };
  };
  const notify = cp => setTimeout(() => (subs.get(cp) || []).forEach(fn => { try { fn(snapOf(cp)); } catch (e) {} }), 0);
  const put = async (key, val) => { await tx(ST_DOCS, 'readwrite', s => { s.put(val, key); }); };
  const del = async key => { await tx(ST_DOCS, 'readwrite', s => { s.delete(key); }); };
  const err = (code, message) => Object.assign(new Error(message || code), { code });
  const docRef = (cp, id) => {
    const key = cp + '/' + id;
    return {
      id, path: key,
      async set(d) { await load(); const v = clone(d); await put(key, v); store.set(key, v); notify(cp); },
      async update(d) { await load(); if (!store.has(key)) throw err('invalid_argument'); const v = deep(store.get(key), clone(d)); await put(key, v); store.set(key, v); notify(cp); },
      async delete() { await load(); await del(key); store.delete(key); notify(cp); },
      collection(name) { return collRef(key + '/' + name); },
    };
  };
  const rid = () => 'i' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  const collRef = cp => ({
    path: cp,
    doc(id) { return docRef(cp, id || rid()); },
    onSnapshot(next, onErr) {
      if (!subs.has(cp)) subs.set(cp, new Set());
      subs.get(cp).add(next);
      load().then(() => next(snapOf(cp)), e => onErr && onErr(err('unavailable', String(e))));
      return () => subs.get(cp) && subs.get(cp).delete(next);
    },
  });
  const db = { doc(p) { const s = p.split('/'); return docRef(s.slice(0, -1).join('/'), s[s.length-1]); }, collection: collRef };

  const user = {
    id: async () => 'lokal',
    me: async () => ({ name: 'Theo', email: 'Gespeichert auf diesem Gerät' }),
    isOwner: async () => true,
  };

  const newId = () => { const a = new Uint8Array(18); crypto.getRandomValues(a); return 'a' + [...a].map(x => (x % 36).toString(36)).join(''); };
  const assets = {
    async upload(blob, o) {
      const id = newId(), type = (o && o.type) || blob.type || 'application/octet-stream';
      const buf = await blob.arrayBuffer();
      await tx(ST_BLOB, 'readwrite', s => { s.put({ buf, type }, id); });
      return { id, url: URL.createObjectURL(new Blob([buf], { type })), sizeBytes: buf.byteLength, contentType: type };
    },
    async get(id) {
      const rec = await new Promise(async (res, rej) => { const d = await idb; const rq = d.transaction(ST_BLOB, 'readonly').objectStore(ST_BLOB).get(id); rq.onsuccess = () => res(rq.result); rq.onerror = () => rej(rq.error); });
      return rec ? new Blob([rec.buf], { type: rec.type }) : null;
    },
    async delete(id) { await tx(ST_BLOB, 'readwrite', s => { s.delete(id); }); return { deleted: true }; },
    async list() { return { assets: [], usage: {} }; },
  };

  const MIME = { zip: 'application/zip', pdf: 'application/pdf', json: 'application/json', txt: 'text/plain' };
  const downloads = {
    async save({ filename, data }) {
      const ext = (filename.split('.').pop() || '').toLowerCase();
      const blob = data instanceof Blob ? data : new Blob([data], { type: MIME[ext] || 'application/octet-stream' });
      const typed = blob.type ? blob : new Blob([blob], { type: MIME[ext] || 'application/octet-stream' });
      /* Sicherungen: Teilen-Menü (→ „In Dateien sichern“, z. B. Synology Drive / NAS) */
      if (/sicherung/i.test(filename) && navigator.canShare && navigator.share) {
        const f = new File([typed], filename, { type: typed.type });
        try { if (navigator.canShare({ files: [f] })) { await navigator.share({ files: [f], title: filename }); return { status: 'saved' }; } }
        catch (e) { if (e && e.name === 'AbortError') throw err('declined'); /* sonst normaler Download */ }
      }
      const url = URL.createObjectURL(typed), a = document.createElement('a');
      a.href = url; a.download = filename; document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      return { status: 'saved' };
    },
  };
  const caps = { db, user, assets, downloads };
  window.claude = { use: n => Promise.resolve(caps[n] || null), local: true };
  window.__local = { store, load };
})();
