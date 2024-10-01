const fs = require('fs');
const path = require('path');

// Specify the log file path
const logFilePath = path.join(__dirname, 'error.log');

// Function to log messages
function logError(message) {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] ${message}\n`;
    
    // Append the log message to the log file
    fs.appendFile(logFilePath, logMessage, (err) => {
        if (err) console.error('Failed to write to log file:', err);
    });
}

module.exports = {
    logError
};
