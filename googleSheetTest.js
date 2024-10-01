const { GoogleSpreadsheet } = require('google-spreadsheet');
require('dotenv').config();

async function testGoogleSheets() {
    try {
        const doc = new GoogleSpreadsheet(process.env.SPREADSHEET_ID);
        await doc.useServiceAccountAuth({
            client_email: process.env.GOOGLE_CLIENT_EMAIL,
            private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
        });

        await doc.loadInfo();
        console.log('Successfully connected to the spreadsheet!');
        console.log('Spreadsheet title:', doc.title);
    } catch (error) {
        console.error('Error testing Google Sheets connection:', error);
    }
}

testGoogleSheets();
