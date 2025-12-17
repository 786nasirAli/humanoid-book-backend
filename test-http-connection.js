const axios = require('axios');
require('dotenv').config();

async function testConnection() {
  console.log('Testing Qdrant connection with direct HTTP request...');
  const url = process.env.QDRANT_URL;
  const apiKey = process.env.QDRANT_API_KEY;
  
  console.log('URL:', url);
  
  try {
    const response = await axios.get(`${url}/collections`, {
      headers: {
        'api-key': apiKey,
        'Content-Type': 'application/json'
      },
      timeout: 10000 // 10 seconds timeout
    });
    
    console.log('Connected successfully!');
    console.log('Response status:', response.status);
    console.log('Collections:', response.data);
  } catch (error) {
    console.error('Direct HTTP connection failed:', error.message);
    if (error.response) {
      console.error('Status:', error.response.status);
      console.error('Data:', error.response.data);
      console.error('Headers:', error.response.headers);
    }
  }
}

testConnection();