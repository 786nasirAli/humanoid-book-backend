const express = require('express');
const cors = require('cors');
const OpenAI = require('openai');
const { Pinecone } = require('@pinecone-database/pinecone');
const { CohereClient } = require('cohere-ai');
const { retrieveFromPinecone } = require('./pinecone-retriever');
const userRoutes = require('./routes/userRoutes');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3001;  // Changed from 8000 to 3001 to avoid conflict with Docusaurus

// Middleware
app.use(cors({
  origin: ['http://localhost:3000', 'http://localhost:8000', 'http://localhost:3001'], // Allow common Docusaurus ports
  credentials: true
}));
app.use(express.json());

// Routes
app.use('/api', userRoutes);

// Initialize OpenRouter client
const openai = new OpenAI({
  apiKey: process.env.OPENROUTER_API_KEY,
  baseURL: 'https://openrouter.ai/api/v1',
});

// Initialize Pinecone client
const pinecone = new Pinecone({
  apiKey: process.env.PINECONE_API_KEY,
});

const index = pinecone.Index(process.env.PINECONE_INDEX_NAME);

// Initialize Cohere client
const cohere = new CohereClient({
  token: process.env.COHERE_API_KEY,
});

// Function to generate embedding using Cohere
async function generateEmbedding(text) {
  try {
    const response = await cohere.embed({
      texts: [text],
      model: 'embed-english-v3.0',
      inputType: 'search_query',
    });

    return response.embeddings[0]; // Return the embedding vector
  } catch (error) {
    console.error('Error generating embedding with Cohere:', error);
    // Fallback to random embedding if Cohere fails
    return Array(1536).fill(0).map(() => Math.random());
  }
}

// Import the retrieval function
const { performRAGRetrieval } = require('./retriever');

