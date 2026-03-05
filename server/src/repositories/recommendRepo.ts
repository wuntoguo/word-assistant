import {
  getArticlesForRecommendation,
  getArticlesForAudioGeneration,
  getArticleById,
  getArticleByUrl,
  type DbArticle,
} from './articleRepo.js';
import { getFeedbackByUser, getTestResultsByUser } from './feedbackRepo.js';
import { getUserProfile } from './userRepo.js';
import {
  getUserTopArticlesWithArticle,
  upsertUserTopArticle,
  pruneUserTopArticles,
  getArticleShowCounts,
  purgeOldUserTopArticles,
} from './recommendCacheRepo.js';

export type { DbArticle };

export const recommendRepo = {
  getArticlesForRecommendation,
  getArticlesForAudioGeneration,
  getFeedbackByUser,
  getArticleById,
  getArticleByUrl,
  getTestResultsByUser,
  getUserProfile,
  getUserTopArticlesWithArticle,
  upsertUserTopArticle,
  pruneUserTopArticles,
  purgeOldUserTopArticles,
  getArticleShowCounts,
};
