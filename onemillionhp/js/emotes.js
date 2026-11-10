// Chat emotes: "(meow)" in a message is drawn as a tiny animated ASCII sprite
// (a cat strolling along the line). Client-side only: the message text stays
// "(meow)", so old clients and the server see plain text. Every sprite is one
// line, its frames padded to one width so the line never jiggles. One shared
// ticker steps the sprites that are on screen (CHAT lines get .in-view from
// inview.js); low effects or reduced motion shows the first frame, still.

/** The (snail): it inches right, leaving a green slime trail (".", painted
 * .emote-slime) that dries up from the far end once it stops. */
function snailFrames() {
  const STEPS = 8;
  const frames = [];
  for (let at = 0; at <= STEPS; at += 1) {
    for (const eyes of ["'", '"']) frames.push(`${".".repeat(at)}_@_/${eyes}`); // eyestalks wiggle each step
  }
  for (let dry = 1; dry <= STEPS; dry += 1) frames.push(`${" ".repeat(dry)}${".".repeat(STEPS - dry)}_@_/'`);
  frames.push(`${" ".repeat(STEPS)}_@_/'`, `${" ".repeat(STEPS)}_@_/"`);
  return frames;
}

/** The (fish) (ticket #294): it swims right blowing bubbles ("o"/"O",
 * painted .emote-bubble), turns round and swims back. */
function fishFrames() {
  const W = 8; // room to swim
  const R = "><(((°>";
  const L = "<°)))><";
  const bubble = (/** @type {number} */ i) => (i % 3 === 0 ? " o" : i % 3 === 1 ? " O" : "  ");
  const frames = [];
  for (let at = 0; at <= W; at += 1) frames.push(`${" ".repeat(at)}${R}${bubble(at)}`.padEnd(W + R.length + 2));
  frames.push(`${" ".repeat(W)}${L}  `, `${" ".repeat(W)}${L}  `); // turns round
  for (let at = W - 1; at >= 0; at -= 1) { // bubbles trail out of its mouth, just in front of it
    const b = bubble(at).trim();
    frames.push(`${" ".repeat(Math.max(0, at - 1))}${at && b ? b : at ? " " : ""}${L}`.padEnd(W + L.length + 2));
  }
  frames.push(`${R}`.padEnd(W + R.length + 2), `${R}`.padEnd(W + R.length + 2)); // and faces the way it came
  return frames;
}

/** Picker groups, in the order the filter lists them. */
export const EMOTE_GROUPS = /** @type {const} */ ([
  ["animals", "ANIMALS"], ["faces", "FACES"], ["people", "PEOPLE"], ["things", "THINGS"],
]);

/** name -> frames (one line each), ms per frame, colour class, picker group;
 * ``paint`` colours single characters (the snail's trail) with their own class.
 * @type {Record<string, {frames: string[], ms: number, cls?: string, hint: string, group: string,
 *   paint?: Record<string, string>}>} */
