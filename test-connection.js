const { QdrantClient } = require('@qdrant/js-client-rest');
require('dotenv').config();

async function testConnection() {
  console.log('Testing Qdrant connection...');
  console.log('URL:', process.env.QDRANT_URL);

  // For Qdrant Cloud, we should use the full URL with apiKey
  // The client should handle the protocol and port automatically
  const client = new QdrantClient({
    url: process.env.QDRANT_URL.replace(/\/$/, ""), // Remove trailing slash if present
    apiKey: process.env.QDRANT_API_KEY,
  });

  try {
    // Try to get collections list to test connection
    const collections = await client.getCollections();
    console.log('Connected successfully!');
    console.log('Available collections:', collections.collections.map(c => c.name));
  } catch (error) {
    console.error('Connection failed:', error.message);
    console.error('Full error:', error);
  }
}

testConnection();