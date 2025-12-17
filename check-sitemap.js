const axios = require('axios');
const xml2js = require('xml2js');

async function checkSitemapStructure() {
  try {
    const sitemapUrl = 'https://humanoid-book-oaf3.vercel.app/sitemap.xml';
    console.log(`Fetching sitemap: ${sitemapUrl}`);
    
    const response = await axios.get(sitemapUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; Bot/1.0; +http://example.com/bot)'
      }
    });
    
    const xmlData = response.data;
    console.log('Sitemap content preview:', xmlData.substring(0, 500));
    
    const result = await xml2js.parseStringPromise(xmlData);
    console.log('Parsed sitemap structure:', JSON.stringify(result, null, 2).substring(0, 1000));
    
    if (result.urlset && result.urlset.url) {
      console.log(`Found ${result.urlset.url.length} URLs in urlset`);
      result.urlset.url.forEach((urlObj, index) => {
        console.log(`${index + 1}: ${urlObj.loc ? urlObj.loc[0] : 'No location'}`);
      });
    } else if (result.sitemapindex && result.sitemapindex.sitemap) {
      console.log('Found sitemap index');
      result.sitemapindex.sitemap.forEach((sitemapObj, index) => {
        console.log(`${index + 1}: ${sitemapObj.loc ? sitemapObj.loc[0] : 'No location'}`);
      });
    } else {
      console.log('Unexpected sitemap structure');
    }
  } catch (error) {
    console.error('Error checking sitemap:', error);
  }
}

checkSitemapStructure();