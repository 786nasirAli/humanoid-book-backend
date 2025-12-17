const { Pinecone } = require('@pinecone-database/pinecone');
const { CohereClient } = require('cohere-ai');
const axios = require('axios');
const cheerio = require('cheerio');
require('dotenv').config();

// Initialize clients
const cohere = new CohereClient({
  token: process.env.COHERE_API_KEY,
});

const pinecone = new Pinecone({
  apiKey: process.env.PINECONE_API_KEY,
});

const index = pinecone.Index(process.env.PINECONE_INDEX_NAME);

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
  $('script, style, nav, footer, header').remove();
  
  // Extract text content
  let text = $('body').text();
  
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
    
    // Fetch content from URL
    const html = await fetchContentFromURL(url);
    
    // Extract text content
    const { content, url: sourceUrl } = extractTextFromHTML(html, url);
    
    if (!content.trim()) {
      console.error(`No content extracted from ${url}`);
      return;
    }
    
    // Split content into chunks
    const chunks = splitIntoChunks(content);
    
    console.log(`Processing ${chunks.length} chunks from ${url}`);
    
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
      }
    }
    
    console.log(`Successfully processed URL: ${url}`);
  } catch (error) {
    console.error(`Error processing URL ${url}:`, error.message);
  }
}

// Function to embed multiple URLs
async function embedMultipleURLs(urls) {
  for (const url of urls) {
    await embedURL(url);
    // Add a small delay between requests to respect rate limits
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  
  console.log('All URLs processed');
}

// Export functions for use in other files
module.exports = {
  embedURL,
  embedMultipleURLs
};

// If this file is run directly, process a test URL
if (require.main === module) {
  const testUrls = [
    'https://humanoid-book-oaf3.vercel.app/'
    // Add more URLs as needed
  ];
  
  embedMultipleURLs(testUrls)
    .then(() => {
      console.log('All URLs processed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('Error in batch processing:', error);
      process.exit(1);
    });
}