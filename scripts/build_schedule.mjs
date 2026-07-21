// Build schedule.json: ONE reel per day, from the next day through 2026-08-31.
// Introduces ~3 NEW reels/week and recycles the rest (per the brief). 15 reels total (6 core + 9 new).
// Each posting gets a fresh caption + YouTube title. Usage: node scripts/build_schedule.mjs
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
const __dir = dirname(fileURLToPath(import.meta.url));

const UTM = (slug) =>
  `https://wine.equipment/contact?utm_source=%PLAT%&utm_medium=organic&utm_campaign=reels&utm_content=${slug}`;
const HASH = "#winemaking #wineryequipment #winery #cellar #harvest";

// file (in /reels), stage, caption variants, YouTube title variants
const CORE = [
  { file: "reel-crusher-destemmer-9x16.mp4", stage: "Grape Processing", caps: [
    ["Rollers or paddles? The destemmer is the first machine your fruit meets — spec it like it. Size TON/HR to your PEAK crush day. Link in bio.", "Crusher-Destemmer: 3 checks before you buy"],
    ["Your busiest morning decides your crusher-destemmer. Size to peak intake, not average, or the whole crush pad backs up. Link in bio.", "How to size a crusher-destemmer (TON/HR)"]]},
  { file: "reel-pneumatic-press-9x16.mp4", stage: "Pressing", caps: [
    ["The press is where wine is quietly made or lost. More free-run, cleaner juice — the pressing curve matters more than size. Link in bio.", "How a pneumatic wine press protects juice quality"],
    ["For 20 tons you may not need a bigger press — you need the right curve and a cycle time that keeps up. Link in bio.", "Wine press sizing: cycle time is the spec"]]},
  { file: "reel-fermentation-tank-3checks-9x16.mp4", stage: "Fermentation", caps: [
    ["3 checks before you buy a fermentation tank: variable capacity, the cooling jacket, and 304 vs 316L. From $3,400. Link in bio.", "Fermentation Tank: 3 checks before you buy"],
    ["The one spec buyers get wrong on tanks: the cooling jacket. Coverage + glycol sizing decide the vintage. Link in bio.", "The cooling jacket spec that decides your ferment"]]},
  { file: "reel-wine-transfer-9x16.mp4", stage: "Wine Transfer", caps: [
    ["Most oxidation problems aren't the wine — they're the transfer. Low-shear pump, sanitary fittings, right flow rate. Link in bio.", "Wine transfer: 3 things that keep it gentle"],
    ["Move wine roughly and you bruise it before the bottle. A flexible-impeller or peristaltic pump moves it gently. Link in bio.", "Low-shear wine pumps: don't bruise the wine"]]},
  { file: "reel-crossflow-filtration-9x16.mp4", stage: "Filtration", caps: [
    ["Filtration is where good wine gets saved — or thrown away. Crossflow clarifies in a single pass: clear, stable, less loss. Link in bio.", "Crossflow filtration: clarify without stripping"],
    ["Push filtration too hard and you strip colour and aromatics. Match the L/HR to your bottling day. Link in bio.", "Sizing a crossflow wine filter"]]},
  { file: "reel-bottling-line-9x16.mp4", stage: "Bottling & Packaging", caps: [
    ["A bottling line, start to finish. What BPH do you actually need? Size to your busiest day — 1,000 to 6,000 BPH. Link in bio.", "What BPH do you need? Sizing a bottling line"],
    ["The bottling line is the last thing to touch your wine — and the easiest to under-size. Match BPH to your window. Link in bio.", "Wine bottling line: match BPH to your window"]]},
];
const NEW = [
  { file: "reel-304-vs-316l-9x16.mp4", stage: "Fermentation", caps: [
    ["304 or 316L? Both are food-grade stainless — the difference is molybdenum, and where it matters. 316L resists chlorides; the 'L' protects the welds. Compare the grade before the price. Link in bio.", "304 vs 316L stainless for wine tanks — which and why"]]},
  { file: "reel-pneumatic-vs-basket-9x16.mp4", stage: "Pressing", caps: [
    ["Same fruit, two presses, two different wines. A pneumatic membrane gives a gentle ramp and clean juice; a basket press gives distinct fractions. Match the press to your volume and style. Link in bio.", "Pneumatic vs Basket Press: which for your wine?"]]},
  { file: "reel-crossflow-vs-plate-9x16.mp4", stage: "Filtration", caps: [
    ["Clarifying wine is where handling adds up. Plate-and-frame builds clarity pad by pad; crossflow runs one tangential pass — less oxygen, less loss, no stripping. Link in bio.", "Crossflow vs Plate & Frame filtration for wine"]]},
  { file: "reel-triclamp-vs-din-9x16.mp4", stage: "Sanitation", caps: [
    ["Between tank and bottle, wine is only as clean as its fittings. Tri-clamp opens tool-free to inspect the gasket; DIN threads with a seal that must seat. Either way — no dead legs. Link in bio.", "Tri-clamp vs DIN sanitary fittings for wine"]]},
  { file: "reel-bph-sizing-9x16.mp4", stage: "Bottling & Packaging", caps: [
    ["How many bottles per hour do you actually need? A line runs on your busiest day, not the average. Take your peak volume, divide by the hours you have. Size to the peak. Link in bio.", "What BPH do you need? Sizing a wine bottling line"]]},
  { file: "reel-variable-capacity-9x16.mp4", stage: "Fermentation", caps: [
    ["A fixed tank has one honest volume. Below it, wine sits under oxidising air. A variable-capacity floating lid drops to rest on the wine — no headspace, any level. Link in bio.", "Variable-capacity vs fixed wine tanks"]]},
  { file: "reel-beat-harvest-9x16.mp4", stage: "Seasonal", caps: [
    ["Pricing a crusher-destemmer in July? The calendar's already against you. Lead times from Italy and France run weeks; then it must be commissioned before first fruit. Spec now. Link in bio.", "Beat the harvest clock: winery equipment lead times"]]},
  { file: "reel-how-we-vet-9x16.mp4", stage: "Verified", caps: [
    ["Anyone can post a photo of a tank. Vetting is what happens before it reaches you: food-grade 304/316L, traceable welds, sanitary fittings, a direct line to the manufacturer. A partner, not a portal. Link in bio.", "How we vet a winery equipment supplier"]]},
  { file: "reel-new-vs-used-9x16.mp4", stage: "Buyer economics", caps: [
    ["Used winery equipment can cut capital 40–60%. But a bargain isn't a bargain if it fails mid-crush — check welds, membranes, seals, parts. Some you buy used; the one your vintage depends on, you buy vetted. Link in bio.", "New vs used winery equipment: what to check"]]},
];

