const { Pinecone } = require('@pinecone-database/pinecone');
const { CohereClient } = require('cohere-ai');
const axios = require('axios');
const cheerio = require('cheerio');
const xml2js = require('xml2js');
require('dotenv').config();

// Initialize clients
const cohere = new CohereClient({
  token: process.env.COHERE_API_KEY,
});

const pinecone = new Pinecone({
  apiKey: process.env.PINECONE_API_KEY,
});

const index = pinecone.Index(process.env.PINECONE_INDEX_NAME);

// Function to parse sitemap and extract URLs
async function parseSitemap(sitemapUrl) {
  try {
    console.log(`Fetching sitemap: ${sitemapUrl}`);
    
    const response = await axios.get(sitemapUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; Bot/1.0; +http://example.com/bot)'
      }
    });
    
    const xmlData = response.data;
    const result = await xml2js.parseStringPromise(xmlData);
    
    // Extract URLs from sitemap
    const urls = [];
    
    if (result.urlset && result.urlset.url) {
      // Handle regular sitemap
      result.urlset.url.forEach((urlObj) => {
        if (urlObj.loc && urlObj.loc[0]) {
          urls.push(urlObj.loc[0]);
        }
      });
    } else if (result.sitemapindex && result.sitemapindex.sitemap) {
      // Handle sitemap index
      console.log('Found sitemap index, extracting nested sitemaps...');
      for (const sitemapObj of result.sitemapindex.sitemap) {
        if (sitemapObj.loc && sitemapObj.loc[0]) {
          urls.push(sitemapObj.loc[0]);
        }
      }
    }
    
    console.log(`Found ${urls.length} URLs in sitemap`);
    return urls;
  } catch (error) {
    console.error('Error parsing sitemap:', error.message);
    throw error;
  }
}

// Function to filter and clean URLs
function filterAndCleanUrls(urls, baseUrl) {
  // Remove duplicate URLs
  const uniqueUrls = [...new Set(urls)];

  // For this implementation, we'll just filter out sitemap-related URLs
  // and allow all others (assuming they are from the correct domain)
  const contentUrls = uniqueUrls.filter(url =>
    !url.toLowerCase().includes('sitemap') &&
    !url.toLowerCase().endsWith('.xml') &&
    !url.toLowerCase().endsWith('.json') &&
    !url.toLowerCase().endsWith('.pdf') &&
    !url.toLowerCase().includes('tag') &&
    !url.toLowerCase().includes('category')
  );

  console.log(`Filtered to ${contentUrls.length} content URLs`);
  return contentUrls;
}

// Function to fetch content from a URL
async function fetchContentFromURL(url) {
  try {
    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; Bot/1.0; +http://example.com/bot)'
      }
    });
    
    return response.data;
  } catch (error) {
    console.error(`Error fetching content from ${url}:`, error.message);
    throw error;
  }
}

// Function to extract text content from HTML
function extractTextFromHTML(html, url) {
  const $ = cheerio.load(html);
  
  // Remove script and style elements
  $('script, style, nav, footer, header, .nav, .footer, .header').remove();
  
  // Extract text content, focusing on main content areas
  let text = $('main, .main, .content, article, .post-content, .markdown, .docs-content').text();
  
  // If no specific content area found, extract from body
  if (!text.trim()) {
    text = $('body').text();
  }
  
  // Clean up the text
  text = text.replace(/\s+/g, ' ').trim();
  
  // Limit text length if too long
  if (text.length > 10000) {
    text = text.substring(0, 10000);
  }
  
  return {
    content: text,
    url: url
  };
}

// Function to split content into chunks
function splitIntoChunks(content, maxLength = 1000) {
  const chunks = [];
  const paragraphs = content.split('\n\n');

  let currentChunk = '';

  for (const paragraph of paragraphs) {
    if (currentChunk.length + paragraph.length <= maxLength) {
      currentChunk += paragraph + '\n\n';
    } else {
      if (currentChunk.trim()) {
        chunks.push(currentChunk.trim());
      }
      currentChunk = paragraph + '\n\n';

      // If a single paragraph is too long, split it by sentences
      if (currentChunk.length > maxLength) {
        const sentences = currentChunk.split(/(?<=[.!?])\s+/);
        currentChunk = '';

        for (const sentence of sentences) {
          if (currentChunk.length + sentence.length <= maxLength) {
            currentChunk += sentence + ' ';
          } else {
            if (currentChunk.trim()) {
              chunks.push(currentChunk.trim());
            }
            currentChunk = sentence + ' ';

            // If a single sentence is too long, split by length
            if (currentChunk.length > maxLength) {
              const parts = currentChunk.match(new RegExp(`.{1,${maxLength}}`, 'g')) || [];
              for (let i = 0; i < parts.length - 1; i++) {
                chunks.push(parts[i]);
              }
              currentChunk = parts[parts.length - 1] || '';
            }
          }
        }
      }
    }
  }

  if (currentChunk.trim()) {
    chunks.push(currentChunk.trim());
  }

  return chunks;
}

