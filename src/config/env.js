require('dotenv').config({ quiet: true });

function validateEnv() {
    const requiredVars = [
        'TELEGRAM_TOKEN',
        'GEMINI_API_KEY',
    ];

    const missing = requiredVars.filter(key => !process.env[key]);

    if (missing.length > 0) {
        console.error(`❌ Missing required environment variables: ${missing.join(', ')}`);
        process.exit(1);
    }

    if (!process.env.ALPHA_KEY) {
        console.warn('⚠️ ALPHA_KEY missing in .env. US Stock data might fail.');
    }
}

validateEnv();

module.exports = {
    TELEGRAM_TOKEN: process.env.TELEGRAM_TOKEN,
    GEMINI_API_KEY: process.env.GEMINI_API_KEY,
    ALPHA_KEY: process.env.ALPHA_KEY
};
