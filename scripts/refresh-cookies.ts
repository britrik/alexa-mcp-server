#!/usr/bin/env bun
/**
 * Alexa Session Cookie Refresh Script
 * 
 * This script uses Playwright to log into Amazon.co.uk and extract
 * session cookies (ubid-acbuk, at-acbuk) for the UK marketplace.
 * 
 * Usage:
 *   bun run scripts/refresh-cookies.ts
 * 
 * Environment variables:
 *   AMAZON_EMAIL - Amazon account email
 *   AMAZON_PASSWORD - Amazon account password
 *   CF_ACCOUNT_ID - Cloudflare account ID
 *   CF_API_TOKEN - Cloudflare API token
 *   KV_NAMESPACE_ID - KV namespace ID (SESSION_KV)
 * 
 * The cookies are stored in the KV namespace with encryption.
 * Rotation period: 4 days (can be configured)
 */

import { chromium, type Browser, type Page } from 'playwright';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

// Configuration
const KV_NAMESPACE_ID = process.env.KV_NAMESPACE_ID || '056a19c677b44a4a92f794933384c456';
const SESSION_KEY = 'alexa/session/current';
const ENCRYPTION_KEY = process.env.SESSION_ENCRYPTION_KEY || 'your-32-byte-encryption-key-here!';

// UK Amazon URLs
const AMAZON_UK_LOGIN_URL = 'https://www.amazon.co.uk/ap/signin';
const AMAZON_UK_COOKIE_DOMAIN = '.amazon.co.uk';

// Cookie names for UK marketplace
const UK_UBID_COOKIE = 'ubid-acbuk';
const UK_AT_COOKIE = 'at-acbuk';

interface SessionCookies {
  ubidMain: string;
  atMain: string;
  timestamp: number;
}

interface EncryptedSession {
  iv: string;
  ciphertext: string;
  timestamp: number;
}

/**
 * Encrypt data using AES-GCM
 */
async function encrypt(data: SessionCookies, key: string): Promise<EncryptedSession> {
  const encoder = new TextEncoder();
  const keyBuffer = encoder.encode(key.padEnd(32, '0').slice(0, 32));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyBuffer,
    { name: 'AES-GCM' },
    false,
    ['encrypt']
  );
  
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    cryptoKey,
    encoder.encode(JSON.stringify(data))
  );
  
  return {
    iv: Buffer.from(iv).toString('base64'),
    ciphertext: Buffer.from(encrypted).toString('base64'),
    timestamp: Date.now()
  };
}

/**
 * Main function to refresh Alexa session cookies
 */
async function refreshCookies(): Promise<void> {
  const email = process.env.AMAZON_EMAIL;
  const password = process.env.AMAZON_PASSWORD;
  
  if (!email || !password) {
    console.error('Error: AMAZON_EMAIL and AMAZON_PASSWORD environment variables are required');
    console.error('');
    console.error('Usage:');
    console.error('  AMAZON_EMAIL=your@email.com AMAZON_PASSWORD=yourpassword bun run scripts/refresh-cookies.ts');
    process.exit(1);
  }
  
  console.log('🔐 Starting Alexa session cookie refresh...');
  console.log(`📧 Email: ${email}`);
  
  let browser: Browser | null = null;
  
  try {
    // Launch browser in headless mode
    console.log('🌐 Launching browser...');
    browser = await chromium.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu'
      ]
    });
    
    const context = await browser.newContext({
      viewport: { width: 1920, height: 1080 },
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    });
    
    const page = await context.newPage();
    
    // Navigate to Amazon UK login
    console.log('📱 Navigating to Amazon UK...');
    await page.goto(AMAZON_UK_LOGIN_URL, { waitUntil: 'networkidle', timeout: 30000 });
    
    // Check if already logged in
    const currentUrl = page.url();
    console.log(`📍 Current URL: ${currentUrl}`);
    
    if (!currentUrl.includes('/ap/signin')) {
      console.log('✅ Already logged in!');
    } else {
      // Enter email
      console.log('✍️ Entering email...');
      await page.fill('#ap_email', email);
      await page.click('#continue-form input[type="submit"]');
      await page.waitForNavigation({ waitUntil: 'networkidle', timeout: 15000 });
      
      // Enter password
      console.log('✍️ Entering password...');
      await page.fill('#ap_password', password);
      await page.click('#signInSubmit');
      await page.waitForNavigation({ waitUntil: 'networkidle', timeout: 15000 });
    }
    
    // Verify we're logged in
    const finalUrl = page.url();
    console.log(`📍 Final URL: ${finalUrl}`);
    
    if (finalUrl.includes('/ap/signin') && finalUrl.includes('openid')) {
      throw new Error('Login failed - still on signin page');
    }
    
    console.log('✅ Successfully logged in!');
    
    // Get cookies
    console.log('🍪 Extracting cookies...');
    const cookies = await context.cookies();
    
    const ubidCookie = cookies.find(c => c.name === UK_UBID_COOKIE);
    const atCookie = cookies.find(c => c.name === UK_AT_COOKIE);
    
    if (!ubidCookie || !atCookie) {
      console.error('❌ Failed to find required cookies:');
      console.error(`  - ${UK_UBID_COOKIE}: ${ubidCookie ? 'found' : 'MISSING'}`);
      console.error(`  - ${UK_AT_COOKIE}: ${atCookie ? 'found' : 'MISSING'}`);
      
      // Log all cookies for debugging
      console.log('\n📋 All cookies:');
      cookies.forEach(c => console.log(`  - ${c.name}: ${c.value.slice(0, 20)}...`));
      
      throw new Error('Required UK marketplace cookies not found');
    }
    
    console.log(`✅ Found cookies:`);
    console.log(`  - ${UK_UBID_COOKIE}: ${ubidCookie.value.slice(0, 20)}...`);
    console.log(`  - ${UK_AT_COOKIE}: ${atCookie.value.slice(0, 20)}...`);
    
    // Create session object
    const session: SessionCookies = {
      ubidMain: ubidCookie.value,
      atMain: atCookie.value,
      timestamp: Date.now()
    };
    
    // Encrypt the session
    console.log('🔒 Encrypting session data...');
    const encrypted = await encrypt(session, ENCRYPTION_KEY);
    
    // Store in KV using Cloudflare API
    console.log('💾 Storing in KV...');
    await storeInKV(encrypted);
    
    console.log('✅ Cookie refresh complete!');
    console.log(`⏰ Session expires in 4 days`);
    
  } catch (error) {
    console.error('❌ Error during cookie refresh:', error);
    process.exit(1);
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

/**
 * Store encrypted session in Cloudflare KV
 */
async function storeInKV(data: EncryptedSession): Promise<void> {
  const accountId = process.env.CF_ACCOUNT_ID;
  const apiToken = process.env.CF_API_TOKEN;
  
  if (!accountId || !apiToken) {
    console.log('⚠️ CF_ACCOUNT_ID or CF_API_TOKEN not set - skipping KV storage');
    console.log('   (You can manually copy the encrypted data if needed)');
    console.log('\n📋 Encrypted session data:');
    console.log(JSON.stringify(data, null, 2));
    return;
  }
  
  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/storage/kv/namespaces/${KV_NAMESPACE_ID}/values/${SESSION_KEY}`;
  
  const response = await fetch(url, {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${apiToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      value: JSON.stringify(data),
      expiration_ttl: 4 * 24 * 60 * 60 // 4 days in seconds
    })
  });
  
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to store in KV: ${response.status} - ${error}`);
  }
  
  console.log('✅ Stored in KV namespace');
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  refreshCookies();
}

export { refreshCookies };