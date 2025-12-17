const express = require('express');
const cors = require('cors');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { QdrantClient } = require('@qdrant/js-client-rest');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 8000;

// Middleware
app.use(cors());
app.use(express.json());

// Initialize clients
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ 
  model: 'gemini-pro',
  generationConfig: {
    temperature: 0.3,
    maxOutputTokens: 1000,
    topP: 0.95,
  }
});

const qdrant = new QdrantClient({
  url: process.env.QDRANT_URL,
  apiKey: process.env.QDRANT_API_KEY,
});

// Function to generate embeddings using Gemini-compatible approach
// Since Gemini API doesn't provide embeddings directly, we'll use a workaround
// In a production system, you might want to use an open-source embedding model
async function generateEmbeddingsForQuery(text) {
  // For this implementation, we'll use a simple approach
  // In production, consider using models like sentence-transformers via Python API
  // or self-hosted embedding models
  
  // For now, returning a fixed-size array as a placeholder
  // This is not actual semantic embedding but allows the system to function
  const vector = new Array(1536).fill(0);
  
  if (!text) return vector;
  
  // Simple hash-based embedding generation (not semantically meaningful)
  for (let i = 0; i < text.length; i++) {
    const charCode = text.charCodeAt(i);
    const idx = i % 1536;
    vector[idx] = ((vector[idx] * 31) + charCode) % 2; // Simple hash
  }
  
  // Normalize the vector
  const magnitude = Math.sqrt(vector.reduce((sum, val) => sum + val * val, 0));
  if (magnitude > 0) {
    return vector.map(val => val / magnitude);
  }
  
  return vector;
}

// RAG endpoint with Gemini compatibility
app.post('/api/rag', async (req, res) => {
  const { query } = req.body;

  if (!query) {
    return res.status(400).json({ error: 'Query is required' });
  }

  try {
    // Step 1: Generate vector from the query (using our simple approach)
    const queryVector = await generateEmbeddingsForQuery(query);
    
    // For Gemini integration, we'll use keyword-based approach in Qdrant
    // In a full implementation, you'd use proper embeddings
    console.log(`Processing query: ${query}`);
    
    // Instead of semantic search using embeddings, we'll use Qdrant's sparse vector or keyword search
    // This is a compromise for Gemini compatibility without OpenAI embeddings
    const searchResult = await qdrant.scroll("course_content", {
      limit: 10, // Get more results for keyword matching
      with_payload: true,
      with_vector: false,
      offset: 0
    });
    
    // Step 2: Perform keyword-based matching against retrieved content
    const queryLower = query.toLowerCase();
    const queryTerms = queryLower.split(/\s+/).filter(term => term.length > 2);
    
    // Filter results based on keyword matching
    let relevantResults = searchResult.points.filter(point => {
      if (!point.payload || !point.payload.content) return false;
      
      const content = point.payload.content.toLowerCase();
      const moduleRef = point.payload.module ? point.payload.module.toLowerCase() : '';
      const sourceRef = point.payload.source ? point.payload.source.toLowerCase() : '';
      
      // Count matching terms
      const matches = queryTerms.filter(term => 
        content.includes(term) || 
        moduleRef.includes(term) || 
        sourceRef.includes(term)
      ).length;
      
      // Include if at least some terms match
      return matches > 0;
    });
    
    // Sort by number of matching terms (descending)
    relevantResults.sort((a, b) => {
      const aMatches = queryTerms.filter(term => 
        a.payload.content.toLowerCase().includes(term) ||
        (a.payload.module && a.payload.module.toLowerCase().includes(term)) ||
        (a.payload.source && a.payload.source.toLowerCase().includes(term))
      ).length;
      
      const bMatches = queryTerms.filter(term => 
        b.payload.content.toLowerCase().includes(term) ||
        (b.payload.module && b.payload.module.toLowerCase().includes(term)) ||
        (b.payload.source && b.payload.source.toLowerCase().includes(term))
      ).length;
      
      return bMatches - aMatches;
    });
    
    // Take top 5 most relevant results
    const topResults = relevantResults.slice(0, 5);
    
    // Step 3: Format retrieved documents for context
    const retrievedDocs = topResults.map((hit) => ({
      content: hit.payload.content,
      source: hit.payload.source,
      module: hit.payload.module
    }));

    // Step 4: Create context for Gemini with retrieved documents
    const contextText = retrievedDocs.map(doc => doc.content).join('\n\n');
    const sources = retrievedDocs.map(doc => doc.source);

    // Step 5: Create prompt using retrieved context
    const prompt = `You are an AI assistant for the Physical AI & Humanoid Robotics course. 
    Use the following context to answer the question:

    CONTEXT: ${contextText}

    QUESTION: ${query}

    Please provide a helpful, detailed answer based on the context. 
    If the context doesn't contain relevant information, acknowledge this and provide guidance on where the user might find the information in the course.
    Include specific module references if possible.`;

    // Step 6: Generate response using Gemini
    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text();

    // Step 7: Return the response with source information
    res.status(200).json({
      response: text,
      sources: sources,
      retrieved_docs_count: retrievedDocs.length,
      query: query
    });

  } catch (error) {
    console.error('RAG API Error:', error);
    res.status(500).json({ 
      error: 'Internal server error during RAG processing',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.status(200).json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    service: 'RAG API with Gemini integration'
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/api/health`);
  console.log('RAG API with Gemini integration is ready');
});

module.exports = app;