// This file adds handling for properly formatting the Google service account private key
// on Heroku, which stores environment variables differently than local development

// If GOOGLE_PRIVATE_KEY has quotes, remove them (common Heroku issue)
if (process.env.GOOGLE_PRIVATE_KEY) {
  if (process.env.GOOGLE_PRIVATE_KEY.startsWith('"') && process.env.GOOGLE_PRIVATE_KEY.endsWith('"')) {
    process.env.GOOGLE_PRIVATE_KEY = process.env.GOOGLE_PRIVATE_KEY.slice(1, -1);
  }
  
  // Replace literal \n with actual newlines if needed
  if (!process.env.GOOGLE_PRIVATE_KEY.includes('\n')) {
    process.env.GOOGLE_PRIVATE_KEY = process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n');
  }
}

// Export helper function for cleaner authentication
module.exports = {
  getGoogleAuth: () => {
    const { google } = require('googleapis');
    return new google.auth.JWT(
      process.env.GOOGLE_CLIENT_EMAIL,
      null,
      process.env.GOOGLE_PRIVATE_KEY,
      ['https://www.googleapis.com/auth/spreadsheets']
    );
  }
};