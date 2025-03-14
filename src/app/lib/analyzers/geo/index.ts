import { Thread, Post } from '../../../types/interfaces';
import { BaseAnalyzer } from '../base';
import { GeoAnalyzerResult, CountryStats } from './types';

/**
 * Analyzer for tracking country statistics across posts
 */
export class GeoAnalyzer extends BaseAnalyzer<GeoAnalyzerResult> {
  name = 'geo';
  description = 'Tracks country statistics and participation across threads';

  // Maximum number of countries to track in each category
  private static MAX_COUNTRIES = 6;

  /**
   * Process posts to gather country statistics
   */
  private processCountryStats(threads: Thread[]): {
    countryStats: Map<string, CountryStats>;
    uniquePosters: Map<string, Set<string>>;
    totalPosts: number;
    postsWithLocation: number;
    firstPostWithLocation?: { threadId: number; postId: number };
  } {
    const countryStats = new Map<string, CountryStats>();
    const uniquePosters = new Map<string, Set<string>>();
    let totalPosts = 0;
    let postsWithLocation = 0;
    let firstPostWithLocation: { threadId: number; postId: number } | undefined;

    // Process each thread
    for (const thread of threads) {
      if (!thread.posts) continue;

      // Convert thread to post for OP analysis
      const opPost: Post = {
        no: thread.no,
        resto: 0,
        time: thread.time,
        name: thread.name,
        com: thread.com,
        country: thread.posts[0]?.country,
        country_name: thread.posts[0]?.country_name,
        id: thread.posts[0]?.id
      };

      // Include OP post if it has country data
      if (opPost.country && opPost.country_name) {
        this.updateCountryStats(
          countryStats,
          uniquePosters,
          opPost.country,
          opPost.country_name,
          opPost.id || 'anon'
        );
        totalPosts++;
        postsWithLocation++;
        if (!firstPostWithLocation) {
          firstPostWithLocation = { threadId: thread.no, postId: opPost.no };
        }
      }

      // Process each post in the thread
      for (const post of thread.posts) {
        totalPosts++;
        if (post.country && post.country_name) {
          this.updateCountryStats(
            countryStats,
            uniquePosters,
            post.country,
            post.country_name,
            post.id || 'anon'
          );
          postsWithLocation++;
          if (!firstPostWithLocation) {
            firstPostWithLocation = { threadId: thread.no, postId: post.no };
          }
        }
      }
    }

    return { countryStats, uniquePosters, totalPosts, postsWithLocation, firstPostWithLocation };
  }

  /**
   * Update statistics for a country
   */
  private updateCountryStats(
    countryStats: Map<string, CountryStats>,
    uniquePosters: Map<string, Set<string>>,
    countryCode: string,
    countryName: string,
    posterId: string
  ): void {
    // Get or create country stats
    if (!countryStats.has(countryCode)) {
      countryStats.set(countryCode, {
        code: countryCode,
        name: countryName,
        postCount: 0,
        uniquePosters: 0,
        lastSeen: Date.now()
      });
    }

    // Get or create unique posters set
    if (!uniquePosters.has(countryCode)) {
      uniquePosters.set(countryCode, new Set());
    }

    // Update stats
    const stats = countryStats.get(countryCode)!;
    const posters = uniquePosters.get(countryCode)!;

    stats.postCount++;
    stats.lastSeen = Date.now();
    posters.add(posterId);
    stats.uniquePosters = posters.size;
  }

  /**
   * Analyze threads for country statistics
   */
  async analyze(threads: Thread[]): Promise<GeoAnalyzerResult[]> {
    // Process all posts to gather statistics
    const { countryStats, uniquePosters, totalPosts, postsWithLocation, firstPostWithLocation } = 
      this.processCountryStats(threads);

    // Convert stats to array and sort for most common countries
    const mostCommonCountries = Array.from(countryStats.values())
      .sort((a, b) => b.postCount - a.postCount)
      .slice(0, GeoAnalyzer.MAX_COUNTRIES);

    // Sort for countries with most unique posters
    const mostUniqueCountries = Array.from(countryStats.values())
      .sort((a, b) => b.uniquePosters - a.uniquePosters)
      .slice(0, GeoAnalyzer.MAX_COUNTRIES);

    // Create single result
    return [{
      timestamp: Date.now(),
      threadId: firstPostWithLocation?.threadId || threads[0]?.no || 0,
      postId: firstPostWithLocation?.postId || threads[0]?.posts?.[0]?.no || 0,
      totalUniqueCountries: countryStats.size,
      mostCommonCountries,
      mostUniqueCountries,
      metadata: {
        totalPostsAnalyzed: totalPosts,
        postsWithLocation
      }
    }];
  }
} 