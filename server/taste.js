// Taste facade — profile scan, live feedback, and ranking helpers.
export { buildProfile, getProfile, profileText } from './taste-profile.js';
export {
  recordFeedback,
  recentFeedback,
  skipRateByArtist,
  tasteSummary,
  scoreTrack,
} from './agent/preferences.js';
