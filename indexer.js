const { Pinecone } = require('@pinecone-database/pinecone');
const { CohereClient } = require('cohere-ai');
const fs = require('fs').promises;
const path = require('path');
require('dotenv').config({ path: './.env' });

// Initialize clients
const cohere = new CohereClient({
  token: process.env.COHERE_API_KEY,
});

const pinecone = new Pinecone({
  apiKey: process.env.PINECONE_API_KEY,
});

const index = pinecone.Index(process.env.PINECONE_INDEX_NAME);

// Function to read all course content
async function readCourseContent() {
  const contentDir = path.join(__dirname, '..', 'docs');
  const modules = ['module-1', 'module-2', 'module-3', 'module-4'];
  const allContent = [];

  for (const module of modules) {
    const modulePath = path.join(contentDir, module);
    try {
      const files = await fs.readdir(modulePath);
      for (const file of files) {
        if (file.endsWith('.md')) {
          const filePath = path.join(modulePath, file);
          const content = await fs.readFile(filePath, 'utf8');

          // Extract content without frontmatter
          const contentWithoutFrontmatter = content.replace(/---[\s\S]*?---\s*/, '');

          allContent.push({
            id: `${module}/${file}`,
            content: contentWithoutFrontmatter,
            source: `/docs/${module}/${file}`,
            module: module
          });
        }
      }
    } catch (error) {
      console.error(`Error reading ${module}:`, error);
    }
  }

  return allContent;
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

// Function to index content to Pinecone
async function indexContent() {
  console.log('Starting content indexing...');

  // Read course content
  const documents = await readCourseContent();
  console.log(`Found ${documents.length} documents`);

  // Prepare points for Pinecone
  const points = [];
  let pointId = 0;

  for (const doc of documents) {
    const chunks = splitIntoChunks(doc.content);

    for (const chunk of chunks) {
      points.push({
        id: `doc_${pointId++}`,
        values: [], // Will be populated after embedding
        metadata: {
          content: chunk,
          source: doc.source,
          module: doc.module,
          original_id: doc.id
        }
      });
    }
  }

  console.log(`Prepared ${points.length} chunks for indexing`);

  // Process in batches to avoid memory issues (Cohere has limits)
  const batchSize = 50; // Cohere's max batch size is 96, we use 50 for safety
  for (let i = 0; i < points.length; i += batchSize) {
    const batch = points.slice(i, i + batchSize);
    console.log(`Processing batch ${Math.floor(i/batchSize) + 1}/${Math.ceil(points.length/batchSize)}`);

    // Extract text content for embedding
    const texts = batch.map(point => point.metadata.content);

    // Generate embeddings
    const embeddings = await generateEmbeddings(texts);

    // Add embeddings to points
    for (let j = 0; j < batch.length; j++) {
      batch[j].values = embeddings[j];
    }

    // Upsert points to Pinecone
    try {
      await index.upsert(batch);
      console.log(`Completed batch ${Math.floor(i/batchSize) + 1}/${Math.ceil(points.length/batchSize)}`);
    } catch (error) {
      console.error(`Error upserting batch ${Math.floor(i/batchSize) + 1}:`, error);
    }
  }

  console.log('Indexing completed successfully!');
  console.log(`Total documents indexed: ${documents.length}`);
  console.log(`Total chunks indexed: ${points.length}`);
}

// Run indexing if this file is executed directly
if (require.main === module) {
  indexContent()
    .then(() => {
      console.log('Content indexing complete');
      process.exit(0);
    })
    .catch((error) => {
      console.error('Indexing failed:', error);
      process.exit(1);
    });
}

module.exports = { indexContent, readCourseContent, splitIntoChunks };