// Retrieval endpoint - acts as a tool for the chatbot
app.post('/api/retrieve', async (req, res) => {
  const { query } = req.body;

  if (!query) {
    console.log('Query is missing for retrieval');
    return res.status(400).json({ error: 'Query is required' });
  }

  try {
    console.log(`Retrieving documents for query: ${query}`);

    // Use the Pinecone retriever tool to get relevant documents
    console.log('Calling Pinecone retrieval tool...');
    const retrievalResult = await retrieveFromPinecone(query);
    console.log('Pinecone retrieval completed.');

    // Format the results
    const formattedResults = retrievalResult.results.map(result => ({
      id: result.id,
      content: result.content,
      source: result.source,
      score: result.score,
      rank: result.rank
    }));

    console.log(`Retrieved ${retrievalResult.retrievedCount} documents`);

    // Return the retrieved documents
    res.status(200).json({
      results: formattedResults,
      query: query,
      retrievedCount: retrievalResult.retrievedCount
    });
    console.log('Retrieval results sent to client');

  } catch (error) {
    console.error('Retrieval API Error:', error.message);
    console.error('Retrieval API Error Stack:', error.stack);

    res.status(500).json({
      error: 'Internal server error during document retrieval',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// RAG endpoint - uses the retrieval tool and then generates response
app.post('/api/rag', async (req, res) => {
  const { query } = req.body;

  if (!query) {
    console.log('Query is missing');
    return res.status(400).json({ error: 'Query is required' });
  }

  try {
    console.log(`Received query: ${query}`);

    // Call the retrieval tool to get relevant documents
    console.log('Calling retrieval tool...');
    const retrievalResult = await retrieveFromPinecone(query);
    console.log('Retrieval tool completed.');

    // Format the context from retrieved documents
    const contextText = retrievalResult.results.map(result =>
      `Source: ${result.source}\nContent: ${result.content}`
    ).join('\n\n---\n\n');

    console.log(`Context text length: ${contextText.length}`);
    console.log(`Retrieved ${retrievalResult.retrievedCount} documents`);

    // Create prompt using retrieved context
    const prompt = `Context: ${contextText}\n\nQuestion: ${query}\n\nPlease provide a helpful answer based on the context. If the context doesn't contain relevant information, please say so and suggest where the user might find the information in the course.`;

    try {
      console.log('Sending prompt to OpenAI...');
      // Use OpenRouter to generate a response based on retrieved context
      const response = await openai.chat.completions.create({
        model: 'meta-llama/llama-3.2-3b-instruct',  // Using Llama 3.2 3B Instruct model from OpenRouter
        messages: [
          {
            role: 'system',
            content: 'You are a helpful assistant for the Physical AI & Humanoid Robotics course. Use the provided context to answer questions accurately and reference the relevant modules when possible. Be concise but comprehensive.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        max_tokens: 800,
        temperature: 0.3,
        top_p: 0.95,
      });

      const text = response.choices[0].message.content;
      console.log('Response generated from OpenAI:', text.substring(0, 100) + '...');

      // Extract sources from results
      const sources = retrievalResult.results.map(r => r.source);

      // Return the response along with source information
      res.status(200).json({
        response: text,
        sources: sources,
        retrieved_docs_count: retrievalResult.retrievedCount
      });
      console.log('Response sent to client');
    } catch (openaiError) {
      console.error('OpenAI API Error:', openaiError.message);

      // In case of OpenAI error, return the retrieved documents only
      res.status(200).json({
        response: "Could not generate a response due to an API error, but here are some relevant documents:",
        sources: retrievalResult.results.map(r => r.source),
        retrieved_docs_count: retrievalResult.retrievedCount,
        fallback_context: retrievalResult.results.map(r => r.content).join('\n\n')
      });
    }

  } catch (error) {
    console.error('RAG API Error:', error.message);
    console.error('RAG API Error Stack:', error.stack);

    // Send detailed error info for debugging
    res.status(500).json({
      error: 'Internal server error during RAG processing',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Analytics endpoint
app.post('/api/analytics', async (req, res) => {
  const { event, data } = req.body;

  if (!event) {
    return res.status(400).json({ error: 'Event type is required' });
  }

  try {
    // In a production environment, you would store this data in a database
    // For now, we'll just log it
    console.log(`Analytics Event: ${event}`, {
      data,
      timestamp: new Date().toISOString()
    });

    // Optional: Store analytics in MongoDB or other database
    // const analyticsRecord = { event, data, timestamp: new Date() };
    // await analyticsCollection.insertOne(analyticsRecord);

    res.status(200).json({ status: 'Analytics recorded' });
  } catch (error) {
    console.error('Analytics error:', error);
    res.status(500).json({ error: 'Failed to record analytics' });
  }
});

// Feedback endpoint
app.post('/api/feedback', async (req, res) => {
  const { messageId, feedback, messageText } = req.body;

  if (!messageId || !feedback) {
    return res.status(400).json({ error: 'Message ID and feedback are required' });
  }

  try {
    // In a production environment, you would store feedback in a database
    // For now, we'll just log it
    console.log(`Feedback received:`, {
      messageId,
      feedback,
      messageText: messageText ? messageText.substring(0, 100) + '...' : 'N/A',
      timestamp: new Date().toISOString()
    });

    // Optional: Store feedback in MongoDB or other database
    // const feedbackRecord = { messageId, feedback, messageText, timestamp: new Date() };
    // await feedbackCollection.insertOne(feedbackRecord);

    res.status(200).json({ status: 'Feedback recorded' });
  } catch (error) {
    console.error('Feedback error:', error);
    res.status(500).json({ error: 'Failed to record feedback' });
  }
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.status(200).json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Indexing endpoint
app.post('/api/index-content', async (req, res) => {
  try {
    // Import the indexing function
    const { indexContent } = require('./indexer');

    // Run indexing in background
    indexContent().then(() => {
      console.log('Indexing completed');
    }).catch((error) => {
      console.error('Indexing failed:', error);
    });

    res.status(200).json({ message: 'Indexing started' });
  } catch (error) {
    console.error('Error starting indexing:', error);
    res.status(500).json({ error: 'Failed to start indexing' });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/api/health`);
  console.log(`RAG endpoint: http://localhost:${PORT}/api/rag`);
});