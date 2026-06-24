'use strict';

const { GoogleGenerativeAI } = require('@google/generative-ai');
const config = require('./config');

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

  let inUrgentSection = false;
  const lines = briefText.split('\n');
  const cleaned = lines.map(line => {
    const trimmed = line.trim();

    // Track which section we're in so plain-text URGENT items are detected
    if (trimmed.startsWith('🚨 URGENT DEVELOPMENTS')) { inUrgentSection = true; return line; }
    if (trimmed.startsWith('KEY INTELLIGENCE'))        { inUrgentSection = false; return line; }

    // Classify content lines that need citation verification
    // — URGENT section: non-empty lines that aren't the header itself
    // — 🚨-prefixed items (old-style urgent bullets)
    // — * bullets (KEY INTELLIGENCE items)
    const isUrgentItem   = inUrgentSection && trimmed.length > 20;
    const isUrgentBullet = /^🚨/.test(trimmed)
      && !trimmed.startsWith('🚨 URGENT DEVELOPMENTS')
      && !trimmed.startsWith('🚨 BREAKING');
    const isKeyBullet    = trimmed.startsWith('*');

    if (!isUrgentItem && !isUrgentBullet && !isKeyBullet) return line;

    // Must have at least one [Tx] citation
    if (!/\[T\d+/.test(trimmed)) return null;

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

  // Global safety net: strip any [Tx] tags that weren't caught per-line
  return cleaned
    .filter(l => l !== null)
    .join('\n')
    .replace(CITE_RE, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Generates an intelligence briefing from stripped tweet batches.
 * Every bullet in the output is verified against the source tweet corpus —
 * uncited or unverifiable bullets are stripped before returning.
 *
 * @param {Object} strippedBatches - { tweets1..5 }
 * @returns {string} Verified brief text
 */
async function generateBrief(strippedBatches, { modelOverride } = {}) {
  const allTweets = [
    ...strippedBatches.tweets1,
    ...strippedBatches.tweets2,
    ...strippedBatches.tweets3,
    ...strippedBatches.tweets4,
    ...strippedBatches.tweets5,
  ];

  const prompt = buildPrompt({ allTweets, currentUtcDatetime: new Date().toISOString() });

  const model = getGenAI().getGenerativeModel({
    model: modelOverride || config.gemini.model,
    generationConfig: {
      thinkingConfig: { thinkingBudget: 0 },
      responseModalities: ['text'],
    },
  });

  const result = await model.generateContent(prompt);
  return verifyCitations(result.response.text(), allTweets);
}

function buildPrompt({ allTweets, currentUtcDatetime }) {
  const numberedTweets = allTweets
    .map((t, i) => {
      const author = (typeof t.author === 'object' ? t.author?.userName : t.author) || 'unknown';
      return `[T${i + 1}] @${author} [${t.createdAt}]: ${t.text}`;
    })
    .join('\n\n');

  return `You are an Executive Intelligence Analyst producing a real-time situational awareness briefing for C-suite leadership.

MISSION: Analyse ONLY the tweet dataset below. No outside information. No knowledge from training data.

TIME FILTER: Process ONLY tweets timestamped within the past 2 hours of ${currentUtcDatetime} (UTC). Silently discard all older tweets before doing anything else.

🔒 INTELLIGENCE RULES

Grounding: Every fact must come directly from tweet text. No extrapolation. No hallucination. NEVER include a specific number — price, percentage, statistic, or figure — unless that exact number appears verbatim in a tweet. SPECIFICALLY FORBIDDEN: commodity settlement prices ("Brent Crude at $X.XX per barrel", "WTI at $X.XX") — these synthetic summaries are never in the tweet dataset.

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

module.exports = { generateBrief, buildPrompt, verifyCitations };
