'use strict';

const { GoogleGenerativeAI } = require('@google/generative-ai');
const config = require('./config');
const { dedupeBulletsAgainstText } = require('./dedup');

let _genAI = null;
function getGenAI() {
  if (!_genAI) _genAI = new GoogleGenerativeAI(config.gemini.apiKey);
  return _genAI;
}

const STOPWORDS = new Set([
  'the','a','an','and','or','but','in','on','at','to','for','of','with','by',
  'from','as','is','was','are','were','be','been','being','have','has','had',
  'do','does','did','will','would','could','should','may','might','shall','can',
  'not','no','nor','so','yet','both','either','neither','each','few','more',
  'most','other','some','such','than','too','very','just','that','this','these',
  'those','its','it','he','she','they','we','you','his','her','their','our',
  'your','after','before','also','about','into','over','under','between',
  'during','against','including','following','within','without','according',
  'because','there','where','when','which','what','who','how','all','only',
  'said','says','say','told','claim','claims','report','reports','amid','says',
]);

/**
 * Strips bullets that either have no [Tx] citation or whose cited tweet(s)
 * share fewer than 2 content words with the bullet text.
 * Returns the brief with all citation tags removed.
 */
function verifyCitations(briefText, allTweets) {
  const CITE_RE = /\s*\[T\d+(?:,\s*T\d+)*\]/g;
  // A single well-formed citation bracket, used to reject brackets that
  // merely start with "[Tx" but contain other text — e.g. a model
  // hallucinated annotation like "[T60 - duplicate context...]" — rather
  // than loosely parsing whatever T-numbers happen to appear inside them.
  const CLEAN_CITE_RE = /^\[T\d+(?:,\s*T\d+)*\]$/;

  let inUrgentSection = false;
  let inKeySection = false;
  const lines = briefText.split('\n');
  const cleaned = lines.map(line => {
    let trimmed = line.trim();

    // Track which section we're in so plain-text URGENT items are detected
    if (trimmed.startsWith('🚨 URGENT DEVELOPMENTS')) { inUrgentSection = true; return line; }
    if (trimmed.startsWith('KEY INTELLIGENCE'))        { inUrgentSection = false; inKeySection = true; return line; }

    // Section header lines pass through untouched here — emptiness is
    // resolved by removeEmptyHeaders() below, once the final bullet set
    // (after citation stripping) is known.
    if (isSectionHeaderLine(trimmed)) return line;

    // Normalize bullets that mistakenly lead with a category emoji instead
    // of "*" (format drift from the model) so they're classified correctly
    // below and go through citation verification like every other bullet —
    // otherwise they'd silently skip verification entirely.
    const emojiPrefix = CATEGORY_EMOJIS.find(e => trimmed.startsWith(`${e} `));
    if (emojiPrefix) {
      trimmed = `* ${trimmed.slice(emojiPrefix.length).trim()}`;
      line = trimmed;
    }

    // Classify content lines that need citation verification
    // — URGENT section: non-empty lines that aren't the header itself
    // — 🚨-prefixed items (old-style urgent bullets)
    // — * bullets (KEY INTELLIGENCE items)
    const isUrgentItem   = inUrgentSection && trimmed.length > 20;
    const isUrgentBullet = /^🚨/.test(trimmed)
      && !trimmed.startsWith('🚨 URGENT DEVELOPMENTS')
      && !trimmed.startsWith('🚨 BREAKING');
    // Any non-blank line under KEY INTELLIGENCE is story content, "*" or not.
    // Gemini sometimes drops the "*" (and echoes the exclusion list with a
    // fake "[STORY EXCLUSION LIST]" tag instead of a [Tx] citation); lines
    // like that previously skipped verification and shipped unchecked.
    const isKeyBullet    = trimmed.startsWith('*') || (inKeySection && trimmed.length > 0);

    if (!isUrgentItem && !isUrgentBullet && !isKeyBullet) return line;

    // Must have at least one citation-looking bracket, and every such
    // bracket must be a clean [Tx] / [Tx,Ty] list — a malformed bracket
    // (extra text after the tweet number) means the line is treated as
    // uncited rather than having its numbers loosely extracted.
    const bracketMatches = trimmed.match(/\[T\d+[^\]]*\]/g) || [];
    if (bracketMatches.length === 0) return null;
    if (bracketMatches.some(b => !CLEAN_CITE_RE.test(b))) return null;

    // Collect all cited tweet indices (1-based in prompt → 0-based in array)
    const indices = [...trimmed.matchAll(/T(\d+)/g)]
      .map(m => parseInt(m[1], 10) - 1);

    // Content words from bullet (citation tags stripped)
    const bulletClean = trimmed
      .replace(CITE_RE, '')
      .replace(/^\*\s*|^🚨\s*/, '')
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ');
    const contentWords = bulletClean.split(/\s+/)
      .filter(w => w.length > 3 && !STOPWORDS.has(w));

    if (contentWords.length === 0) return null;

    // At least one cited tweet must share ≥2 content words with the bullet
    const verified = indices.some(idx => {
      if (idx < 0 || idx >= allTweets.length) return false;
      const tLow = allTweets[idx].text.toLowerCase();
      return contentWords.filter(w => tLow.includes(w)).length >= 2;
    });

    return verified ? line.replace(CITE_RE, '') : null;
  });

  // Global safety net: strip any [Tx] tags that weren't caught per-line,
  // then drop any section header left with no content beneath it.
  const withoutEmptyHeaders = removeEmptyHeaders(cleaned.filter(l => l !== null));
  return withoutEmptyHeaders
    .join('\n')
    .replace(CITE_RE, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// Bare section-header lines from the KEY INTELLIGENCE format (see buildPrompt's
// OUTPUT FORMAT section) — matched by exact text, NOT by leading emoji, because
// individual 🚨 URGENT bullets also start with 🚨 and must NOT be filtered out.
const SECTION_HEADERS = new Set([
  '🚨 BREAKING', '📈 MARKETS', '🏛️ POLITICS', '🛡️ SECURITY', '🌍 INTERNATIONAL',
  '⚖️ JUSTICE', '💼 BUSINESS', '📊 DATA', '🎯 INTEL', '🌡️ CLIMATE', '💊 HEALTH',
  '⚡ ENERGY', '🏗️ INFRASTRUCTURE', '🚗 TECHNOLOGY', '💰 CRYPTO', '🏠 HOUSING',
  '📱 SOCIAL', 'UNCATEGORIZED INTEL',
]);

// The model often appends a trailing colon to section headers even though
// SECTION_HEADERS lists the bare form — match either.
function isSectionHeaderLine(trimmedLine) {
  return SECTION_HEADERS.has(trimmedLine) || SECTION_HEADERS.has(trimmedLine.replace(/:\s*$/, ''));
}

// Leading emoji of every SECTION_HEADERS entry that actually has one.
// Excludes "UNCATEGORIZED INTEL" (no emoji) and "🚨" — shared by the
// BREAKING header and legitimate 🚨 URGENT bullets, which must keep their
// prefix rather than being rewritten to "*".
const CATEGORY_EMOJIS = [...SECTION_HEADERS]
  .map(header => header.split(' ')[0])
  .filter(token => /[^\x00-\x7F]/.test(token) && token !== '🚨');

/**
 * Drops any section header line that has no non-blank, non-header content
 * before the next header (or the end of the text) — enforces the prompt's
 * "only output a section header if it has content" rule at the code level,
 * since Gemini doesn't reliably follow it, especially once citation
 * verification has stripped every bullet a header had.
 */
function removeEmptyHeaders(lines) {
  const result = [];
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (isSectionHeaderLine(trimmed)) {
      let j = i + 1;
      while (j < lines.length && lines[j].trim() === '') j++;
      const nextTrimmed = j < lines.length ? lines[j].trim() : '';
      const isEmpty = j >= lines.length
        || isSectionHeaderLine(nextTrimmed)
        || nextTrimmed.startsWith('KEY INTELLIGENCE')
        || nextTrimmed.startsWith('🚨 URGENT DEVELOPMENTS');
      if (isEmpty) continue;
    }
    result.push(lines[i]);
  }
  return result;
}

