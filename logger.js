const fs = require('fs');
const path = require('path');

// Specify the log file path
const logFilePath = path.join(__dirname, 'error.log');

// Function to sanitize error messages and remove sensitive information
function sanitizeError(error) {
    if (!error) return 'Unknown error';
    
    let message = typeof error === 'string' ? error : error.message || 'Unknown error';
    
    // Remove file paths (both Windows and Unix style)
    message = message.replace(/[A-Za-z]:[\\\/][\w\s\-\.\\\/]+/g, '[SANITIZED_PATH]');
    message = message.replace(/\/[\w\s\-\.\/]+/g, '[SANITIZED_PATH]');
    
    // Remove stack traces
    message = message.replace(/\s+at\s+[\w\s\-\.\/\\:]+/g, '');
    
    // Remove Discord IDs (17-19 digit snowflakes)
    message = message.replace(/\b\d{17,19}\b/g, '[DISCORD_ID]');
    
    // Remove potential API keys or tokens (32+ character alphanumeric strings)
    message = message.replace(/[A-Za-z0-9]{32,}/g, '[REDACTED_TOKEN]');
    
    // Remove email addresses
    message = message.replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '[EMAIL_REDACTED]');
    
    // Remove IP addresses
    message = message.replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, '[IP_REDACTED]');
    
    return message.trim();
}

// Function to log messages with sanitization
function logError(message, error = null) {
    const timestamp = new Date().toISOString();
    
    // Sanitize the main message
    const sanitizedMessage = sanitizeError(message);
    
    // If an error object is provided, sanitize it too but log basic info
    let errorInfo = '';
    if (error) {
        errorInfo = ` | Error Type: ${error.constructor.name || 'Error'} | Code: ${error.code || 'N/A'}`;
    }
    
    const logMessage = `[${timestamp}] ${sanitizedMessage}${errorInfo}\n`;
    
    // Append the log message to the log file
    fs.appendFile(logFilePath, logMessage, (err) => {
        if (err) console.error('Failed to write to log file');
    });
}

// Function for development logging (only in development mode)
function logErrorVerbose(message, error = null) {
    if (process.env.NODE_ENV === 'development') {
        const timestamp = new Date().toISOString();
        const fullMessage = error ? `${message}\nStack: ${error.stack}` : message;
        const logMessage = `[${timestamp}] [DEV] ${fullMessage}\n`;
        
        fs.appendFile(logFilePath, logMessage, (err) => {
            if (err) console.error('Failed to write to log file');
        });
    } else {
        // In production, fall back to sanitized logging
        logError(message, error);
    }
}

module.exports = {
    logError,
    logErrorVerbose,
    sanitizeError
};
