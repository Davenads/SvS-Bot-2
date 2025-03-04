// google-sheets-client.js
require('dotenv').config();
const { google } = require('googleapis');

// Handle credentials in a more robust way
function getGoogleCredentials() {
  const clientEmail = process.env.GOOGLE_CLIENT_EMAIL;
  let privateKey = process.env.GOOGLE_PRIVATE_KEY;
  
  try {
    // Handle different formats of the private key
    if (privateKey) {
      if (privateKey.startsWith('"') && privateKey.endsWith('"')) {
        privateKey = JSON.parse(privateKey);
      }
      if (privateKey.includes('\\n')) {
        privateKey = privateKey.replace(/\\n/g, '\n');
      }
    } else {
      console.warn('WARNING: GOOGLE_PRIVATE_KEY is undefined');
    }
  } catch (error) {
    console.error('Error processing Google credentials:', error.message);
  }
  
  return { clientEmail, privateKey };
}

// Create the sheets client
const { clientEmail, privateKey } = getGoogleCredentials();
const sheets = google.sheets({
  version: 'v4',
  auth: new google.auth.JWT(
    clientEmail,
    null,
    privateKey,
    ['https://www.googleapis.com/auth/spreadsheets']
  )
});

module.exports = sheets;