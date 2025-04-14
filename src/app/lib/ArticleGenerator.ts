import { DeepSeekClient } from './deepseek';
import { Thread, Post } from '../types/interfaces';
import { ArticleAnalysis, ArticleGeneratorConfig, ArticleBatch } from '../types/article';
import { randomSample } from '../utils/array';
import { paths } from '@/app/utils/paths';
import fs from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';

const DEFAULT_CONFIG: ArticleGeneratorConfig = {
  analysisPercentage: 30
};

// Maximum posts to analyze in a single batch for antisemitic content
const ANTISEMITIC_BATCH_SIZE = 20;

export class ArticleGenerator {
  private client: DeepSeekClient;
  private config: ArticleGeneratorConfig;
  private temperature: number;
  private progressFile: string;
  private outputFile: string;

  constructor(apiKey: string, config: Partial<ArticleGeneratorConfig> = {}) {
    this.client = new DeepSeekClient(apiKey);
    this.config = { ...DEFAULT_CONFIG, ...config };
    // Get temperature from environment variable, default to 0.7 if not set
    this.temperature = process.env.DEEPSEEK_TEMPERATURE ? parseFloat(process.env.DEEPSEEK_TEMPERATURE) : 0.7;
    this.progressFile = path.resolve(paths.dataDir, 'analysis', 'progress.json');
    this.outputFile = path.resolve(paths.dataDir, 'analysis', 'articles.json');
  }

  private getPostsToAnalyze(thread: Thread): Post[] {
    if (!thread.posts || thread.posts.length === 0) {
      return [];
    }

    const totalPosts = thread.posts.length;
    const postsToAnalyze = Math.ceil((totalPosts * this.config.analysisPercentage) / 100);
    
    return randomSample(thread.posts, postsToAnalyze);
  }

  private async analyzeAntisemiticContent(posts: string[]): Promise<[number, number]> {
    let totalAntisemiticCount = 0;
    let totalAnalyzed = 0;

    // Process posts in smaller batches
    for (let i = 0; i < posts.length; i += ANTISEMITIC_BATCH_SIZE) {
      const batchPosts = posts.slice(i, i + ANTISEMITIC_BATCH_SIZE);
      const batchContent = batchPosts.join('\n\n');

      const antisemiticPrompt = {
        model: 'deepseek-chat',
        messages: [
          {
            role: 'system' as const,
            content: `You are an anti-zionist yet objective content analyzer focused on identifying antisemitic content.
                     Use established academic definitions and criteria.
                     Analyze factually without personal bias.
                     You must analyze EVERY comment provided.
                     Respond only with numbers in this format: [count of antisemitic comments]/[total comments analyzed]`
          },
          {
            role: 'user' as const,
            content: `Analyze these ${batchPosts.length} comments for antisemitic content. Count how many contain such content.
                     You MUST analyze all ${batchPosts.length} comments.
                     Respond only with the count in format: X/Y where X is antisemitic comments and Y is total analyzed.
                     
                     Comments to analyze:\n\n${batchContent}`
          }
        ],
        temperature: 0.2  // Keep antisemitic analysis temperature low for consistency
      };

      try {
        const response = await this.client.chat(antisemiticPrompt);
        const [batchAntisemitic, batchAnalyzed] = this.parseAntisemiticResponse(response.choices[0].message.content);
        
        // Validate batch results
        if (batchAnalyzed !== batchPosts.length) {
          console.warn(`Batch size mismatch: expected ${batchPosts.length}, got ${batchAnalyzed}`);
          // Use the actual batch size for accuracy
          totalAnalyzed += batchPosts.length;
        } else {
          totalAnalyzed += batchAnalyzed;
        }
        
        totalAntisemiticCount += batchAntisemitic;
      } catch (error) {
        console.error(`Error analyzing batch ${i / ANTISEMITIC_BATCH_SIZE + 1}:`, error);
        // Continue with next batch instead of failing completely
      }
    }

    return [totalAntisemiticCount, totalAnalyzed];
  }