// dates: next day (Jul 17 anchor+1) .. Aug 31, DAILY
function dates() {
  const end = new Date(Date.UTC(2026, 7, 31));
  const out = [];
  for (let cur = new Date(Date.UTC(2026, 6, 20)); cur <= end; cur.setUTCDate(cur.getUTCDate() + 1))
    out.push(cur.toISOString().slice(0, 10));
  return out;
}

const D = dates();
const introduced = CORE.slice();     // available from day 1
const newQueue = NEW.slice();        // introduced ~3/week
const used = new Map();               // file -> times used (rotates caption variant)
let rrPrev = null, rr = 0;

function pick(day, i) {
  const dow = i % 7;
  const newSlot = (dow === 0 || dow === 2 || dow === 4) && newQueue.length > 0; // 3 new/week
  if (newSlot) { const r = newQueue.shift(); introduced.push(r); return r; }
  // recycle: round-robin over introduced, skip immediate repeat
  for (let k = 0; k < introduced.length; k++) {
    const r = introduced[(rr++) % introduced.length];
    if (r.file !== rrPrev) return r;
  }
  return introduced[0];
}

const schedule = D.map((date, i) => {
  const r = pick(date, i); rrPrev = r.file;
  const u = used.get(r.file) || 0; used.set(r.file, u + 1);
  const [cap, yt] = r.caps[u % r.caps.length];
  const slug = `${r.stage.toLowerCase().replace(/[^a-z]+/g, "-")}-${date}`;
  return {
    date, reel: r.file, stage: r.stage,
    ig_caption: `${cap}\n\n${HASH}`,
    yt_title: yt,
    yt_description: `${cap}\n\nExplore vetted winery equipment: ${UTM(slug).replace("%PLAT%", "youtube")}\n\n${HASH} #Shorts`,
    link: UTM(slug),
    posted: { instagram: false, youtube: false },
  };
});

writeFileSync(join(__dir, "..", "schedule.json"), JSON.stringify(schedule, null, 2));
const newCount = schedule.filter(s => NEW.some(n => n.file === s.reel)).length;
console.log(`schedule.json: ${schedule.length} daily slots ${D[0]}..${D[D.length-1]} · ${NEW.length} new reels introduced (${newCount} new-reel postings) · rest recycled`);