/**
 * Splits a single brief's text into its individual story bullets, dropping
 * blank lines and the "🚨 URGENT DEVELOPMENTS" / "KEY INTELLIGENCE" /
 * category header lines — but keeping individual 🚨-prefixed URGENT items,
 * which are real story content, not headers.
 */
function extractBullets(briefText) {
  return String(briefText).split('\n')
    .map(l => l.trim().replace(/\s*\[STORY EXCLUSION LIST\]/g, ''))
    .filter(l =>
      l.length > 0 &&
      !l.startsWith('🚨 URGENT') &&
      !l.startsWith('KEY INTELLIGENCE') &&
      !isSectionHeaderLine(l)
    );
}

/**
 * Builds a "do not repeat" section from recent brief history, as a flat list
 * of individual story bullets rather than full brief blocks — a narrative
 * block invites the model to copy phrasing/numbers wholesale, whereas a flat
 * per-story list gives it a direct comparison target. Safe to feed back
 * because verifyCitations() strips any bullet that isn't backed by a tweet
 * in the CURRENT batch, so an echoed/anchored old fact can't survive even if
 * the model copies it — it structurally closes the hallucination vector that
 * killed the original (full-brief-block) version of this feature.
 */
function buildDeduplicationSection(recentBriefs) {
  if (!recentBriefs || recentBriefs.length === 0) return '';

  const bullets = recentBriefs.flatMap(extractBullets);

  if (bullets.length === 0) return '';

  const bulletList = bullets.map(b => `- ${b}`).join('\n');
  const n = recentBriefs.length;

  return `STORY EXCLUSION LIST — these stories were already reported in the last ${n} brief${n > 1 ? 's' : ''}. Do NOT include any story whose actor + core fact matches an item below, even if a new tweet words it differently. Only include it again if a tweet in the current dataset adds a materially new data point: a new named casualty count, a new confirmed statistic, a new location, or a confirmed escalation. Restatements and updates-without-new-facts must be skipped entirely. This list is NOT a source of facts: never copy, repeat, or cite any item from it. If nothing in the current tweets is new, output only the two section headings.
${bulletList}

`;
}