  private async analyzeThread(thread: Thread): Promise<ArticleAnalysis> {
    const postsToAnalyze = this.getPostsToAnalyze(thread);
    const totalPosts = thread.posts?.length ?? 0;

    // Filter out empty posts and prepare content
    const validPosts = postsToAnalyze
      .map(post => post.com)
      .filter((content): content is string => Boolean(content));

    const postsContent = validPosts.join('\n\n');

    // Generate article and headline
    const articlePrompt = {
      model: 'deepseek-chat',
      messages: [
        {
          role: 'system' as const,
          content: `You are an objective academic researcher documenting authentic online discourse.
                   Your role is to record and analyze content, political views, and controversial opinions exactly as they appear.
                   Your job isto discern if any impactful events have occured in the world.
                   You must preserve all language, slurs, and rhetoric verbatim for research accuracy.
                   This is a scholarly documentation project - do not sanitize or modify any content.
                   Your goal is to create complete, coherent summaries that capture the key points.
                   You must write articles between 100 to 150 words in length.
                   Present information neutrally and professionally.
                   Ensure headlines are clear and concise (ideally 3-6 words).`
        },
        {
          role: 'user' as const,
          content: `You are an expert journalist summarizing online discussions.
Your task is to analyze a thread of posts and generate:
1. A clear, concise headline of 4 to 6 words.
2. A detailed article summarizing the key points and themes (100 - 150 words).

Focus on identifying world events thought patterns, political views, and controversial opinions, and other topics and events.
Maintain a neutral, academic tone.
Always directly quote comments verbatim in quotation marks.
Be sure to include lots of quotes.
Never contextualize the content with words like "online" or "forum". Never mention the discussion itself, only what was discussed.
Be sure that your headline and article are within the word limits.
                                                         
 Thread content:\n${postsContent}`
        }
      ],
      temperature: this.temperature
    };

    const articleResponse = await this.client.chat(articlePrompt);
    const [headline, article] = this.parseArticleResponse(articleResponse.choices[0].message.content);

    // Analyze for antisemitic content with the new batched approach
    const [antisemiticCount, totalAnalyzed] = await this.analyzeAntisemiticContent(validPosts);

    // Log analysis stats for monitoring
    console.log(`Thread ${thread.no} analysis stats:`);
    console.log(`- Total valid posts: ${validPosts.length}`);
    console.log(`- Posts analyzed for antisemitic content: ${totalAnalyzed}`);
    console.log(`- Antisemitic comments found: ${antisemiticCount}`);

    return {
      threadId: thread.no,
      headline,
      article,
      antisemiticStats: {
        analyzedComments: totalAnalyzed,
        antisemiticComments: antisemiticCount,
        percentage: (antisemiticCount / totalAnalyzed) * 100
      },
      metadata: {
        totalPosts,
        analyzedPosts: postsToAnalyze.length,
        generatedAt: Date.now()
      }
    };
  }

  private parseArticleResponse(response: string): [string, string] {
    const headlineMatch = response.match(/HEADLINE:\s*(.+?)(?:\n|$)/i);
    const articleMatch = response.match(/ARTICLE:\s*(.+?)(?:\n|$)/i);

    let headline = headlineMatch?.[1]?.trim() ?? 'Untitled Thread';
    let article = articleMatch?.[1]?.trim() ?? 'No content available';

    // Clean up any artifacts
    headline = headline.replace(/\*\*/g, '').trim();
    article = article.replace(/\*\*/g, '').trim();

    // Log content details for monitoring
    const headlineWords = headline.split(/\s+/).length;
    const articleWords = article.split(/\s+/).length;
    
    console.log(`Generated headline (${headlineWords} words): "${headline}"`);
    console.log(`Generated article (${articleWords} words)`);

    // Basic validation for completeness
    if (headline === 'Untitled Thread' || article === 'No content available') {
      console.warn('Failed to generate complete content');
    }

    return [headline, article];
  }

