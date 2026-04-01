/* jshint -W097 */
/* jshint strict: false */
/* jslint node: true */
/* jslint esversion: 6 */

const alexaCookie = require('alexa-cookie2');

const config = {
    logger: console.log,
    proxyOwnIp: '127.0.0.1',    // Required for proxy: the IP to access the proxy
    
    // UK Amazon configuration
    amazonPage: 'amazon.co.uk',  // UK Amazon
    acceptLanguage: 'en-GB',     // English UK
    baseAmazonPage: 'amazon.co.uk', // Base Amazon page for proxy
    
    // Proxy configuration
    setupProxy: true,            // Enable proxy for manual login (handles 2FA/captcha)
    proxyOnly: true,             // Only use proxy method (don't try automatic)
    proxyPort: 0,                // Random port
    proxyListenBind: '0.0.0.0',
    proxyLogLevel: 'info',
    
    // Device configuration
    deviceAppName: 'OpenClaw Alexa MCP', // Custom app name
    
    // Persistence
    formerDataStorePath: './data/alexa-cookie-data.json',
};

// Check if we have email/password from environment
const email = process.env.AMAZON_EMAIL;
const password = process.env.AMAZON_PASSWORD;

if (email && password) {
    console.log('Email provided, will attempt automatic login first');
    alexaCookie.generateAlexaCookie(email, password, config, handleResult);
} else {
    console.log('No email/password provided, using proxy-only mode');
    alexaCookie.generateAlexaCookie(config, handleResult);
}

function handleResult(err, result) {
    console.log('\n=== RESULT ===');
    if (err) {
        console.log('ERROR:', err);
    }
    
    if (result) {
        console.log('\n=== SUCCESS ===');
        
        // Log the refresh_token (Atnr token)
        if (result.refresh_token) {
            console.log('\n*** REFRESH TOKEN (Atnr) ***');
            console.log(result.refresh_token);
            console.log('*** END REFRESH TOKEN ***\n');
        } else {
            console.log('No refresh_token in result');
        }
        
        // Log other important fields
        if (result.localCookie) {
            console.log('localCookie: [present]');
        }
        if (result.csrf) {
            console.log('csrf: [present]');
        }
        if (result.macDms) {
            console.log('macDms: [present]');
        }
        
        // Full result for debugging
        console.log('\nFull result object keys:', Object.keys(result));
        
        // Stop proxy server if running
        alexaCookie.stopProxyServer();
        
        process.exit(0);
    } else {
        console.log('No result returned');
        alexaCookie.stopProxyServer();
        process.exit(1);
    }
}