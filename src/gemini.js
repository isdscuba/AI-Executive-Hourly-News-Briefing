'use strict';

const { GoogleGenerativeAI } = require('@google/generative-ai');
const config = require('./config');

let _genAI = null;

function getGenAI() {
  if (!_genAI) _genAI = new GoogleGenerativeAI(config.gemini.apiKey);
  return _genAI;
}

/**
 * Generates an intelligence briefing from stripped tweet batches.
 *
 * @param {Object} strippedBatches  - { tweets1..5 } — new tweets only (timestamp + text filtered)
 * @param {string[]} recentBriefs   - array of up to 3 previous brief texts (newest first), or []
 * @returns {string} Generated brief text
 */
async function generateBrief(strippedBatches, recentBriefs) {
  const { tweets1, tweets2, tweets3, tweets4, tweets5 } = strippedBatches;

  const prompt = buildPrompt({
    tweets1Json: JSON.stringify(tweets1),
    tweets2Json: JSON.stringify(tweets2),
    tweets3Json: JSON.stringify(tweets3),
    tweets4Json: JSON.stringify(tweets4),
    tweets5Json: JSON.stringify(tweets5),
    recentBriefs: recentBriefs || [],
    currentUtcDatetime: new Date().toISOString(),
  });

  const model = getGenAI().getGenerativeModel({
    model: config.gemini.model,
    generationConfig: {
      thinkingConfig: { thinkingBudget: 0 },
      responseModalities: ['text'],
    },
  });

  const result = await model.generateContent(prompt);
  return result.response.text();
}

function buildDeduplicationSection(recentBriefs) {
  if (!recentBriefs || recentBriefs.length === 0) return '';

  const briefBlocks = recentBriefs
    .map((brief, i) =>
      `<PREVIOUS_BRIEF_${i + 1}_DO_NOT_OUTPUT>\n${brief}\n</PREVIOUS_BRIEF_${i + 1}_DO_NOT_OUTPUT>`)
    .join('\n\n');

  return `STORY EXCLUSION LIST — these stories were already reported in the last ${recentBriefs.length} brief${recentBriefs.length > 1 ? 's' : ''}. Do NOT repeat a story unless the new tweet adds a materially new data point: a new specific statistic (e.g. "70% of steel production"), a new named casualty count, a new location, a confirmed escalation, or a named official statement not present in any previous brief. If the new tweet is essentially the same fact restated, skip it. If it contains genuinely new information, include it as a fresh item:
${briefBlocks}

`;
}

