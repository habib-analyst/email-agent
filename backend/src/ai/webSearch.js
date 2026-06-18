// Web search helper for AI tool calling
import axios from 'axios';
import * as cheerio from 'cheerio';

/**
 * Perform web search using Google and return cleaned results
 */
export async function performWebSearch(query) {
  console.log(`[WebSearch] Searching: ${query}`);

  try {
    const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}&num=10`;

    const response = await axios.get(searchUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      },
      timeout: 15000
    });

    const $ = cheerio.load(response.data);
    const results = [];

    // Extract search result snippets
    $('div.g').each((_, el) => {
      const title = $(el).find('h3').first().text();
      const snippet = $(el).find('.VwiC3b').first().text() || $(el).find('.lyLwlc').first().text();
      const link = $(el).find('a').first().attr('href');

      if (title && snippet) {
        results.push({ title, snippet, link });
      }
    });

    if (results.length === 0) {
      return `No results found for: ${query}`;
    }

    // Format results for AI consumption
    const formatted = results.slice(0, 5).map((r, i) =>
      `${i + 1}. ${r.title}\n   ${r.snippet}\n   ${r.link || ''}`
    ).join('\n\n');

    console.log(`[WebSearch] Found ${results.length} results`);
    return formatted;

  } catch (e) {
    console.error(`[WebSearch] Failed: ${e.message}`);
    return `Search failed: ${e.message}`;
  }
}

/**
 * Web search tool definition for AI function calling
 */
export const WEB_SEARCH_TOOL = {
  type: 'function',
  function: {
    name: 'web_search',
    description: 'Search the internet for current information about professors, research, publications, university profiles',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Specific search query (e.g., "Professor John Smith MIT computer vision research")'
        }
      },
      required: ['query']
    }
  }
};
