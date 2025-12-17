const { Pinecone } = require('@pinecone-database/pinecone');
const { CohereClient } = require('cohere-ai');
require('dotenv').config();

// Initialize clients
const cohere = new CohereClient({
  token: process.env.COHERE_API_KEY,
});

const pinecone = new Pinecone({
  apiKey: process.env.PINECONE_API_KEY,
});

const index = pinecone.Index(process.env.PINECONE_INDEX_NAME);

// Function to perform retrieval from Pinecone
async function retrieveFromPinecone(query, topK = 5) {
  try {
    console.log(`Generating embedding for query: ${query}`);
    
    // Generate embedding for the query using Cohere
    const response = await cohere.embed({
      texts: [query],
      model: 'embed-english-v3.0',
      inputType: 'search_query',
    });
    
    const queryEmbedding = response.embeddings[0];
    console.log(`Generated ${queryEmbedding.length}-dimensional embedding`);
    
    // Query Pinecone for similar vectors
    console.log('Querying Pinecone with embedding...');
    const queryResponse = await index.query({
      vector: queryEmbedding,
      topK: topK,
      includeMetadata: true,
    });
    
    console.log(`Pinecone query returned ${queryResponse.matches.length} matches`);
    
    // Format the results
    const results = queryResponse.matches.map((match, index) => ({
      id: match.id,
      content: match.metadata.content,
      source: match.metadata.source,
      score: match.score,
      rank: index + 1
    }));
    
    console.log(`Formatted ${results.length} results from Pinecone`);
    
    return {
      results: results,
      query: query,
      retrievedCount: results.length
    };
  } catch (error) {
    console.error('Error in Pinecone retrieval:', error);
    throw error;
  }
}

// Export the function
module.exports = { retrieveFromPinecone };

// If this file is run directly, perform a test retrieval
if (require.main === module) {
  const testQuery = "What is ROS 2?";
  
  retrieveFromPinecone(testQuery, 5)
    .then(result => {
      console.log('Retrieval Results:', JSON.stringify(result, null, 2));
    })
    .catch(error => {
      console.error('Error in test retrieval:', error);
    });
}