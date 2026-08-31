/**
 * Builds src/icons.json from lucide-static.
 *
 * Only the curated vocabulary below is shipped, and it is exactly the
 * vocabulary the model is offered. A closed set means every name Gemini can
 * choose is guaranteed to exist and guaranteed to render — the alternative,
 * letting a model draw its own SVG paths, produces shapes nobody recognises.
 *
 * Run: node scripts/build-icons.mjs
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';

const DIR = 'node_modules/lucide-static/icons';

/** Grouped for the prompt: the model sees these headings, which improves picking. */
export const VOCABULARY = {
  'transport & media': `play pause square circle-stop skip-forward skip-back step-forward step-back
    fast-forward rewind repeat repeat-1 shuffle circle-dot disc-3 music music-2 audio-lines
    volume volume-1 volume-2 volume-off video video-off camera camera-off mic mic-off headphones
    radio podcast list-music list-video film clapperboard`,

  'presentation & display': `presentation projector monitor monitor-play monitor-off screen-share screen-share-off
    tv airplay cast maximize minimize maximize-2 minimize-2 expand shrink fullscreen
    panel-left panel-right panel-top panel-bottom columns-2 rows-2 layout-grid layout-list
    gallery-horizontal gallery-vertical images image app-window layout-dashboard
    timer timer-off clock alarm-clock hourglass gauge`,

  'pointing & annotation': `mouse-pointer mouse-pointer-2 mouse-pointer-click pointer hand pen-tool pencil
    highlighter eraser brush paintbrush palette pipette crosshair focus scan target
    move move-horizontal move-vertical grab`,

  'navigation & arrows': `chevron-up chevron-down chevron-left chevron-right chevrons-up chevrons-down
    chevrons-left chevrons-right arrow-up arrow-down arrow-left arrow-right arrow-up-right
    arrow-down-left arrow-left-right arrow-up-down corner-up-left corner-down-right
    undo undo-2 redo redo-2 rotate-cw rotate-ccw refresh-cw refresh-ccw home menu ellipsis
    ellipsis-vertical align-justify navigation compass map-pin locate`,

  'editing & text': `type bold italic underline strikethrough subscript superscript
    align-left align-center align-right align-justify list list-ordered list-checks indent-increase
    indent-decrease heading-1 heading-2 quote link link-2 unlink scissors copy clipboard
    clipboard-copy clipboard-check clipboard-list trash trash-2 save pen square-pen
    crop wand-sparkles sparkles replace case-sensitive spell-check text-cursor-input`,

  'files & data': `file file-text file-code file-plus files folder folder-open folder-plus
    download upload share share-2 paperclip archive box package inbox
    search filter funnel database server hard-drive cloud cloud-upload cloud-download
    table chart-column chart-line chart-pie trending-up trending-down activity`,

  'development': `terminal square-terminal code code-xml braces binary bug bug-play git-branch
    git-commit-horizontal git-merge git-pull-request git-fork container cpu memory-stick
    blocks component puzzle wrench hammer settings-2 test-tube flask-conical rocket
    bot brain circuit-board webhook key-round shield shield-check`,

  'communication': `message-square message-circle messages-square mail mail-open send send-horizontal
    phone phone-off phone-call bell bell-off bell-ring at-sign hash reply forward
    users user user-plus user-check contact handshake megaphone speech`,

  'system & toggles': `settings sliders-horizontal sliders-vertical power power-off lock lock-open
    eye eye-off sun moon sunrise sunset zap zap-off wifi wifi-off bluetooth battery battery-charging
    plug plug-zap toggle-left toggle-right check-check circle-check circle-x
    monitor-cog cog command option delete keyboard mouse smartphone laptop tablet`,

  'status & marks': `check x plus minus circle square triangle diamond hexagon star heart flag bookmark
    triangle-alert circle-alert info circle-help octagon-alert badge-check ban loader loader-circle
    thumbs-up thumbs-down pin bookmark-check dot`,

  'objects & delight': `flame droplet leaf tree-pine flower-2 sprout mountain waves wind cloud-rain
    snowflake rainbow coffee pizza cake gift party-popper crown gem trophy medal
    gamepad-2 dice-5 puzzle ghost skull bird cat dog fish rabbit bug-off
    lightbulb anchor plane car bike train-front ship globe telescope atom infinity
    aperture orbit sun-medium moon-star venetian-mask drama swords wand`,
};

const available = new Set(readdirSync(DIR).filter((f) => f.endsWith('.svg')).map((f) => f.slice(0, -4)));

const wanted = [];
const groups = {};
for (const [group, blob] of Object.entries(VOCABULARY)) {
  const names = blob.split(/\s+/).map((s) => s.trim()).filter(Boolean);
  groups[group] = names.filter((n) => available.has(n));
  for (const n of names) wanted.push([group, n]);
}

const missing = wanted.filter(([, n]) => !available.has(n)).map(([g, n]) => `${n}  (${g})`);
const kept = [...new Set(Object.values(groups).flat())];

// Strip the svg wrapper; keep only the shape elements, whitespace collapsed.
const geometry = {};
for (const name of kept) {
  const raw = readFileSync(`${DIR}/${name}.svg`, 'utf8');
  geometry[name] = raw
    .slice(raw.indexOf('>', raw.indexOf('<svg')) + 1, raw.lastIndexOf('</svg>'))
    .replace(/\s+/g, ' ')
    .replace(/>\s</g, '><')
    .trim();
}

writeFileSync('src/icons.json', JSON.stringify({ groups, geometry }));
const bytes = readFileSync('src/icons.json').length;

console.log(`kept ${kept.length} icons across ${Object.keys(groups).length} groups -> src/icons.json (${(bytes / 1024).toFixed(0)}KB)`);
console.log(`prompt vocabulary ~${Math.round(JSON.stringify(groups).length / 4)} tokens`);
if (missing.length) {
  console.log(`\n${missing.length} names do not exist in lucide ${JSON.parse(readFileSync('node_modules/lucide-static/package.json')).version}:`);
  for (const m of missing) console.log('  MISSING ' + m);
}
