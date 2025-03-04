// google-sheets-client.js
require('dotenv').config();
const { google } = require('googleapis');

// Handle credentials in a more robust way with enhanced logging
function getGoogleCredentials() {
  console.log('=== GOOGLE CREDENTIALS DEBUGGING ===');
  
  const clientEmail = process.env.GOOGLE_CLIENT_EMAIL;
  console.log(`Client email exists: ${Boolean(clientEmail)}`);
  if (clientEmail) {
    // Only log a safe portion of the email
    const emailParts = clientEmail.split('@');
    if (emailParts.length === 2) {
      const username = emailParts[0];
      const domain = emailParts[1];
      const safeUsername = username.length > 3 
        ? username.substring(0, 2) + '*'.repeat(username.length - 2) 
        : '***';
      console.log(`Email format: ${safeUsername}@${domain}`);
    }
  }
  
  let privateKey = process.env.GOOGLE_PRIVATE_KEY;
  console.log(`Private key exists: ${Boolean(privateKey)}`);
  
  if (!privateKey) {
    console.warn('WARNING: GOOGLE_PRIVATE_KEY is undefined');
    return { clientEmail, privateKey: null };
  }
  
  // Log key characteristics before processing
  console.log(`Private key original length: ${privateKey.length}`);
  console.log(`Private key starts with quotes: ${privateKey.startsWith('"')}`);
  console.log(`Private key ends with quotes: ${privateKey.endsWith('"')}`);
  console.log(`Private key contains \\n: ${privateKey.includes('\\n')}`);
  console.log(`Private key contains actual newlines: ${privateKey.includes('\n')}`);
  
  const keyBeginning = privateKey.substring(0, 30);
  const keyEnding = privateKey.substring(privateKey.length - 30);
  
  // Only log the first and last few characters safely
  console.log(`Key beginning: ${keyBeginning.substring(0, Math.min(15, keyBeginning.length))}...`);
  console.log(`Key ending: ...${keyEnding.substring(Math.max(0, keyEnding.length - 15))}`);
  
  try {
    // Handle different formats of the private key
    if (privateKey.startsWith('"') && privateKey.endsWith('"')) {
      console.log('Removing surrounding quotes using JSON.parse()');
      privateKey = JSON.parse(privateKey);
      console.log(`After quote removal - length: ${privateKey.length}`);
    }
    
    if (privateKey.includes('\\n')) {
      console.log('Converting \\n to newlines');
      privateKey = privateKey.replace(/\\n/g, '\n');
      console.log(`After newline conversion - length: ${privateKey.length}`);
      console.log(`Contains actual newlines now: ${privateKey.includes('\n')}`);
    }
    
    // Check for PEM format after processing
    const hasPEMHeader = privateKey.includes('-----BEGIN PRIVATE KEY-----');
    const hasPEMFooter = privateKey.includes('-----END PRIVATE KEY-----');
    console.log(`Key has PEM header: ${hasPEMHeader}`);
    console.log(`Key has PEM footer: ${hasPEMFooter}`);
    
    // Count lines in the key after processing
    if (privateKey.includes('\n')) {
      const lineCount = privateKey.split('\n').length;
      console.log(`Key contains ${lineCount} lines after processing`);
    }
    
    // Check if the key appears to be valid PEM format
    const isPEMValid = hasPEMHeader && hasPEMFooter && privateKey.includes('\n');
    console.log(`Key appears to be valid PEM format: ${isPEMValid}`);
    
    if (!isPEMValid) {
      console.warn('WARNING: Key does not appear to be in valid PEM format after processing');
    }
    
  } catch (error) {
    console.error(`Error processing Google credentials: ${error.message}`);
    console.error(`Error stack: ${error.stack}`);
  }
  
  console.log('=== END CREDENTIALS DEBUGGING ===');
  return { clientEmail, privateKey };
}

// Create the sheets client
console.log('Initializing Google Sheets client');
const { clientEmail, privateKey } = getGoogleCredentials();

// Log JWT creation attempt
console.log(`Attempting to create JWT with client email: ${Boolean(clientEmail)} and private key: ${Boolean(privateKey)}`);

try {
  const auth = new google.auth.JWT(
    clientEmail,
    null,
    privateKey,
    ['https://www.googleapis.com/auth/spreadsheets']
  );
  
  console.log('JWT created successfully');
  
  const sheets = google.sheets({
    version: 'v4',
    auth
  });
  
  console.log('Google Sheets client initialized');
  module.exports = sheets;
} catch (error) {
  console.error(`Failed to create Google Sheets client: ${error.message}`);
  console.error(`Error stack: ${error.stack}`);
  
  // Export a mock client that will log errors when used
  module.exports = {
    spreadsheets: {
      values: {
        get: async () => {
          throw new Error('Google Sheets client failed to initialize');
        },
        update: async () => {
          throw new Error('Google Sheets client failed to initialize');
        }
      },
      batchUpdate: async () => {
        throw new Error('Google Sheets client failed to initialize');
      }
    }
  };
}