/**
 * Generates an intelligence briefing from stripped tweet batches.
 * Every bullet in the output is verified against the source tweet corpus —
 * uncited or unverifiable bullets are stripped before returning.
 *
 * @param {Object} strippedBatches - { tweets1..5 }
 * @param {string[]} [opts.recentBriefs] - up to config.history.maxEntries previous
 *   brief texts (newest first), used to suppress already-reported stories
 * @returns {string} Verified brief text
 */
async function generateBrief(strippedBatches, { modelOverride, recentBriefs = [] } = {}) {
  const allTweets = [
    ...strippedBatches.tweets1,
    ...strippedBatches.tweets2,
    ...strippedBatches.tweets3,
    ...strippedBatches.tweets4,
    ...strippedBatches.tweets5,
  ];

  // Most-recent-first: biases both the model's attention and the prompt's
  // explicit recency instruction toward the freshest source when multiple
  // tweets report conflicting values for the same metric (e.g. a commodity
  // price). Sorted once, shared by buildPrompt (citation numbering) and
  // verifyCitations (index lookup) so [Tx] tags line up with the same order.
  allTweets.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  const prompt = buildPrompt({ allTweets, currentUtcDatetime: new Date().toISOString(), recentBriefs });

  const resolvedModel = modelOverride || config.gemini.model;
  // Hard cap on generation length. Target output is 2,800-3,400 chars (~700-850
  // tokens) plus citation tags; 1536 tokens (~6,000 chars) leaves comfortable
  // headroom while still hard-stopping the repetition-loop failure mode seen
  // on 2026-09-03, where an uncapped flash-lite call produced 288,204 chars
  // before the 3,800-char post-hoc truncation discarded almost all of it.
  const generationConfig = resolvedModel.startsWith('gemini-2.5')
    ? { thinkingConfig: { thinkingBudget: 0 }, responseModalities: ['text'], maxOutputTokens: 1536 }
    : { responseModalities: ['text'], maxOutputTokens: 1536 };
  const model = getGenAI().getGenerativeModel({ model: resolvedModel, generationConfig });

  const result = await model.generateContent(prompt);
  const verified = verifyCitations(result.response.text(), allTweets);
  return dedupeAgainstRecentBriefs(verified, recentBriefs);
}

