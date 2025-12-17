const axios = require('axios');
require('dotenv').config();

async function testConnection() {
  console.log('Testing Qdrant connection - trying different endpoints...');
  const baseUrl = process.env.QDRANT_URL;
  const apiKey = process.env.QDRANT_API_KEY;
  
  console.log('Base URL:', baseUrl);
  
  // Try different possible endpoints
  const endpoints = [
    '/collections',
    '/api/v3/collections', 
    '/points/scroll',
    '/',
    '/health',
    '/api/health'
  ];
  
  for (const endpoint of endpoints) {
    try {
      console.log(`Trying endpoint: ${baseUrl}${endpoint}`);
      const response = await axios.get(`${baseUrl}${endpoint}`, {
        headers: {
          'api-key': apiKey,
          'Content-Type': 'application/json'
        },
        timeout: 10000
      });
      
      console.log(`  ✓ Success with status: ${response.status}`);
      console.log(`  Response:`, response.data);
      break; // If one works, we can stop
    } catch (error) {
      console.log(`  ✗ Failed with status ${error.response?.status || 'error'} for ${endpoint}`);
      if (error.response?.status === 401) {
        console.log(`    Authentication issue - URL is accessible`);
        break; // Authentication issue means the service is there
      }
    }
  }
}

testConnection();