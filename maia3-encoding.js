/* Codificación Maia3 (CSSLab/maia3, AGPL-3.0; ver vendor/maia3/ORIGEN.md): misma posición, historia,
   vocabulario y espejo que maia3/dataset.py y maia3/utils.py. */
const ChessMaia3Encoding = (() => {
 'use strict';
 const C = typeof Chess !== 'undefined' ? Chess : require('./vendor/chess.js').Chess,
  HISTORY = 8,
  PLANES = 12,
  WIDTH = HISTORY * PLANES,
  MOVES = 4352;
 let vocabulary = null,
  lookup = null;
 function position(fen) {
  const b = new C();
  if (!b.load(fen)) throw Error('La posición FEN no es válida.');
  return b;
 }
 // get_all_possible_moves(): 64×64 origen-destino (a1=0, b1=1 … h8=63) y luego e7e8q… para cada columna.
 function moves() {
  if (vocabulary) return vocabulary;
  const name = (s) => String.fromCharCode(97 + (s % 8)) + (1 + Math.floor(s / 8)),
   out = [];
  for (let from = 0; from < 64; from++) for (let to = 0; to < 64; to++) out.push(name(from) + name(to));
  for (const a of 'abcdefgh') for (const b of 'abcdefgh') for (const piece of 'qrbn') out.push(a + '7' + b + '8' + piece);
  vocabulary = out;
  lookup = new Map(out.map((m, i) => [m, i]));
  return out;
 }
 function mirrorMove(move) {
  if (!/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(move)) throw Error('La jugada UCI no es válida.');
  return move[0] + (9 - Number(move[1])) + move[2] + (9 - Number(move[3])) + move.slice(4);
 }
 // tokenize_board(): con negras al turno, board.mirror() da vuelta el tablero y cambia los colores; la casilla
 // lleva un 1 en pieza (P N B R Q K = 0-5) + 6 si es del rival.
 function boardTokens(fen) {
  const b = position(fen),
   black = b.turn() === 'b',
   out = new Float32Array(64 * PLANES);
  for (let rank = 0; rank < 8; rank++)
   for (let file = 0; file < 8; file++) {
    const piece = b.get(String.fromCharCode(97 + file) + (rank + 1));
    if (!piece) continue;
    const square = (black ? 7 - rank : rank) * 8 + file,
     own = (piece.color === 'w') !== black;
    out[square * PLANES + 'pnbrqk'.indexOf(piece.type) + (own ? 0 : 6)] = 1;
   }
  return out;
 }
 // get_historical_tokens(): las posiciones van de la más antigua a la actual y, si faltan, se repite la más
 // antigua. Sin historia (como el motor UCI oficial sin --use-uci-history) se repite la posición actual.
 function tokens(fen, history = []) {
  const boards = [...(Array.isArray(history) ? history : []), fen].slice(-HISTORY).map(boardTokens),
   out = new Float32Array(64 * WIDTH);
  while (boards.length < HISTORY) boards.unshift(boards[0]);
  for (let square = 0; square < 64; square++)
   boards.forEach((board, i) =>
    out.set(board.subarray(square * PLANES, (square + 1) * PLANES), square * WIDTH + i * PLANES)
   );
  return out;
 }
 // Elo de Lichess: el modelo lo limita a 0-5000 y lo interpola sin cubos.
 function elo(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) throw Error('El Elo no es válido.');
  return Math.max(0, Math.min(5000, Math.round(n)));
 }
 function legalIndices(fen) {
  moves();
  const b = position(fen),
   black = b.turn() === 'b';
  return b
   .moves({ verbose: true })
   .map((m) => {
    let move = m.from + m.to + (m.promotion || '');
    if (black) move = mirrorMove(move);
    const index = lookup.get(move);
    if (index === undefined) throw Error('El vocabulario de Maia no contiene una jugada legal.');
    return index;
   })
   .sort((a, b) => a - b);
 }
 function decode(logits, fen) {
  if (logits.length !== MOVES) throw Error('La salida de Maia tiene un tamaño incorrecto.');
  const all = moves(),
   legal = legalIndices(fen),
   out = {},
   black = fen.trim().split(/\s+/)[1] === 'b';
  if (!legal.length) return out;
  const max = Math.max(...legal.map((i) => logits[i])),
   weights = legal.map((i) => Math.exp(logits[i] - max)),
   sum = weights.reduce((a, b) => a + b, 0);
  if (!Number.isFinite(sum) || sum <= 0) throw Error('Maia devolvió probabilidades inválidas.');
  legal.forEach((index, i) => {
   out[black ? mirrorMove(all[index]) : all[index]] = weights[i] / sum;
  });
  return out;
 }
 // logits_value = [derrota, tablas, victoria] de quien mueve → puntuación esperada 0-1, como el valor de Maia-2.
 function value(logits) {
  const max = Math.max(logits[0], logits[1], logits[2]),
   e = [0, 1, 2].map((i) => Math.exp(logits[i] - max)),
   sum = e[0] + e[1] + e[2];
  return (e[2] + e[1] / 2) / sum;
 }
 return { HISTORY, WIDTH, MOVES, moves, mirrorMove, boardTokens, tokens, elo, legalIndices, decode, value };
})();
if (typeof module !== 'undefined') module.exports = ChessMaia3Encoding;
if (typeof globalThis !== 'undefined') globalThis.ChessMaia3Encoding = ChessMaia3Encoding;
