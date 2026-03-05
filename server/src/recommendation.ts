import {
  buildRecommendationReason,
  computeFreshnessScore,
  scoreWithFreshness,
} from './services/recommend/scoring.js';
import { buildUserProfile } from './services/recommend/profileService.js';
import { buildUserProfileWithOptions } from './services/recommend/profileService.js';
import {
  getRecommendedArticles,
  getRecommendedAudioArticles,
} from './services/recommend/recommendationService.js';

export {
  buildRecommendationReason,
  buildUserProfile,
  buildUserProfileWithOptions,
  computeFreshnessScore,
  getRecommendedArticles,
  getRecommendedAudioArticles,
  scoreWithFreshness,
};

export type { ScoredArticle, UserProfile } from './services/recommend/types.js';
