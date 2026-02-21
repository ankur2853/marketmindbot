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

    if (!process.env.TWELVE_KEY) {
        console.warn('⚠️  TWELVE_KEY missing in .env — US stocks and Forex will not work');
        console.warn('   Get a free key at: https://twelvedata.com/register');
    }
}

validateEnv();

module.exports = {
    TELEGRAM_TOKEN: process.env.TELEGRAM_TOKEN,
    GEMINI_API_KEY: process.env.GEMINI_API_KEY,
    TWELVE_KEY: process.env.TWELVE_KEY
};
