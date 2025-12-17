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

// Function to generate embedding for a query using Cohere
async function generateQueryEmbedding(text) {
  try {
    const response = await cohere.embed({
      texts: [text],
      model: 'embed-english-v3.0',
      inputType: 'search_query',
    });
    
    return response.embeddings[0];
  } catch (error) {
    console.error('Error generating query embedding:', error);
    throw error;
  }
}

// Function to retrieve relevant documents from Pinecone
async function retrieveDocuments(query, topK = 5) {
  try {
    console.log(`Generating embedding for query: ${query}`);
    // Generate embedding for the query
    const queryEmbedding = await generateQueryEmbedding(query);
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
    const results = queryResponse.matches.map((match) => ({
      content: match.metadata.content,
      source: match.metadata.source,
      score: match.score
    }));

    console.log(`Formatted ${results.length} results from Pinecone`);
    return results;
  } catch (error) {
    console.error('Error retrieving documents:', error);
    throw error;
  }
}

// Function to format context from retrieved documents
function formatContext(documents) {
  if (!documents || documents.length === 0) {
    return "No relevant content found in the knowledge base.";
  }
  
  return documents.map(doc => `Source: ${doc.source}\nContent: ${doc.content}`).join('\n\n---\n\n');
}

// Function to perform complete RAG retrieval (intended for use with chatbot)
async function performRAGRetrieval(query, topK = 5) {
  try {
    console.log(`Performing RAG retrieval for query: ${query}`);
    
    // Retrieve relevant documents
    const documents = await retrieveDocuments(query, topK);
    
    // Format context
    const context = formatContext(documents);
    
    console.log(`Retrieved ${documents.length} documents for RAG`);
    
    return {
      context,
      sources: documents.map(doc => doc.source),
      retrieved_docs_count: documents.length
    };
  } catch (error) {
    console.error('Error in RAG retrieval:', error);
    
    // Return fallback response in case of error
    return {
      context: "An error occurred while retrieving information. Using fallback response.",
      sources: [],
      retrieved_docs_count: 0
    };
  }
}

// Export functions
module.exports = {
  retrieveDocuments,
  formatContext,
  performRAGRetrieval
};

// If this file is run directly, perform a test retrieval
if (require.main === module) {
  const testQuery = "What is ROS 2?";
  
  performRAGRetrieval(testQuery)
    .then(result => {
      console.log('RAG Retrieval Result:');
      console.log('Context:', result.context);
      console.log('Sources:', result.sources);
      console.log('Retrieved Docs Count:', result.retrieved_docs_count);
    })
    .catch(error => {
      console.error('Error in test retrieval:', error);
    });
}