// Function to generate embeddings using Cohere
async function generateEmbeddings(texts) {
  try {
    const response = await cohere.embed({
      texts: texts,
      model: 'embed-english-v3.0',
      inputType: 'search_document',
    });

    // Pinecone humanoid index expects 1024 dimensional vectors
    // But Cohere's embed-english-v3.0 produces 1024-dim vectors by default
    return response.embeddings;
  } catch (error) {
    console.error('Error generating embeddings with Cohere:', error);
    throw error;
  }
}

// Function to embed a single URL
async function embedURL(url) {
  try {
    console.log(`Processing URL: ${url}`);

    // Fix the URL domain to match the actual deployed site
    const fixedUrl = url.replace('https://humanoid-book.vercel.app', 'https://humanoid-book-oaf3.vercel.app');
    console.log(`Fixed URL: ${fixedUrl}`);

    // Fetch content from URL
    const html = await fetchContentFromURL(fixedUrl);

    // Extract text content
    const { content, url: sourceUrl } = extractTextFromHTML(html, fixedUrl);

    if (!content.trim()) {
      console.error(`No content extracted from ${fixedUrl}`);
      return;
    }

    // Split content into chunks
    const chunks = splitIntoChunks(content);

    console.log(`Processing ${chunks.length} chunks from ${fixedUrl}`);

    // Process in batches to avoid rate limits
    const batchSize = 10;
    for (let i = 0; i < chunks.length; i += batchSize) {
      const batch = chunks.slice(i, i + batchSize);

      // Generate embeddings for the batch
      const embeddings = await generateEmbeddings(batch);

      // Prepare vectors for Pinecone
      const vectors = batch.map((chunk, index) => ({
        id: `url_${Date.now()}_${i + index}`,
        values: embeddings[index],
        metadata: {
          content: chunk,
          source: sourceUrl,
          type: 'web_content',
          timestamp: new Date().toISOString()
        }
      }));

      // Upsert to Pinecone
      try {
        await index.upsert(vectors);
        console.log(`Upserted batch ${Math.floor(i/batchSize) + 1}/${Math.ceil(chunks.length/batchSize)} to Pinecone`);
      } catch (error) {
        console.error(`Error upserting batch to Pinecone:`, error);
        // If Pinecone is disabled, we'll show this error
        if (error.message.includes('disabled')) {
          console.error('Pinecone index is currently disabled. Please enable it in your Pinecone dashboard.');
        }
      }
    }

    console.log(`Successfully processed URL: ${fixedUrl}`);
  } catch (error) {
    console.error(`Error processing URL ${url}:`, error.message);
  }
}

// Function to embed sitemap content
async function embedSitemapContent(sitemapUrl, maxUrls = 50) {
  try {
    // Parse the sitemap
    const urls = await parseSitemap(sitemapUrl);
    
    // Filter and clean URLs
    const cleanUrls = filterAndCleanUrls(urls, sitemapUrl);
    
    // Limit the number of URLs to process (for testing)
    const limitedUrls = cleanUrls.slice(0, maxUrls);
    
    console.log(`Processing ${limitedUrls.length} URLs...`);
    
    // Process each URL
    for (let i = 0; i < limitedUrls.length; i++) {
      const url = limitedUrls[i];
      console.log(`Processing (${i + 1}/${limitedUrls.length}): ${url}`);
      
      try {
        await embedURL(url);
        
        // Add delay to respect rate limits
        await new Promise(resolve => setTimeout(resolve, 1000));
      } catch (error) {
        console.error(`Error processing ${url}:`, error.message);
      }
    }
    
    console.log('Sitemap processing completed');
    return limitedUrls.length;
  } catch (error) {
    console.error('Error in sitemap processing:', error);
    throw error;
  }
}

// Export functions
module.exports = {
  embedSitemapContent
};

// If this file is run directly, process the provided sitemap
if (require.main === module) {
  const sitemapUrl = 'https://humanoid-book-oaf3.vercel.app/sitemap.xml';
  
  embedSitemapContent(sitemapUrl, 20) // Process first 20 URLs
    .then((count) => {
      console.log(`Successfully processed ${count} URLs`);
      process.exit(0);
    })
    .catch((error) => {
      console.error('Error:', error);
      process.exit(1);
    });
}