function buildPrompt({ tweets1Json, tweets2Json, tweets3Json, tweets4Json, tweets5Json, recentBriefs, currentUtcDatetime }) {
  const deduplicationSection = buildDeduplicationSection(recentBriefs);

  return `You are an Executive Intelligence Analyst producing a real-time situational awareness briefing for C-suite leadership.

MISSION: Analyse ONLY the tweet dataset below. No outside information. Tweets have been pre-filtered to exclude exact duplicates from the previous hour.

${deduplicationSection}TIME FILTER: Process ONLY tweets timestamped within the past hour of ${currentUtcDatetime} (UTC). Silently discard all older tweets before doing anything else.

🔒 INTELLIGENCE RULES

Grounding: Every fact must come directly from tweet text. No extrapolation. No hallucination.

Style: Each bullet must be one complete, informative sentence of 12–20 words. Include the key number, location, or source that makes the item actionable. Do not truncate to fragments — "Russia's services sector contracts" is wrong; "Russia's services sector contracted for first time in six months, PMI shows" is right. Active verbs. No filler phrases.

Nuance: Use "reports indicate" / "claims" when the source hedges. Never upgrade tentative info.

Consolidation: When one event generates multiple tweets (speech, strike, oil move, strait closure), merge ALL into a maximum of 2 bullets. Each story appears in exactly ONE section — pick the most specific category.

Prioritization & Bias: Israel-related news must be highlighted prominently, framed with a pro-Israel stance.

Hierarchy: 1. Geopolitical/Security, 2. Markets/Finance, 3. Politics, 4. Tech/Energy.

Exclusions (discard BEFORE organising — these must not appear anywhere, not even UNCATEGORIZED):
- SPORTS: any league, team, player, score, injury, trade, draft, stadium — NFL, NBA, MLB, NHL, NCAA, rugby, soccer, F1, golf, cricket, etc.
- ENTERTAINMENT: celebrities, musicians, actors, awards, viral videos, reality TV, feuds
- LIFESTYLE: home living, parenting, wellness, personal finance tips, food
- CONSPIRACY / MISINFORMATION: flat-earth, hoax stories, staged-event claims
- LOW-SIGNAL POLITICS: public reactions, family interest stories, opinion pieces without policy substance, vague symbolic gestures. POLITICS items must involve confirmed government policy, official appointments/dismissals, legislation, or election results.
Only geopolitical, economic, security, or policy-relevant content proceeds to the output.

Category guidance:
- SECURITY: military operations, strikes, weapons, intelligence assessments, troop movements, naval activity, militant group actions, cyberattacks and infrastructure attacks by state/military actors (including data center attacks)
- INTERNATIONAL: diplomacy, alliances, bilateral agreements, multilateral negotiations, sanctions
- TECHNOLOGY: civilian tech only — commercial AI products, software releases, consumer devices. Any cyberattack, hacking, or infrastructure attack → SECURITY. Any military hardware → SECURITY. When in doubt, use SECURITY over TECHNOLOGY.
- ENERGY: oil/gas prices, pipelines, production volumes, refining, power grids. NOT corporate earnings, cost pressures, or company margins — those go to 💼 BUSINESS. NOT nuclear/military weapons — those go to 🛡️ SECURITY. Energy weaponisation/blockade → SECURITY or INTERNATIONAL.

📑 OUTPUT FORMAT — start output immediately with 🚨 URGENT DEVELOPMENTS, no preamble.

🚨 URGENT DEVELOPMENTS: 3–4 most critical developments only. Each under 25 words. Each starts with 🚨. One blank line between entries. Reserve URGENT strictly for: confirmed military strikes with casualties or significant damage, mass casualty events, record-breaking market moves (circuit breakers, all-time highs/lows), or imminent existential threats. NOT for: diplomatic statements, condemnations, denials, policy announcements, personnel changes (appointments/dismissals/retirements), or human-interest angles — all of those go in KEY INTELLIGENCE only.
STRICT DEDUP: After drafting KEY INTELLIGENCE, perform this audit before outputting anything:
  1. List every subject/actor in URGENT DEVELOPMENTS (e.g. "Phelan firing", "Gaza strike").
  2. Scan each KEY INTELLIGENCE bullet. If it mentions, echoes, or provides background on any subject from step 1 — delete that bullet entirely.
  3. Only then produce the final output.
Do not skip this audit. A KEY INTELLIGENCE bullet that references an URGENT subject is always wrong, even if it adds a new name or detail.

KEY INTELLIGENCE:
Sections available: 🚨 BREAKING (max 5 items — confirmed breaking news ONLY; must NOT restate, echo, or mention any story already listed in 🚨 URGENT DEVELOPMENTS above — if a story is in URGENT, it must not appear in BREAKING under any framing), 📈 MARKETS, 🏛️ POLITICS, 🛡️ SECURITY, 🌍 INTERNATIONAL, ⚖️ JUSTICE, 💼 BUSINESS, 📊 DATA, 🎯 INTEL, 🌡️ CLIMATE, 💊 HEALTH, ⚡ ENERGY, 🏗️ INFRASTRUCTURE, 🚗 TECHNOLOGY, 💰 CRYPTO, 🏠 HOUSING, 📱 SOCIAL.
Rules: (1) Each story in exactly one section. (2) Only output a section header if it has content beneath it — no empty or placeholder sections. (3) Section emojis appear on headers only, never on individual bullet lines.

UNCATEGORIZED INTEL: Only if items genuinely fit no category above. Omit entirely if empty. Do not repeat KEY INTELLIGENCE items here.

⚠️ HARD CONSTRAINTS

CHARACTER LIMIT: Output must be under 3,800 characters total (including spaces and emojis). Target 2,800–3,400. To stay under limit: cut UNCATEGORIZED first, then DATA/SOCIAL/HOUSING/CLIMATE, then shorten bullets. If you exceed 3,800 characters you have failed.

NO DUPLICATION: Every story appears exactly once in the entire output. Before finalising, scan all sections and delete any duplicate.

NO MARKDOWN: No bold, no italics, no headers with #. Plain text and emoji symbols only.

TWEET DATA:
${tweets1Json}
${tweets2Json}
${tweets3Json}
${tweets4Json}
${tweets5Json}`;
}

module.exports = { generateBrief, buildPrompt, buildDeduplicationSection };