export const EMOTES = {
  meow: {
    group: "animals",
    hint: "a cat strolls by",
    ms: 220,
    frames: [
      "~=^.^=      ", " ~=^.^=     ", "  ~=^.^=    ", "   ~=^.^=   ", "    ~=^.^=  ", "     ~=^o^= ",
      "     ~=^o^= ", "     =^.^=~ ", "    =^.^=~  ", "   =^.^=~   ", "  =^.^=~    ", " =^.^=~     ",
      "=^o^=~      ", "=^o^=~      ",
    ],
  },
  // A duck waddles left quacking (beak open toward the front, - shut), turns round and waddles back.
  quack: {
    group: "animals",
    hint: "a duck waddles by",
    ms: 220,
    cls: "emote-gold",
    frames: [
      "       >(^)_", "      -(^)_ ", "     >(^)_  ", "    -(^)_   ", "   >(^)_    ", "  -(^)_     ",
      " >(^)_      ", ">(^)_       ", "-(^)_       ", ">(^)_       ", "-(^)_       ",
      "_(^)<       ", " _(^)-      ", "  _(^)<     ", "   _(^)-    ", "    _(^)<   ", "     _(^)-  ",
      "      _(^)< ", "       _(^)<", "       _(^)-", "       _(^)<", "       _(^)-",
    ],
  },
  woof: { group: "animals", hint: "a happy dog", ms: 260, frames: ["U^w^U  ", "U^o^U !", "U^w^U  ", "U^w^U~ "] },
  // A little bird hops in, chirps, then flaps away (praise the Loot Bird; ticket #196).
  // Ducks and birds are happy too: ^ eyes, like the cat and dog (ticket #330).
  bird: {
    group: "animals",
    hint: "a bird hops in, chirps and flies off",
    ms: 230,
    cls: "emote-sky",
    frames: [
      "(^)>          ", " (^)>         ", "  (^)>        ", "   (^)>       ", "   (^)> chirp ",
      "   (^)>       ", "   (^)> chirp ", "   (^)>       ",
      "    \\v/       ", "     -v-      ", "      \\v/     ", "       -v-    ", "        \\v/   ",
      "         -v-  ", "          \\v/ ", "           -v-", "              ", "              ",
    ],
  },
  // A fish swims by blowing bubbles, turns round and swims back (ticket #294).
  fish: {
    group: "animals", hint: "a fish swims by blowing bubbles", ms: 200, cls: "emote-fish",
    paint: { o: "emote-bubble", O: "emote-bubble" }, frames: fishFrames(),
  },
  // A slow snail and its green slime trail.
  snail: {
    group: "animals", hint: "a snail inches along", ms: 420, cls: "emote-snail",
    paint: { ".": "emote-slime" }, frames: snailFrames(),
  },
  // Ticket #143: dozing off, the Zs drifting out.
  sleep: {
    group: "faces",
    hint: "fast asleep",
    ms: 420,
    cls: "emote-dream",
    frames: ["(-.-)    ", "(-.-) z  ", "(-.-) zZ ", "(-.-) zZz", "(-o-)  Zz", "(-.-)   z", "(-.-)    "],
  },
  // Shakes with rage, then flips the table (it lands upside down).
  rage: {
    group: "faces",
    hint: "flips the table",
    ms: 200,
    cls: "emote-red",
    paint: { "[": "emote-wood", "]": "emote-wood", "=": "emote-wood" },
    frames: [
      "(>_<)  [===]   ", " (>_<) [===]   ", "(>_<)  [===]   ", " (>_<) [===]   ", "#(>O<)/[===]   ",
      "#(>O<)/  /===/ ", "#(>O<)/    |  ", "#(>O<)/   \\===\\", "(>_<)/    ]===[", "(-_-)     ]===[",
      "(-_-)     ]===[", "(-_-)     ]===[",
    ],
  },
  // A double take: the eyes go wide and the jaw drops.
  shock: {
    group: "faces",
    hint: "totally shocked",
    ms: 220,
    frames: ["(o_o)    ", "(o_o)    ", "(0o0)    ", " (0O0) ! ", "(0O0) !! ", " (0O0) !!", "(0o0)  ! ", "(0o0)    "],
  },
  wink: { group: "faces", hint: "a cheeky wink", ms: 300, frames: ["(^_^)  ", "(^_^)  ", "(^_^)  ", "(^_~) *", "(^_~)  ", "(^_^)  "] },
  // Knocked out; their soul floats off and away.
  dead: {
    group: "faces",
    hint: "knocked out",
    ms: 260,
    cls: "emote-dead",
    paint: { o: "emote-soul", O: "emote-soul", ".": "emote-soul" },
    frames: ["(x_x)      ", "(x_x)      ", "(x_x) .    ", "(x_x)  o   ", "(x_x)   O  ", "(x_x)    o ", "(x_x)     .", "(x_x)      "],
  },
  // Sobbing, the tears (painted blue) dripping.
  cry: {
    group: "faces",
    hint: "sobbing",
    ms: 260,
    paint: { ",": "emote-tear", ".": "emote-tear", "'": "emote-tear" },
    frames: ["(T_T)    ", "(T_T)'   ", "(T_T),   ", "(T_T),.  ", "(ToT),.. ", "(T_T) .. ", "(T_T)  . ", "(T_T)    "],
  },
  // Ticket #359 (BRUXD's concepts).
  shifty: { group: "faces", hint: "shifty eyes", ms: 420, frames: ["(>.>)", "(>.>)", "(<.<)", "(<.<)", "(>.>)", "(>.>)"] },
  worried: { group: "faces", hint: "nervous sweat", ms: 360, paint: { '"': "emote-tear" }, frames: ['(o_o")', '(o_o")', '(-_-")', '(o_o")'] },
  confused: { group: "faces", hint: "dizzy and confused", ms: 300, frames: ["(@.@)", "(@o@)", "(@.@)", "(@.@)"] },
  overjoyed: { group: "faces", hint: "over the moon", ms: 220, frames: ["/(^v^)/", "|(^v^)|", "\\(^v^)\\", "|(^v^)|"] },
  mighty: {
    group: "people",
    hint: "flexing",
    ms: 260,
    paint: { "*": "emote-gold" },
    frames: ["o_,_   ", "o_,/   ", "o_o7   ", "o_o7 .*", "o_o7 *.", "o_o7   ", "o_,/   ", "o_,_   "],
  },
  wave: { group: "people", hint: "hello!", ms: 200, frames: ["o/", "o-", "o/", "o|"] },
  // o7: the arm swings up and snaps to the brow (a glint on the snap), holds, then drops.
  salute: {
    group: "people",
    hint: "o7 a crisp salute",
    ms: 170,
    paint: { "*": "emote-gold" },
    frames: [
      "o_  ", "o_  ", "o-  ", "o/  ", "o7 *", "o7  ", "o7  ", "o7  ", "o7  ", "o7  ", "o7  ", "o7  ",
      "o7  ", "o7  ", "o/  ", "o-  ", "o_  ", "o_  ",
    ],
  },
  dance: { group: "people", hint: "busting a move", ms: 220, frames: ["\\o/", "|o|", "/o\\", "|o|"] },
  heart: { group: "things", hint: "a beating heart", ms: 180, cls: "emote-red", frames: ["<3", "<3", "<3", "  ", "<3", "  "] },
  fire: { group: "things", hint: "it's lit", ms: 140, cls: "emote-fire", frames: ["^.^", ".^^", "^^.", "^.^", "^^^"] },
  boom: { group: "things", hint: "kaboom", ms: 130, cls: "emote-amber", frames: ["  *  ", " +*+ ", "*+*+*", "* . *", " . . ", "     "] },
  gg: { group: "things", hint: "good game", ms: 260, cls: "emote-gold", frames: ["GG ", "gg ", "GG!", "gg "] },
  rip: { group: "things", hint: "a ghost floats up", ms: 300, frames: ["[RIP]   ", "[RIP] . ", "[RIP] o ", "[RIP]  O", "[RIP]   "] },
  lol: { group: "faces", hint: "laughing", ms: 180, frames: ["XD", "xD", "XD", "Xd"] },
  sus: { group: "faces", hint: "suspicious", ms: 350, frames: ["(o.o)", "(o.O)", "(O.o)", "(-.-)"] },
  shrug: { group: "people", hint: "who knows", ms: 450, frames: ["\\_(o_o)_/", "_/(o_o)\\_"] },
  cool: { group: "faces", hint: "deal with it", ms: 260, frames: ["(o_o)  ", "(o_o)  ", "(o_o)-o", "(-o_o) ", "(#_#)  ", "(#_#)  "] },
  // Ticket #129: a siren light, its beam sweeping back and forth (red/blue: .emote-siren).
  alarm: { group: "things", hint: "sound the alarm", ms: 160, cls: "emote-siren", frames: ["=(@)  ", " (@)  ", "  (@)=", " (@)  "] },
};