/**
 * Code-level backstop for the prompt's STORY EXCLUSION LIST (see
 * buildDeduplicationSection): drops any new bullet whose text is a
 * near-duplicate (word-shingle Jaccard similarity) of a bullet already sent
 * in a recent brief. The prompt instruction alone is unreliable — the model
 * has an explicit escape hatch ("include again if a tweet words it
 * differently") that lets genuinely-repeated stories slip through. Runs
 * after verifyCitations so it compares the final, citation-verified bullet
 * text. Re-runs removeEmptyHeaders() since dropping a bullet can leave its
 * section header empty.
 */
function dedupeAgainstRecentBriefs(briefText, recentBriefs) {
  const oldBullets = (recentBriefs || []).flatMap(extractBullets);
  if (oldBullets.length === 0) return briefText;

  const lines = briefText.split('\n');
  const candidateBullets = lines
    .map(l => l.trim())
    .filter(t =>
      t.length > 0 &&
      !t.startsWith('🚨 URGENT') &&
      !t.startsWith('KEY INTELLIGENCE') &&
      !isSectionHeaderLine(t)
    );
  if (candidateBullets.length === 0) return briefText;

  const { dropped } = dedupeBulletsAgainstText(candidateBullets, oldBullets, config.dedup.storyJaccardThreshold);
  if (dropped.length === 0) return briefText;

  for (const { bullet, matchedText, similarity } of dropped) {
    console.log(`[${new Date().toISOString()}] Story dedup dropped (similarity ${similarity.toFixed(2)}): "${bullet.slice(0, 80)}" ~ "${matchedText.slice(0, 80)}"`);
  }

  const droppedSet = new Set(dropped.map(d => d.bullet));
  const remaining = removeEmptyHeaders(lines.filter(l => !droppedSet.has(l.trim())));
  return remaining.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function buildPrompt({ allTweets, currentUtcDatetime, recentBriefs = [] }) {
  const numberedTweets = allTweets
    .map((t, i) => {
      const author = (typeof t.author === 'object' ? t.author?.userName : t.author) || 'unknown';
      return `[T${i + 1}] @${author} [${t.createdAt}]: ${t.text}`;
    })
    .join('\n\n');

  const deduplicationSection = buildDeduplicationSection(recentBriefs);

  return `You are an Executive Intelligence Analyst producing a real-time situational awareness briefing for C-suite leadership.

MISSION: Analyse ONLY the tweet dataset below. No outside information. No knowledge from training data.

${deduplicationSection}TIME FILTER: Process ONLY tweets timestamped within the past 2 hours of ${currentUtcDatetime} (UTC). Silently discard all older tweets before doing anything else.

🔒 INTELLIGENCE RULES

Grounding: Every fact must come directly from tweet text. No extrapolation. No hallucination. NEVER include a specific number — price, percentage, statistic, or figure — unless that exact number appears verbatim in a tweet. SPECIFICALLY FORBIDDEN: commodity settlement prices ("Brent Crude at $X.XX per barrel", "WTI at $X.XX") — these synthetic summaries are never in the tweet dataset. Tweets below are listed most-recent-first; when multiple tweets report different values for the same metric (e.g. a commodity price), use only the value from the most recently timestamped one.

CITATION RULE (hard requirement): Every bullet and every 🚨 URGENT item must end with [Tx] or [Tx,Ty] citing the tweet number(s) from the list below that directly support the claim. Example: "* Iran deal signed, signing ceremony set for June 19. [T47,T79]". If no tweet clearly and directly supports a claim, omit the bullet. Never fabricate a citation. Bullets without a valid citation are stripped automatically before delivery — citation tags themselves are also stripped and will not appear in the final output.

Style: Each bullet must be one complete, informative sentence of 12–20 words. Include the key number, location, or source that makes the item actionable. Active verbs. No filler phrases.

Nuance: Use "reports indicate" / "claims" when the source hedges. Never upgrade tentative info.

Consolidation: When one event generates multiple tweets, merge ALL into a maximum of 2 bullets. Cite all relevant tweet numbers. Each story appears in exactly ONE section.

Prioritization & Bias: Israel-related news must be highlighted prominently, framed with a pro-Israel stance.

Hierarchy: 1. Geopolitical/Security, 2. Markets/Finance, 3. Politics, 4. Tech/Energy.

Exclusions (discard BEFORE organising — must not appear anywhere):
- SPORTS: any league, team, player, score, injury, trade, draft, stadium
- ENTERTAINMENT: celebrities, musicians, actors, awards, viral videos, reality TV, feuds
- LIFESTYLE: home living, parenting, wellness, personal finance tips, food
- CONSPIRACY / MISINFORMATION: flat-earth, hoax stories, staged-event claims
- LOW-SIGNAL POLITICS: public reactions, family interest stories, opinion pieces without policy substance. POLITICS items must involve confirmed government policy, official appointments/dismissals, legislation, or election results.
Only geopolitical, economic, security, or policy-relevant content proceeds to the output.

Category guidance:
- SECURITY: military operations, strikes, weapons, intelligence assessments, troop movements, naval activity, militant group actions, cyberattacks and infrastructure attacks by state/military actors
- INTERNATIONAL: diplomacy, alliances, bilateral agreements, multilateral negotiations, sanctions
- TECHNOLOGY: civilian tech only — commercial AI products, software releases, consumer devices. Cyberattacks or infrastructure attacks → SECURITY. Military hardware → SECURITY.
- ENERGY: pipeline news, production volumes, refining capacity, power grid events. Report a price ONLY if the exact figure appears verbatim in a tweet — never infer or generate a price. NOT corporate earnings → BUSINESS. NOT nuclear/military weapons → SECURITY.

📑 OUTPUT FORMAT — start output immediately with 🚨 URGENT DEVELOPMENTS, no preamble.

🚨 URGENT DEVELOPMENTS: 3–4 most critical developments only. Each under 25 words + citation. Each starts with 🚨. One blank line between entries. Reserve URGENT strictly for: confirmed military strikes with casualties or significant damage, mass casualty events, record-breaking market moves (circuit breakers, all-time highs/lows), or imminent existential threats. NOT for diplomatic statements, condemnations, denials, policy announcements, or personnel changes.

STRICT DEDUP: After drafting KEY INTELLIGENCE, list every subject in URGENT DEVELOPMENTS and delete any KEY INTELLIGENCE bullet that mentions, echoes, or provides background on those subjects.

KEY INTELLIGENCE:
Sections available: 🚨 BREAKING (max 5 items — confirmed breaking news NOT already in URGENT), 📈 MARKETS, 🏛️ POLITICS, 🛡️ SECURITY, 🌍 INTERNATIONAL, ⚖️ JUSTICE, 💼 BUSINESS, 📊 DATA, 🎯 INTEL, 🌡️ CLIMATE, 💊 HEALTH, ⚡ ENERGY, 🏗️ INFRASTRUCTURE, 🚗 TECHNOLOGY, 💰 CRYPTO, 🏠 HOUSING, 📱 SOCIAL.
Rules: (1) Each story in exactly one section. (2) Only output a section header if it has content. (3) Section emojis on headers only, never on individual bullet lines.

UNCATEGORIZED INTEL: Only if items genuinely fit no category above. Omit entirely if empty.

⚠️ HARD CONSTRAINTS

CHARACTER LIMIT: Output must be under 3,800 characters total, not counting [Tx] citation tags. Target 2,800–3,400. To stay under: cut UNCATEGORIZED first, then DATA/SOCIAL/HOUSING/CLIMATE, then shorten bullets.

NO DUPLICATION: Every story appears exactly once in the entire output.

NO MARKDOWN: No bold, no italics, no headers with #. Plain text and emoji symbols only.

TWEET DATA (${allTweets.length} tweets, numbered for citation):
${numberedTweets}`;
}

module.exports = {
  generateBrief,
  buildPrompt,
  buildDeduplicationSection,
  verifyCitations,
  extractBullets,
  dedupeAgainstRecentBriefs,
};
