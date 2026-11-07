/* Descarga verificada e inferencia aislada. Ninguna posición ni PGN se guarda. */
const ChessMaiaWorker = (() => {
 'use strict';
 const SHA = '5ee68930831a70541f10b2182238552a852eea4e57a02cefe4035ec5ef55d216',
  BYTES = 42538441,
  CACHE = 'chess-maia2-fp16-v1';
 const VOCAB_SHA = '51c2e0b27cee55239b32cb3ab1dfae202a649ed7f6e990d153594653eb05c72b';
 // Maia3-5M (opción «Modelo de Maia» en Ajustes): pesos FP16, cálculo FP32; ver vendor/maia3/ORIGEN.md.
 const SHA3 = '49a0d9a8bfc5078b3e09aba35da5d72873c97019a99ea8b4a8136f7ae2d191b1',
  BYTES3 = 10867453,
  CACHE3 = 'chess-maia3-5m-v1';
 // Misma prueba que ort.wasm.min.js: sin SIMD (iOS anterior a 16.4) onnxruntime no arranca.
 const SIMD = new Uint8Array([
  0, 97, 115, 109, 1, 0, 0, 0, 1, 4, 1, 96, 0, 0, 3, 2, 1, 0, 10, 30, 1, 28, 0, 65, 0, 253, 15, 253, 12, 0, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 253, 186, 1, 26, 11
 ]);
 const simd = (wasm) => {
  try {
   return !!wasm?.validate(SIMD);
  } catch (e) {
   return false;
  }
 };
 function createService({
  ort,
  encoding,
  Chess,
  fetcher = fetch,
  storage = globalThis.caches,
  crypto = globalThis.crypto,
  wasm = globalThis.WebAssembly,
  base = 'vendor/maia2/',
  manifestURL = base + 'maia2-partes.json',
  expectedSHA = SHA,
  expectedBytes = BYTES,
  cacheName = CACHE,
  // Maia-2 lee y verifica su vocabulario; Maia3 lo genera en maia3-encoding.js (vocabulary: null).
  vocabularyFile = 'all_moves.json',
  model = 'maia2',
  progress = () => {}
 }) {
  let session = null,
   vocabulary = null,
   controller = null,
   generation = 0,
   loading = null,
   stored = false,
   queue = Promise.resolve();
  const cacheKey = base + 'modelo-' + expectedSHA + '.onnx';
  const digest = async (bytes) =>
   Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (b) =>
    b.toString(16).padStart(2, '0')
   ).join('');
  const check = (token) => {
   if (token !== generation || controller?.signal.aborted)
    throw Object.assign(Error('Descarga de Maia cancelada.'), { name: 'AbortError' });
  };
  async function verified(bytes, sha, size) {
   if (bytes.length !== size || (await digest(bytes)) !== sha)
    throw Error('El archivo de Maia está dañado o incompleto. Vuelve a descargarlo.');
   return bytes;
  }
  async function load({ lowMemory = false } = {}) {
   if (session) return { bytes: expectedBytes, cached: stored, stored };
   if (loading) return loading;
   const token = ++generation;
   controller = new AbortController();
   loading = (async () => {
    if (!simd(wasm))
     throw Error(
      'Este navegador no puede ejecutar Maia: necesita WebAssembly SIMD (en iPhone y iPad, iOS 16.4 o posterior). Puedes seguir con las partidas del rival.'
     );
    let cache,
     bytes,
     cached = false,
     saved = false;
    const partialKeys = [];
    try {
     cache = await storage?.open(cacheName);
     const hit = await cache?.match(cacheKey);
     if (hit) {
      try {
       bytes = await verified(new Uint8Array(await hit.arrayBuffer()), expectedSHA, expectedBytes);
       cached = true;
      } catch (e) {
       await cache.delete(cacheKey);
       throw e;
      }
     }
    } catch (e) {
     if (/dañado/.test(e.message)) throw e;
    }
    check(token);
    if (!bytes) {
     const response = await fetcher(manifestURL, { signal: controller.signal, credentials: 'same-origin' });
     if (!response.ok) throw Error('No se pudo descargar Maia. Comprueba la conexión e inténtalo de nuevo.');
     const manifest = await response.json();
     if (
      manifest.formato !== 1 ||
      manifest.sha256 !== expectedSHA ||
      manifest.bytes !== expectedBytes ||
      !Array.isArray(manifest.partes) ||
      !manifest.partes.length ||
      manifest.partes.reduce((n, p) => n + p.bytes, 0) !== expectedBytes
     )
      throw Error('La lista de archivos de Maia está dañada.');
     bytes = new Uint8Array(expectedBytes);
     let received = 0,
      offset = 0;
     for (const part of manifest.partes) {
      check(token);
      if (
       !/^[a-zA-Z0-9_.-]+$/.test(part.archivo) ||
       !Number.isSafeInteger(part.bytes) ||
       part.bytes <= 0 ||
       part.bytes > 8 * 1024 * 1024 ||
       !/^[a-f0-9]{64}$/.test(part.sha256)
      )
       throw Error('La lista de archivos de Maia está dañada.');
      const partKey = base + 'parte-' + expectedSHA + '-' + part.sha256 + '.bin';
      partialKeys.push(partKey);
      let chunk = null;
      // Una parte solo sirve con los mismos bytes y la misma huella del listado actual.
      try {
       const hit = await cache?.match(partKey);
       if (hit) {
        try {
         chunk = await verified(new Uint8Array(await hit.arrayBuffer()), part.sha256, part.bytes);
        } catch (e) {
         await cache.delete(partKey);
        }
       }
      } catch (e) {}
      check(token);
      if (chunk) {
       received += part.bytes;
       progress({ stage: 'download', done: received, total: expectedBytes, cached: false });
      } else {
       const r = await fetcher(base + part.archivo + '?v=' + expectedSHA.slice(0, 16), {
        signal: controller.signal,
        credentials: 'same-origin'
       });
       if (!r.ok) throw Error('No se pudo descargar Maia. Comprueba la conexión e inténtalo de nuevo.');
       chunk = new Uint8Array(part.bytes);
       let n = 0;
       if (r.body?.getReader) {
        const reader = r.body.getReader();
        try {
         while (true) {
          check(token);
          const { done, value } = await reader.read();
          if (done) break;
          if (n + value.length > chunk.length) throw Error('El archivo de Maia está dañado o incompleto.');
          chunk.set(value, n);
          n += value.length;
          received += value.length;
          progress({ stage: 'download', done: received, total: expectedBytes, cached: false });
         }
        } finally {
         reader.releaseLock();
        }
       } else {
        const raw = new Uint8Array(await r.arrayBuffer());
        if (raw.length !== part.bytes) throw Error('El archivo de Maia está dañado o incompleto.');
        chunk.set(raw);
        n = raw.length;
        received += n;
        progress({ stage: 'download', done: received, total: expectedBytes, cached: false });
       }
       if (n !== part.bytes) throw Error('El archivo de Maia está dañado o incompleto.');
       await verified(chunk, part.sha256, part.bytes);
       check(token);
       // Persistir antes de pedir la siguiente permite reanudar incluso tras terminar el worker.
       try {
        await cache?.put(partKey, new Response(chunk, { headers: { 'content-type': 'application/octet-stream' } }));
       } catch (e) {}
      }
      check(token);
      bytes.set(chunk, offset);
      offset += part.bytes;
     }
     progress({ stage: 'verify', done: expectedBytes, total: expectedBytes, cached: false });
     await verified(bytes, expectedSHA, expectedBytes);
     check(token);
    }
    progress({ stage: 'initialize', done: expectedBytes, total: expectedBytes, cached });
    if (vocabularyFile) {
     const moves = await fetcher(base + vocabularyFile, { signal: controller.signal, credentials: 'same-origin' });
     if (!moves.ok) throw Error('No se pudo leer el vocabulario de Maia. Comprueba la conexión.');
     vocabulary = await moves.json();
     if (
      !Array.isArray(vocabulary) ||
      vocabulary.length !== 1880 ||
      new Set(vocabulary).size !== 1880 ||
      (await digest(new TextEncoder().encode(JSON.stringify(vocabulary)))) !== VOCAB_SHA
     )
      throw Error('El vocabulario de Maia está dañado.');
    }
    check(token);
    // Se guarda antes de crear la sesión para no tener a la vez la copia de la respuesta y la memoria de onnxruntime.
    // Sin espacio o en navegación privada, Maia igual funciona en esta sesión (stored: false).
    if (!cached && cache) {
     try {
      await cache.put(cacheKey, new Response(bytes, { headers: { 'content-type': 'application/octet-stream' } }));
      saved = true;
     } catch (e) {}
    }
    const forget = async () => {
     if (saved) await cache.delete(cacheKey).catch(() => {});
    };
    if (token !== generation || controller?.signal.aborted) {
     await forget();
     check(token);
    }
    ort.env.wasm.numThreads = 1;
    ort.env.wasm.proxy = false;
    // Con poca memoria se omiten las optimizaciones de disposición: 147 MB de WebAssembly en vez de 211, ~1,5 veces más lento.
    let active;
    try {
     active = await ort.InferenceSession.create(bytes, {
      executionProviders: ['wasm'],
      ...(lowMemory ? { graphOptimizationLevel: 'extended' } : {})
     });
    } catch (e) {
     await forget();
     check(token);
     throw Error('Maia no pudo ejecutarse en este navegador. Puedes seguir con las partidas del rival.');
    }
    if (token !== generation) {
     await active.release();
     await forget();
     check(token);
    }
    session = active;
    stored = cached || saved;
    if (stored && cache) {
     try {
      const keys = await cache.keys();
      for (const key of keys) if (String(key.url || key).includes('/parte-')) await cache.delete(key);
     } catch (e) {
      for (const key of partialKeys)
       try {
        await cache.delete(key);
       } catch {}
     }
    }
    return { bytes: expectedBytes, cached, stored };
   })()
    .catch((e) => {
     if (e.name === 'AbortError') throw Object.assign(Error('Descarga de Maia cancelada.'), { name: 'AbortError' });
     if (e.name === 'SyntaxError') throw Error('Un archivo de Maia está dañado o incompleto. Vuelve a descargarlo.');
     if (e instanceof TypeError) throw Error('No se pudo descargar Maia. Comprueba la conexión e inténtalo de nuevo.');
     throw e;
    })
    .finally(() => {
     loading = null;
     controller = null;
    });
   return loading;
  }
  // Maia3: 8 posiciones de historia por casilla y Elo sin cubos; misma respuesta { moves, value } que Maia-2.
  async function infer3(positions) {
   const out = [],
    width = encoding.WIDTH;
   for (let start = 0; start < positions.length; start += 32) {
    const batch = positions.slice(start, start + 32),
     tokens = new Float32Array(batch.length * 64 * width),
     self = new Float32Array(batch.length),
     oppo = new Float32Array(batch.length);
    batch.forEach((p, i) => {
     tokens.set(encoding.tokens(p.fen, p.history), i * 64 * width);
     self[i] = encoding.elo(p.eloSelf);
     oppo[i] = encoding.elo(p.eloOppo);
    });
    const result = await session.run({
     tokens: new ort.Tensor('float32', tokens, [batch.length, 64, width]),
     elo_self: new ort.Tensor('float32', self, [batch.length]),
     elo_oppo: new ort.Tensor('float32', oppo, [batch.length])
    });
    batch.forEach((p, i) =>
     out.push({
      moves: encoding.decode(result.logits_move.data.subarray(i * encoding.MOVES, (i + 1) * encoding.MOVES), p.fen),
      value: encoding.value(result.logits_value.data.subarray(i * 3, i * 3 + 3))
     })
    );
   }
   return out;
  }
  async function infer(positions) {
   if (!session) throw Error('Activa Maia en «Jugar contra el rival» antes de pedir una predicción.');
   if (!Array.isArray(positions) || positions.length > 512) throw Error('El lote de posiciones no es válido.');
   if (model === 'maia3') return infer3(positions);
   const out = [];
   for (let start = 0; start < positions.length; start += 32) {
    const batch = positions.slice(start, start + 32),
     boards = new Float32Array(batch.length * 1152),
     self = new BigInt64Array(batch.length),
     oppo = new BigInt64Array(batch.length);
    batch.forEach((p, i) => {
     boards.set(encoding.boardTensor(p.fen), i * 1152);
     self[i] = BigInt(encoding.eloCategory(p.eloSelf));
     oppo[i] = BigInt(encoding.eloCategory(p.eloOppo));
    });
    const result = await session.run({
     boards: new ort.Tensor('float32', boards, [batch.length, 18, 8, 8]),
     elo_self: new ort.Tensor('int64', self, [batch.length]),
     elo_oppo: new ort.Tensor('int64', oppo, [batch.length])
    });
    batch.forEach((p, i) =>
     out.push({
      moves: encoding.decode(result.logits_maia.data.subarray(i * 1880, (i + 1) * 1880), p.fen, vocabulary),
      value: Math.max(0, Math.min(1, result.logits_value.data[i] / 2 + 0.5))
     })
    );
   }
   return out;
  }
  // ORT comparte buffers: toda inferencia y liberación se serializa.
  function predictMany(positions) {
   const task = queue.then(() => infer(positions));
   queue = task.catch(() => {});
   return task;
  }
  function cancel() {
   generation++;
   controller?.abort();
  }
  async function clear() {
   cancel();
   await loading?.catch(() => {});
   await queue;
   await session?.release();
   session = null;
   vocabulary = null;
   stored = false;
   await storage?.delete(cacheName);
   return { cleared: true };
  }
  return { load, predict: async (p) => (await predictMany([p]))[0], predictMany, cancel, clear };
 }
 return { createService, SHA, BYTES, CACHE, SHA3, BYTES3, CACHE3 };
})();
if (typeof module !== 'undefined') module.exports = ChessMaiaWorker;
if (typeof importScripts === 'function') {
 const maia3 = new URLSearchParams(self.location.search).get('modelo') === 'maia3';
 importScripts(
  'vendor/ort/ort.wasm.min.js',
  'vendor/chess.js',
  maia3 ? 'maia3-encoding.js?v=2026-11-07-maia3' : 'maia2-encoding.js?v=2026-10-30-formato-3-9'
 );
 ort.env.wasm.wasmPaths = new URL('vendor/ort/', self.location.href).href;
 let currentRequest = null;
 const progress = (p) => postMessage({ type: 'progress', request: currentRequest, ...p });
 const service = maia3
  ? ChessMaiaWorker.createService({
     ort,
     encoding: ChessMaia3Encoding,
     Chess,
     base: new URL('vendor/maia3/', self.location.href).href,
     manifestURL: new URL('vendor/maia3/maia3-partes.json', self.location.href).href,
     expectedSHA: ChessMaiaWorker.SHA3,
     expectedBytes: ChessMaiaWorker.BYTES3,
     cacheName: ChessMaiaWorker.CACHE3,
     vocabularyFile: null,
     model: 'maia3',
     progress
    })
  : ChessMaiaWorker.createService({
     ort,
     encoding: ChessMaia2Encoding,
     Chess,
     base: new URL('vendor/maia2/', self.location.href).href,
     progress
    });
 self.onmessage = async ({ data }) => {
  const { type, request } = data || {};
  if (type === 'cancel') {
   service.cancel();
   return;
  }
  try {
   let result;
   if (type === 'load') {
    currentRequest = request;
    result = await service.load({ lowMemory: !!data.lowMemory });
   } else if (type === 'predict') result = await service.predict(data);
   else if (type === 'predictMany') result = await service.predictMany(data.positions);
   else if (type === 'clear') result = await service.clear();
   else throw Error('Instrucción de Maia desconocida.');
   postMessage({ type: 'result', request, result });
  } catch (e) {
   postMessage({ type: 'error', request, message: e.message, cancelled: e.name === 'AbortError' });
  }
 };
}
