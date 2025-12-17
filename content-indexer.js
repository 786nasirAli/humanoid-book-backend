const { QdrantClient } = require('@qdrant/js-client-rest');
const fs = require('fs').promises;
const path = require('path');
require('dotenv').config();

// Initialize Qdrant client
const qdrant = new QdrantClient({
  url: process.env.QDRANT_URL,
  apiKey: process.env.QDRANT_API_KEY,
});

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
          const contentWithoutFrontmatter = content.replace(/---[\s\S]*?---/, '');
          
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

// Function to index content to Qdrant
async function indexContent() {
  console.log('Starting content indexing...');
  
  // Read course content
  const documents = await readCourseContent();
  console.log(`Found ${documents.length} documents`);
  
  // Prepare points for Qdrant
  const points = [];
  let pointId = 0;
  
  for (const doc of documents) {
    const chunks = splitIntoChunks(doc.content);
    
    for (const chunk of chunks) {
      points.push({
        // For now, using a simple approach without embeddings
        // In a production system, you'd use a service like OpenAI embeddings or a self-hosted model
        id: pointId++,
        vector: generateDummyEmbedding(chunk.substring(0, 100)), // Generating simple dummy embedding
        payload: {
          content: chunk,
          source: doc.source,
          module: doc.module,
          original_id: doc.id
        }
      });
    }
  }
  
  console.log(`Prepared ${points.length} chunks for indexing`);
  
  // Create collection in Qdrant if it doesn't exist
  try {
    const collections = await qdrant.getCollections();
    const collectionExists = collections.collections.some(c => c.name === 'course_content');
    
    if (!collectionExists) {
      await qdrant.createCollection('course_content', {
        // For Gemini-compatible approach, we'll use a fixed-size vector
        // This is a simplified approach since we're not using OpenAI embeddings anymore
        vectors: {
          size: 1536, // Standard size to accommodate various embedding models
          distance: "Cosine"
        },
        hnsw_config: {
          ef_construct: 100,
          m: 16,
        },
        optimizers_config: {
          full_scan_threshold: 10000,
        },
        quantization_config: {
          scalar: {
            type: 'int8',
            quantile: 0.99,
            always_ram: true,
          }
        }
      });
      console.log('Created new collection: course_content');
    }
  } catch (error) {
    console.error('Error creating collection:', error);
    throw error;
  }
  
  // Process in batches to avoid memory issues
  const batchSize = 10; // Reduced batch size for the dummy embeddings approach
  for (let i = 0; i < points.length; i += batchSize) {
    const batch = points.slice(i, i + batchSize);
    console.log(`Processing batch ${i/batchSize + 1}/${Math.ceil(points.length/batchSize)}`);
    
    try {
      // Upsert points to Qdrant
      await qdrant.upsert('course_content', {
        points: batch
      });
      console.log(`Completed batch ${i/batchSize + 1}`);
    } catch (error) {
      console.error(`Error processing batch ${i/batchSize + 1}:`, error);
    }
  }
  
  console.log('Indexing completed successfully!');
}

// Simple function to create a dummy embedding (in real implementation, you'd use actual embeddings)
function generateDummyEmbedding(text) {
  // This is a simple hash-based approach to generate a pseudo-vector
  // In a real implementation, you'd use a proper embedding model
  const vector = new Array(1536).fill(0);
  
  if (!text) return vector;
  
  for (let i = 0; i < text.length; i++) {
    const charCode = text.charCodeAt(i);
    const idx = i % 1536;
    vector[idx] = (vector[idx] + charCode) % 2 - 1; // Normalize to [-1, 1] range
  }
  
  return vector;
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