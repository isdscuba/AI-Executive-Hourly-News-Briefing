# Changelog

All notable changes to this project will be documented here.

## [1.1.0] — 2026-04-22

### Changed
- Dedup window expanded from 1 to 3 briefs — Gemini now sees the last 3 hours of coverage to avoid re-reporting stories
- Tweet-level dedup added: tweet texts seen in any of the last 3 runs are filtered out before the Gemini call, eliminating API overlap and slow-moving story noise
- `state.json` schema updated: `lastBriefText` (single string) replaced by `recentBriefs[]` and `recentTweets[]` (rolling arrays, max 3 entries each, newest first)
- `saveState()` now accepts tweet batches as a second argument
- `generateBrief()` now accepts `recentBriefs` as a string array instead of a single nullable string
- Gemini dedup prompt now includes up to 3 prior briefs in tagged blocks (`PREVIOUS_BRIEF_1_DO_NOT_OUTPUT` … `PREVIOUS_BRIEF_3_DO_NOT_OUTPUT`)
- Auto-migrates old `state.json` (single `lastBriefText` field) to new schema on first run after upgrade
- Pipeline log updated to show tweet dedup counts and number of prior brief/tweet sets in use

## [Unreleased]

### Added
- Initial GitHub repository setup