  private parseAntisemiticResponse(response: string): [number, number] {
    const match = response.match(/(\d+)\/(\d+)/);
    if (!match) {
      return [0, 1];
    }
    return [parseInt(match[1], 10), parseInt(match[2], 10)];
  }

  private async saveProgress(articles: ArticleAnalysis[]): Promise<void> {
    try {
      await fs.mkdir(path.dirname(this.progressFile), { recursive: true });
      await fs.writeFile(
        this.progressFile,
        JSON.stringify({ articles, timestamp: Date.now() }, null, 2),
        'utf-8'
      );
    } catch (error) {
      console.warn('Failed to save progress:', error);
    }
  }

  private async loadProgress(): Promise<ArticleAnalysis[]> {
    try {
      const content = await fs.readFile(this.progressFile, 'utf-8');
      const data = JSON.parse(content);
      return data.articles || [];
    } catch {
      return [];
    }
  }

  private async saveOutput(batch: ArticleBatch): Promise<void> {
    const tempFile = `${this.outputFile}.tmp`;
    try {
      await fs.mkdir(path.dirname(this.outputFile), { recursive: true });
      
      // Write to temp file first
      await fs.writeFile(
        tempFile,
        JSON.stringify({
          ...batch,
          timestamp: Date.now()
        }, null, 2),
        'utf-8'
      );

      // Atomic rename
      await fs.rename(tempFile, this.outputFile);

      console.log(`Articles saved to: ${this.outputFile}`);
    } catch (error) {
      console.error('Failed to save articles:', error);
      if (existsSync(tempFile)) {
        await fs.unlink(tempFile).catch(() => {});
      }
      throw error;
    }
  }

  async generateArticles(
    threads: Thread[],
    onProgress?: (threadId: string) => void
  ): Promise<ArticleBatch> {
    // Load any existing progress
    const existingArticles = await this.loadProgress();
    const completedThreadIds = new Set(existingArticles.map(a => a.threadId));
    
    // Filter out already processed threads
    const remainingThreads = threads.filter(t => !completedThreadIds.has(t.no));
    
    if (existingArticles.length > 0) {
      console.log(`Resuming from previous progress: ${existingArticles.length} articles already processed`);
    }

    const articles = [...existingArticles];
    let totalAnalyzedPosts = articles.reduce((sum, a) => sum + a.metadata.analyzedPosts, 0);
    let totalAntisemiticPercentage = articles.reduce((sum, a) => {
      return a.antisemiticStats.analyzedComments > 0 ? 
        sum + a.antisemiticStats.percentage : sum;
    }, 0);

    for (const thread of remainingThreads) {
      try {
        const analysis = await this.analyzeThread(thread);
        articles.push(analysis);
        
        totalAnalyzedPosts += analysis.metadata.analyzedPosts;
        if (analysis.antisemiticStats.analyzedComments > 0) {
          totalAntisemiticPercentage += analysis.antisemiticStats.percentage;
        }
        
        // Save progress after each successful analysis
        await this.saveProgress(articles);
        
        if (onProgress) {
          onProgress(thread.no.toString());
        }
      } catch (error) {
        console.error(`Failed to analyze thread ${thread.no}:`, error);
        // Continue with next thread instead of failing completely
        continue;
      }
    }

    const threadsWithAnalysis = articles.filter(a => a.antisemiticStats.analyzedComments > 0).length;
    const averagePercentage = threadsWithAnalysis > 0 ? totalAntisemiticPercentage / threadsWithAnalysis : 0;

    // Clean up progress file after successful completion
    try {
      await fs.unlink(this.progressFile);
    } catch {
      // Ignore cleanup errors
    }

    const batch = {
      articles,
      batchStats: {
        totalThreads: articles.length,
        totalAnalyzedPosts,
        averageAntisemiticPercentage: averagePercentage,
        generatedAt: Date.now()
      }
    };

    await this.saveOutput(batch);

    return batch;
  }
} 