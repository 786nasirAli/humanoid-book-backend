const axios = require('axios');
const xml2js = require('xml2js');
const { embedMultipleURLs } = require('./web-embedder'); // Our existing embedder function

// Function to parse sitemap and extract URLs
async function parseSitemap(sitemapUrl) {
  try {
    console.log(`Fetching sitemap: ${sitemapUrl}`);
    
    const response = await axios.get(sitemapUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; Bot/1.0; +http://example.com/bot)'
      }
    });
    
    const xmlData = response.data;
    const result = await xml2js.parseStringPromise(xmlData);
    
    // Extract URLs from sitemap
    const urls = [];
    
    if (result.urlset && result.urlset.url) {
      // Handle regular sitemap
      result.urlset.url.forEach((urlObj) => {
        if (urlObj.loc && urlObj.loc[0]) {
          urls.push(urlObj.loc[0]);
        }
      });
    } else if (result.sitemapindex && result.sitemapindex.sitemap) {
      // Handle sitemap index
      console.log('Found sitemap index, extracting nested sitemaps...');
      for (const sitemapObj of result.sitemapindex.sitemap) {
        if (sitemapObj.loc && sitemapObj.loc[0]) {
          urls.push(sitemapObj.loc[0]);
        }
      }
    }
    
    console.log(`Found ${urls.length} URLs in sitemap`);
    return urls;
  } catch (error) {
    console.error('Error parsing sitemap:', error.message);
    throw error;
  }
}

// Function to filter and clean URLs
function filterAndCleanUrls(urls, baseUrl) {
  // Remove duplicate URLs
  const uniqueUrls = [...new Set(urls)];
  
  // Filter URLs that belong to the same domain
  const domainUrls = uniqueUrls.filter(url => {
    try {
      const urlObj = new URL(url);
      const baseObj = new URL(baseUrl);
      return urlObj.hostname === baseObj.hostname;
    } catch (e) {
      return false; // Invalid URL
    }
  });
  
  // Remove sitemap.xml or other non-content URLs
  const contentUrls = domainUrls.filter(url => 
    !url.toLowerCase().includes('sitemap') &&
    !url.toLowerCase().endsWith('.xml') &&
    !url.toLowerCase().endsWith('.json') &&
    !url.toLowerCase().endsWith('.pdf') &&
    !url.toLowerCase().includes('tag') &&
    !url.toLowerCase().includes('category')
  );
  
  console.log(`Filtered to ${contentUrls.length} content URLs`);
  return contentUrls;
}

// Function to embed sitemap content
async function embedSitemapContent(sitemapUrl, maxUrls = 50) {
  try {
    // Parse the sitemap
    const urls = await parseSitemap(sitemapUrl);
    
    // Filter and clean URLs
    const cleanUrls = filterAndCleanUrls(urls, sitemapUrl);
    
    // Limit the number of URLs to process (for testing)
    const limitedUrls = cleanUrls.slice(0, maxUrls);
    
    console.log(`Processing ${limitedUrls.length} URLs...`);
    
    // Process each URL using our embedder
    for (let i = 0; i < limitedUrls.length; i++) {
      const url = limitedUrls[i];
      console.log(`Processing (${i + 1}/${limitedUrls.length}): ${url}`);
      
      try {
        // Using our existing embedder function
        await embedMultipleURLs([url]);
        
        // Add delay to respect rate limits
        await new Promise(resolve => setTimeout(resolve, 1000));
      } catch (error) {
        console.error(`Error processing ${url}:`, error.message);
      }
    }
    
    console.log('Sitemap processing completed');
    return limitedUrls.length;
  } catch (error) {
    console.error('Error in sitemap processing:', error);
    throw error;
  }
}

// Export functions
module.exports = {
  parseSitemap,
  filterAndCleanUrls,
  embedSitemapContent
};

// If this file is run directly, process the provided sitemap
if (require.main === module) {
  const sitemapUrl = 'https://humanoid-book-oaf3.vercel.app/sitemap.xml';
  
  embedSitemapContent(sitemapUrl, 20) // Process first 20 URLs
    .then((count) => {
      console.log(`Successfully processed ${count} URLs`);
      process.exit(0);
    })
    .catch((error) => {
      console.error('Error:', error);
      process.exit(1);
    });
}