const TOKEN = /\(([a-z]{2,12})\)/gi;
/** Sprites on the page: their element and where they are in the loop. @type {Set<HTMLElement>} */
const live = new Set();
/** @type {ReturnType<typeof setInterval> | undefined} */
let ticker;
const TICK = 40;

const still = () => document.documentElement.classList.contains("fx-low")
  || window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Put one frame in a sprite: plain text, or runs of painted characters in their own spans.
 * @param {HTMLElement} span @param {typeof EMOTES[string]} def @param {string} text */
function draw(span, def, text) {
  const paint = def.paint;
  if (!paint) {
    span.textContent = text;
    return;
  }
  /** @type {(string | Node)[]} */
  const parts = [];
  let run = "";
  let runCls = "";
  const flush = () => {
    if (!run) return;
    if (runCls) {
      const s = document.createElement("span");
      s.className = runCls;
      s.textContent = run;
      parts.push(s);
    } else parts.push(run);
    run = "";
  };
  for (const ch of text) {
    const cls = paint[ch] ?? "";
    if (cls !== runCls) {
      flush();
      runCls = cls;
    }
    run += ch;
  }
  flush();
  span.replaceChildren(...parts);
}

/** One sprite, padded to its widest frame. @param {string} name */
export function emoteNode(name) {
  const def = EMOTES[name];
  const width = Math.max(...def.frames.map((f) => f.length));
  const span = document.createElement("span");
  span.className = `emote${def.cls ? ` ${def.cls}` : ""}`;
  draw(span, def, def.frames[0].padEnd(width));
  span.title = `(${name}) ${def.hint}`;
  span.dataset.emote = name;
  span.dataset.width = String(width);
  span.dataset.at = "0";
  span.dataset.t = "0";
  live.add(span);
  ticker ??= setInterval(step, TICK);
  return span;
}

/** Plain text with any known (emote) swapped for its sprite. @param {string} text @returns {(string | Node)[]} */
export function withEmotes(text) {
  /** @type {(string | Node)[]} */
  const out = [];
  let last = 0;
  for (const m of text.matchAll(TOKEN)) {
    const name = m[1].toLowerCase();
    if (!EMOTES[name]) continue;
    out.push(text.slice(last, m.index), emoteNode(name));
    last = (m.index ?? 0) + m[0].length;
  }
  out.push(text.slice(last));
  return out.filter((x) => x !== "");
}

function step() {
  if (document.visibilityState !== "visible") return;
  const calm = still();
  for (const span of live) {
    if (!span.isConnected) {
      live.delete(span);
      continue;
    }
    const def = EMOTES[span.dataset.emote ?? ""];
    // Only what you can see moves: a CHAT line off screen, or the picker closed, rests.
    const host = span.closest("li, .emote-pick");
    const shown = !host || host.classList.contains("in-view") || host.matches(".emote-pick")
      || Boolean(host.closest(".all-in-view"));
    if (!def || calm || !shown) continue;
    const t = Number(span.dataset.t) + TICK;
    if (t < def.ms) {
      span.dataset.t = String(t);
      continue;
    }
    const at = (Number(span.dataset.at) + 1) % def.frames.length;
    span.dataset.at = String(at);
    span.dataset.t = "0";
    draw(span, def, def.frames[at].padEnd(Number(span.dataset.width)));
  }
  if (!live.size) {
    clearInterval(ticker);
    ticker = undefined;
  }
}
