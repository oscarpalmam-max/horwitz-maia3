/* Maia3-5M con la MISMA interfaz que maia2-client.js (load, predict, predictMany, status, on, activity…).
   Va detrás de la opción «Modelo de Maia» (por defecto Maia-2) hasta revisar docs/medicion-maia3.md.
   Se carga después de maia2-client.js: si la opción dice Maia3, window.ChessMaia2 pasa a ser este cliente. */
const ChessMaia3Client = (() => {
 'use strict';
 const SHA = '49a0d9a8bfc5078b3e09aba35da5d72873c97019a99ea8b4a8136f7ae2d191b1',
  BYTES = 10867453,
  CACHE = 'chess-maia3-5m-v1',
  PREF = 'chess-maia-modelo-v1';
 const MAIA3 = {
  model: 'maia3',
  name: 'Maia3-5M',
  sha: SHA,
  bytes: BYTES,
  cache: CACHE,
  base: 'vendor/maia3/',
  worker: 'maia-worker.js?v=2026-11-07-maia3&modelo=maia3'
 };
 const Base = typeof ChessMaia2Client !== 'undefined' ? ChessMaia2Client : require('./maia2-client.js');
 class Client extends Base.Client {
  constructor(makeWorker) {
   super(makeWorker, MAIA3);
  }
 }
 // Preferencia local (no entra en respaldos ni en «Compartir»); se aplica al recargar la página.
 function chosen(storage = globalThis.localStorage) {
  try {
   return storage?.getItem(PREF) === 'maia3' ? 'maia3' : 'maia2';
  } catch (e) {
   return 'maia2';
  }
 }
 function choose(model, storage = globalThis.localStorage) {
  try {
   if (model === 'maia3') storage.setItem(PREF, 'maia3');
   else storage.removeItem(PREF);
   return true;
  } catch (e) {
   return false;
  }
 }
 return { Client, SHA, BYTES, CACHE, PREF, MAIA3, chosen, choose };
})();
if (typeof module !== 'undefined') module.exports = ChessMaia3Client;
if (typeof window !== 'undefined') {
 window.ChessMaiaModel = {
  active: ChessMaia3Client.chosen(),
  chosen: () => ChessMaia3Client.chosen(),
  choose: (model) => ChessMaia3Client.choose(model),
  models: { maia2: ChessMaia2Client.MAIA2, maia3: ChessMaia3Client.MAIA3 }
 };
 if (window.ChessMaiaModel.active === 'maia3') window.ChessMaia2 = new ChessMaia3Client.Client();
}
