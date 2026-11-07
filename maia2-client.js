/* Una instancia compartida y perezosa. Solo load() permite descargar el modelo. */
const ChessMaia2Client = (() => {
 'use strict';
 const SHA = '5ee68930831a70541f10b2182238552a852eea4e57a02cefe4035ec5ef55d216',
  BYTES = 42538441,
  CACHE = 'chess-maia2-fp16-v1';
 // maia3-client.js usa la misma clase con otro modelo (misma interfaz).
 const MAIA2 = {
  model: 'maia2',
  name: 'Maia-2',
  sha: SHA,
  bytes: BYTES,
  cache: CACHE,
  base: 'vendor/maia2/',
  worker: 'maia-worker.js?v=2026-11-07-maia3'
 };
 // iPadOS se presenta como Macintosh; Safari no informa deviceMemory.
 const lowMemory = (nav = globalThis.navigator) =>
  !!nav &&
  (/iPhone|iPad|iPod/.test(nav.userAgent) ||
   (/Macintosh/.test(nav.userAgent) && nav.maxTouchPoints > 1) ||
   (nav.deviceMemory || Infinity) <= 4);
 class Client {
  constructor(makeWorker = (url) => new Worker(url), model = MAIA2) {
   this.makeWorker = makeWorker;
   this.model = model;
   this.worker = null;
   this.sequence = 0;
   this.pending = new Map();
   this.cache = new Map();
   this.inFlight = new Map();
   this.listeners = new Set();
   this.loading = null;
   this.epoch = 0;
   this.owners = new Set();
   this.idleTimer = null;
   this.suspended = false;
   this.resuming = null;
   this.state = { state: 'idle', model: model.model, bytes: model.bytes, done: 0, total: model.bytes, message: '' };
  }
  status() {
   return { ...this.state };
  }
  ready() {
   return this.state.state === 'ready';
  }
  lowMemory() {
   return lowMemory();
  }
  on(fn) {
   this.listeners.add(fn);
   return () => this.listeners.delete(fn);
  }
  announce(patch) {
   if (patch.state === 'error') globalThis.ChessDiagnostics?.note('maia', patch.message || 'Maia falló.');
   Object.assign(this.state, patch);
   for (const fn of this.listeners) {
    try {
     fn(this.status());
    } catch (e) {}
   }
  }
  open() {
   if (this.worker) return;
   const worker = this.makeWorker(this.model.worker);
   this.worker = worker;
   worker.onmessage = ({ data }) => {
    if (this.worker !== worker) return;
    const task = this.pending.get(data.request);
    if (!task) return;
    // El plazo de la descarga cuenta desde el último avance: con datos móviles lentos puede durar más de 5 min.
    if (data.type === 'progress') {
     clearTimeout(task.timer);
     task.timer = setTimeout(task.expire, task.limit);
     this.announce({ state: 'loading', ...data });
     return;
    }
    this.pending.delete(data.request);
    clearTimeout(task.timer);
    if (data.type === 'error')
     task.reject(Object.assign(Error(data.message), { name: data.cancelled ? 'AbortError' : 'Error' }));
    else task.resolve(data.result);
   };
   worker.onerror = worker.onmessageerror = () => {
    if (this.worker === worker) {
     this.dispose(Error('Maia no pudo ejecutarse en este navegador. Puedes seguir con las partidas del rival.'));
     this.announce({
      state: 'error',
      message: 'Maia no pudo ejecutarse en este navegador. Puedes seguir con las partidas del rival.'
     });
    }
   };
  }
  dispose(error) {
   clearTimeout(this.idleTimer);
   this.idleTimer = null;
   const worker = this.worker;
   this.worker = null;
   if (worker) {
    worker.onmessage = worker.onerror = worker.onmessageerror = null;
    worker.terminate();
   }
   for (const task of this.pending.values()) {
    clearTimeout(task.timer);
    task.reject(error);
   }
   this.pending.clear();
   this.cache.clear();
   this.inFlight.clear();
   this.epoch++;
  }
  rpc(type, data = {}) {
   try {
    this.open();
   } catch (e) {
    return Promise.reject(Error('Este navegador no pudo iniciar Maia. Puedes seguir con las partidas del rival.'));
   }
   return new Promise((resolve, reject) => {
    const request = ++this.sequence,
     limit = type === 'load' ? 300000 : 60000,
     expire = () => {
      this.dispose(Error('Maia agotó el tiempo de espera. Inténtalo de nuevo.'));
      this.announce({ state: 'error', message: 'Maia agotó el tiempo de espera. Inténtalo de nuevo.' });
     };
    this.pending.set(request, { resolve, reject, limit, expire, timer: setTimeout(expire, limit) });
    try {
     this.worker.postMessage({ type, request, ...data });
    } catch (e) {
     clearTimeout(this.pending.get(request)?.timer);
     this.pending.delete(request);
     reject(Error('No se pudo enviar la instrucción a Maia.'));
    }
   });
  }
  async hasCached() {
   try {
    if (typeof caches === 'undefined') return false;
    const existing = await caches.keys();
    if (!existing.includes(this.model.cache)) return false;
    const cache = await caches.open(this.model.cache),
     key = new URL(
      this.model.base + 'modelo-' + this.model.sha + '.onnx',
      globalThis.document?.baseURI || globalThis.location.href
     ).href;
    return !!(await cache.match(key));
   } catch (e) {
    return false;
   }
  }
  load() {
   if (this.ready()) return Promise.resolve(this.status());
   if (this.loading) return this.loading;
   this.announce({ state: 'loading', stage: 'download', done: 0, total: this.model.bytes, message: '' });
   const epoch = this.epoch;
   const task = this.rpc('load', { lowMemory: this.lowMemory() })
    .then((result) => {
     if (epoch !== this.epoch) throw Object.assign(Error('Descarga de Maia cancelada.'), { name: 'AbortError' });
     this.suspended = false;
     this.announce({ state: 'ready', stage: 'ready', done: this.model.bytes, ...result });
     this.scheduleIdle();
     return this.status();
    })
    .catch((e) => {
     if (epoch === this.epoch) {
      this.dispose(e);
      this.announce({ state: e.name === 'AbortError' ? 'idle' : 'error', message: e.message });
     }
     throw e;
    })
    .finally(() => {
     if (this.loading === task) this.loading = null;
    });
   this.loading = task;
   return task;
  }
  cancel() {
   if (this.state.state !== 'loading') return;
   this.dispose(Object.assign(Error('Descarga de Maia cancelada.'), { name: 'AbortError' }));
   this.loading = null;
   this.announce({ state: 'idle', stage: 'cancelled', message: 'Descarga de Maia cancelada.' });
  }
  async clear() {
   this.cancel();
   await this.rpc('clear');
   this.dispose(Error('Se borró el modelo de Maia.'));
   this.loading = null;
   this.suspended = false;
   this.announce({ state: 'idle', stage: 'cleared', done: 0, message: 'Modelo borrado de este navegador.' });
  }
  // Las vistas y la búsqueda de trampas mantienen sus propios permisos de uso en memoria.
  activity(owner, active) {
   if (active) {
    this.owners.add(owner);
    clearTimeout(this.idleTimer);
    this.idleTimer = null;
    if (this.suspended) this.resumeCached();
   } else {
    this.owners.delete(owner);
    this.scheduleIdle();
   }
  }
  scheduleIdle() {
   if (!this.lowMemory() || this.owners.size || !this.ready() || this.idleTimer) return;
   this.idleTimer = setTimeout(() => {
    this.idleTimer = null;
    this.releaseIdle();
   }, 120000);
  }
  releaseIdle() {
   if (!this.lowMemory() || this.owners.size || !this.ready()) return;
   // Una predicción en curso termina antes de liberar; las trampas conservan un owner todo el trabajo.
   if (this.pending.size || this.loading) {
    this.idleTimer = setTimeout(() => {
     this.idleTimer = null;
     this.releaseIdle();
    }, 1000);
    return;
   }
   this.dispose(Error('Maia liberada por inactividad.'));
   this.suspended = true;
   this.announce({
    state: 'idle',
    stage: 'released',
    message: 'Maia liberó memoria. Al volver se recuperará del modelo guardado en este navegador.'
   });
  }
  resumeCached() {
   if (this.resuming) return this.resuming;
   this.resuming = (async () => {
    if ((await this.hasCached()) && this.suspended && this.owners.size) await this.load();
   })()
    .catch(() => {})
    .finally(() => {
     this.resuming = null;
    });
   return this.resuming;
  }
  // Maia3 admite «history» (FEN anteriores); Maia-2 lo ignora. Ninguna vista lo envía todavía.
  key(p) {
   const history = Array.isArray(p.history) && p.history.length ? '|' + p.history.join(';') : '';
   return p.fen.trim().split(/\s+/).slice(0, 4).join(' ') + '|' + p.eloSelf + '|' + p.eloOppo + history;
  }
  remember(key, value) {
   this.cache.set(key, value);
   if (this.cache.size > 500) this.cache.delete(this.cache.keys().next().value);
  }
  predict(p) {
   if (!this.ready()) return Promise.reject(Error('Activa Maia en «Jugar contra el rival».'));
   const key = this.key(p);
   if (this.cache.has(key)) return Promise.resolve(this.cache.get(key));
   if (this.inFlight.has(key)) return this.inFlight.get(key);
   const epoch = this.epoch,
    task = this.rpc('predict', p)
     .then((result) => {
      if (epoch === this.epoch) this.remember(key, result);
      return result;
     })
     .finally(() => {
      if (this.inFlight.get(key) === task) this.inFlight.delete(key);
     });
   this.inFlight.set(key, task);
   return task;
  }
  async predictMany(positions) {
   if (!this.ready()) throw Error('Activa Maia en «Jugar contra el rival».');
   const unique = new Map();
   for (const p of positions) if (!this.cache.has(this.key(p))) unique.set(this.key(p), p);
   const missing = [...unique.values()],
    epoch = this.epoch;
   for (let i = 0; i < missing.length; i += 32) {
    const batch = missing.slice(i, i + 32),
     results = await this.rpc('predictMany', { positions: batch });
    if (epoch !== this.epoch) throw Error('Maia se desactivó durante la predicción.');
    batch.forEach((p, j) => this.remember(this.key(p), results[j]));
   }
   // La caché acotada puede haber retirado el principio de un lote largo.
   return Promise.all(positions.map((p) => this.predict(p)));
  }
 }
 return { Client, BYTES, SHA, CACHE, MAIA2, lowMemory };
})();
if (typeof module !== 'undefined') module.exports = ChessMaia2Client;
if (typeof window !== 'undefined') window.ChessMaia2 = new ChessMaia2Client.Client();
