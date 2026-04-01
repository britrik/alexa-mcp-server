#!/usr/bin/env bun
/**
 * Alexa Cookie Refresh using Amazon's Token Exchange Endpoint
 * 
 * This script uses Amazon's undocumented cookie exchange endpoint to refresh
 * session cookies (ubid-acbuk, at-acbuk) without needing a full browser.
 * 
 * Based on research from alexa-cookie-cli and alexa_media_player projects.
 * 
 * Usage:
 *   bun run scripts/refresh-cookies.ts
 * 
 * Environment variables:
 *   AMAZON_REFRESH_TOKEN - Your Amazon refresh token (Atnr|...)
 *   CF_ACCOUNT_ID - Cloudflare account ID
 *   CF_API_TOKEN - Cloudflare API token
 *   KV_NAMESPACE_ID - KV namespace ID
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

// Configuration
const KV_NAMESPACE_ID = process.env.KV_NAMESPACE_ID || '056a19c677b44a4a92f794933384c456';
const SESSION_KEY = 'alexa/session/current';
const ENCRYPTION_KEY = process.env.SESSION_ENCRYPTION_KEY || 'your-32-byte-encryption-key-here!';

// Amazon UK domain
const AMAZON_DOMAIN = 'amazon.co.uk';
const COOKIE_EXCHANGE_URL = `https://www.${AMAZON_DOMAIN}/ap/exchangetoken/cookies`;
const IDENTITY_AUTH_DOMAIN = `api.${AMAZON_DOMAIN}`;

// Required cookies we need to extract
const REQUIRED_COOKIES = ['ubid-acbuk', 'at-acbuk', 'x-acbuk', 'session-id'];

interface CookieExchangeRequest {
  source_token: string;
  requested_token_type: string;
  source_token_type: string;
  app_version: string;
  di_sdk_version: string;
  app_name: string;
  domain: string;
  di_os_name: string;
  di_hw_version: string;
}

interface SessionCookies {
  ubidMain: string;
  atMain: string;
  xAcbuk?: string;
  sessionId?: string;
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
  const refreshToken = process.env.AMAZON_REFRESH_TOKEN;
  
  if (!refreshToken) {
    console.error('Error: AMAZON_REFRESH_TOKEN environment variable is required');
    console.error('');
    console.error('Usage:');
    console.error('  AMAZON_REFRESH_TOKEN=Atnr|... bun run scripts/refresh-cookies-v2.ts');
    console.error('');
    console.error('To get initial refresh token:');
    console.error('  1. Log into Amazon.co.uk in a browser');
    console.error('  2. Go to alexa.amazon.co.uk');
    console.error('  3. Extract refresh token from browser dev tools');
    process.exit(1);
  }
  
  console.log('🔐 Starting Alexa cookie refresh...');
  console.log(`🔑 Refresh token: ${refreshToken.slice(0, 20)}...`);
  
  // Build the request
  const requestBody: CookieExchangeRequest = {
    source_token: refreshToken,
    requested_token_type: 'auth_cookies',
    source_token_type: 'refresh_token',
    app_version: '2.2.651540.0',
    di_sdk_version: '6.12.4',
    app_name: 'ioBroker Alexa2',
    domain: `.${AMAZON_DOMAIN}`,
    di_os_name: 'iOS',
    di_hw_version: 'iPhone'
  };
  
  try {
    console.log('📡 Calling cookie exchange endpoint...');
    
    const response = await fetch(COOKIE_EXCHANGE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'x-amzn-identity-auth-domain': IDENTITY_AUTH_DOMAIN,
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
      },
      body: new URLSearchParams(requestBody as any).toString()
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Cookie exchange failed: ${response.status} - ${errorText}`);
    }
    
    const responseData = await response.json();
    console.log('✅ Cookie exchange successful!');
    
    // Extract cookies from response
    const cookies = responseData.cookies || responseData.website_cookies || [];
    
    // Find required cookies
    const ubidCookie = cookies.find((c: any) => c.name === 'ubid-acbuk');
    const atCookie = cookies.find((c: any) => c.name === 'at-acbuk');
    const xAcbukCookie = cookies.find((c: any) => c.name === 'x-acbuk');
    const sessionIdCookie = cookies.find((c: any) => c.name === 'session-id');
    
    if (!ubidCookie || !atCookie) {
      throw new Error(`Required cookies not found in response. Found: ${cookies.map((c: any) => c.name).join(', ')}`);
    }
    
    console.log(`✅ Found cookies:`);
    console.log(`  - ubid-acbuk: ${ubidCookie.value.slice(0, 20)}...`);
    console.log(`  - at-acbuk: ${atCookie.value.slice(0, 20)}...`);
    if (xAcbukCookie) console.log(`  - x-acbuk: ${xAcbukCookie.value.slice(0, 20)}...`);
    if (sessionIdCookie) console.log(`  - session-id: ${sessionIdCookie.value.slice(0, 20)}...`);
    
    // Create session object
    const session: SessionCookies = {
      ubidMain: ubidCookie.value,
      atMain: atCookie.value,
      xAcbuk: xAcbukCookie?.value,
      sessionId: sessionIdCookie?.value,
      timestamp: Date.now()
    };
    
    // Encrypt the session
    console.log('🔒 Encrypting session data...');
    const encrypted = await encrypt(session, ENCRYPTION_KEY);
    
    // Store in KV
    console.log('💾 Storing in KV...');
    await storeInKV(encrypted);
    
    console.log('✅ Cookie refresh complete!');
    console.log(`⏰ Session will expire - refresh every 4 days`);
    
  } catch (error) {
    console.error('❌ Error during cookie refresh:', error);
    process.exit(1);
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