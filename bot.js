require('dotenv').config({ quiet: true });
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const { GoogleGenerativeAI } = require('@google/generative-ai');

// ─── Validate ENV ─────────────────────────────────────────────
if (!process.env.TELEGRAM_TOKEN) {
    console.error('❌ TELEGRAM_TOKEN missing in .env');
    process.exit(1);
}
if (!process.env.GEMINI_API_KEY) {
    console.error('❌ GEMINI_API_KEY missing in .env');
    process.exit(1);
}

const bot = new TelegramBot(process.env.TELEGRAM_TOKEN, { polling: true });
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

// ─── Fetch Indian Stock (NSE/BSE) ─────────────────────────────
async function fetchIndianStock(symbol) {
    const formats = [`${symbol}.NS`, `${symbol}.BO`];

    for (const fmt of formats) {
        try {
            const url = `https://query1.finance.yahoo.com/v8/finance/chart/${fmt}`;
            const response = await axios.get(url, {
                headers: { 'User-Agent': 'Mozilla/5.0' },
                timeout: 10000
            });

            const result = response.data.chart.result[0];
            if (!result) continue;

            const meta = result.meta;
            const price = meta.regularMarketPrice;
            const prevClose = meta.chartPreviousClose;
            const high = meta.regularMarketDayHigh;
            const low = meta.regularMarketDayLow;
            const volume = meta.regularMarketVolume;
            const change = ((price - prevClose) / prevClose) * 100;

            return { price, prevClose, high, low, volume, change, currency: '₹' };
        } catch (e) {
            continue;
        }
    }

    throw new Error('Symbol not found in NSE or BSE');
}

// ─── Fetch US Stock (Alpha Vantage) ───────────────────────────
async function fetchUSStock(symbol) {
    if (!process.env.ALPHA_KEY) throw new Error('ALPHA_KEY missing in .env');

    const response = await axios.get(
        `https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${symbol}&apikey=${process.env.ALPHA_KEY}`,
        { timeout: 10000 }
    );

    const data = response.data['Global Quote'];
    if (!data || !data['05. price']) throw new Error('No data found');

    const price = parseFloat(data['05. price']);
    const prevClose = parseFloat(data['08. previous close']);
    const high = parseFloat(data['03. high']);
    const low = parseFloat(data['04. low']);
    const volume = parseInt(data['06. volume']);
    const change = parseFloat(data['10. change percent']);

    return { price, prevClose, high, low, volume, change, currency: '$' };
}

// ─── Ask Gemini for Correct NSE Symbol ───────────────────────
async function getCorrectSymbol(companyName) {
    const prompt = `
What is the exact NSE (National Stock Exchange India) ticker symbol for "${companyName}"?
Reply with ONLY the symbol, nothing else. No explanation. No punctuation. Just the symbol in uppercase.
Example: if asked for "Reliance Industries" reply with: RELIANCE
Example: if asked for "Adani Power" reply with: ADANIPOWER
Example: if asked for "Tata Motors" reply with: TATAMOTORS
If you are not sure, reply with: UNKNOWN
`;
    const result = await model.generateContent(prompt);
    const symbol = result.response.text().trim().replace(/[^A-Z0-9&]/g, '');
    return symbol;
}

// ─── Ask Gemini for Trade Signal ─────────────────────────────
async function getAISignal(symbol, stockData, market) {
    const { price, prevClose, high, low, volume, change, currency } = stockData;

    const prompt = `
You are an expert stock market analyst specializing in ${market} stocks.
Analyze the following real-time stock data and give a professional trading signal.

Stock: ${symbol}
Market: ${market}
Current Price: ${currency}${price}
Previous Close: ${currency}${prevClose}
Day High: ${currency}${high}
Day Low: ${currency}${low}
Volume: ${volume}
Change Today: ${change.toFixed(2)}%

Based on this data, provide:
1. Signal: BUY, SELL, or HOLD
2. Confidence: High, Medium, or Low
3. Reason: 2-3 short sentences explaining the signal
4. Risk Level: Low, Medium, or High
5. Target Price: a short-term target price estimate

Reply in this EXACT format only:
SIGNAL: [BUY/SELL/HOLD]
CONFIDENCE: [High/Medium/Low]
REASON: [your reason here]
RISK: [Low/Medium/High]
TARGET: [${currency}price]
`;

    const result = await model.generateContent(prompt);
    return result.response.text();
}

// ─── Parse Gemini Response ────────────────────────────────────
function parseAIResponse(text) {
    const signal = text.match(/SIGNAL:\s*(\w+)/i)?.[1]?.toUpperCase() || 'HOLD';
    const confidence = text.match(/CONFIDENCE:\s*(\w+)/i)?.[1] || 'Low';
    const reason = text.match(/REASON:\s*(.+)/i)?.[1]?.trim() || 'No reason provided';
    const risk = text.match(/RISK:\s*(\w+)/i)?.[1] || 'Medium';
    const target = text.match(/TARGET:\s*(.+)/i)?.[1]?.trim() || 'N/A';

    const emoji = signal === 'BUY' ? '🟢' : signal === 'SELL' ? '🔴' : '⚪';

    return { signal, confidence, reason, risk, target, emoji };
}

// ─── /start ───────────────────────────────────────────────────
bot.onText(/\/start/, (msg) => {
    bot.sendMessage(msg.chat.id,
        `👋 Welcome to *MarketMindBot!* 🤖\n\n` +
        `🧠 Powered by *Google Gemini AI*\n\n` +
        `📌 *Commands:*\n` +
        `🇮🇳 /trade [symbol] — Indian Stock (NSE/BSE)\n` +
        `🇺🇸 /us [symbol] — US Stock (NASDAQ/NYSE)\n` +
        `ℹ️ /help — Show examples\n\n` +
        `📊 *Examples:*\n` +
        `/trade RELIANCE\n` +
        `/trade ADANIPOWER\n` +
        `/trade HDFCBANK\n` +
        `/us AAPL\n` +
        `/us TSLA`,
        { parse_mode: 'Markdown' }
    );
});

// ─── /help ────────────────────────────────────────────────────
bot.onText(/\/help/, (msg) => {
    bot.sendMessage(msg.chat.id,
        `ℹ️ *MarketMindBot Help*\n\n` +
        `🇮🇳 *Indian Stocks (NSE/BSE):*\n` +
        `/trade RELIANCE\n` +
        `/trade TCS\n` +
        `/trade INFY\n` +
        `/trade HDFCBANK\n` +
        `/trade WIPRO\n` +
        `/trade ADANIPOWER\n` +
        `/trade TATAMOTORS\n` +
        `/trade SBIN\n\n` +
        `🇺🇸 *US Stocks:*\n` +
        `/us AAPL\n` +
        `/us TSLA\n` +
        `/us GOOGL\n` +
        `/us MSFT\n` +
        `/us AMZN\n\n` +
        `💡 *Tip:* You can also type company name and Gemini will find the symbol automatically!\n` +
        `Example: /trade Adani Power`,
        { parse_mode: 'Markdown' }
    );
});

// ─── /trade - Indian Stocks ───────────────────────────────────
bot.onText(/\/trade (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    let company = match[1].trim().toUpperCase();

    try {
        await bot.sendMessage(chatId,
            `🔍 Analyzing *${company}* with Gemini AI... please wait ⏳`,
            { parse_mode: 'Markdown' }
        );

        let stockData;

        try {
            stockData = await fetchIndianStock(company);
        } catch (err) {
            // If direct fetch fails, ask Gemini for correct symbol
            await bot.sendMessage(chatId,
                `🧠 Asking Gemini to find correct NSE symbol for *${company}*...`,
                { parse_mode: 'Markdown' }
            );

            const correctedSymbol = await getCorrectSymbol(company);

            if (!correctedSymbol || correctedSymbol === 'UNKNOWN') {
                throw new Error('Gemini could not identify the stock symbol');
            }

            await bot.sendMessage(chatId,
                `✅ Found symbol: *${correctedSymbol}* — fetching live data...`,
                { parse_mode: 'Markdown' }
            );

            company = correctedSymbol;
            stockData = await fetchIndianStock(company);
        }

        const aiResponse = await getAISignal(company, stockData, 'Indian NSE/BSE');
        const { signal, confidence, reason, risk, target, emoji } = parseAIResponse(aiResponse);

        await bot.sendMessage(chatId,
            `📊 *${company} (NSE/BSE)*\n\n` +
            `💰 Price: ₹${stockData.price}\n` +
            `📈 Change: ${stockData.change.toFixed(2)}%\n` +
            `🔺 High: ₹${stockData.high}   🔻 Low: ₹${stockData.low}\n` +
            `📦 Volume: ${stockData.volume.toLocaleString()}\n\n` +
            `━━━━━━━━━━━━━━━\n` +
            `🤖 *AI Signal: ${emoji} ${signal}*\n` +
            `🎯 Confidence: ${confidence}\n` +
            `⚠️ Risk Level: ${risk}\n` +
            `🎯 Target Price: ${target}\n` +
            `💡 Reason: ${reason}\n\n` +
            `_⚠️ Disclaimer: This is AI analysis only, not financial advice._`,
            { parse_mode: 'Markdown' }
        );

    } catch (err) {
        console.error(`[Indian Stock Error] ${company}:`, err.message);
        await bot.sendMessage(chatId,
            `❌ Could not fetch data for *${company}*.\n\n` +
            `Try these valid symbols:\n` +
            `• /trade RELIANCE\n` +
            `• /trade ADANIPOWER\n` +
            `• /trade TATAMOTORS\n` +
            `• /trade HDFCBANK\n\n` +
            `Or type /help for more examples.`,
            { parse_mode: 'Markdown' }
        );
    }
});

// ─── /us - US Stocks ──────────────────────────────────────────
bot.onText(/\/us (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const company = match[1].trim().toUpperCase();

    try {
        await bot.sendMessage(chatId,
            `🔍 Analyzing *${company}* with Gemini AI... please wait ⏳`,
            { parse_mode: 'Markdown' }
        );

        const stockData = await fetchUSStock(company);
        const aiResponse = await getAISignal(company, stockData, 'US NASDAQ/NYSE');
        const { signal, confidence, reason, risk, target, emoji } = parseAIResponse(aiResponse);

        await bot.sendMessage(chatId,
            `📊 *${company} (NASDAQ/NYSE)*\n\n` +
            `💰 Price: $${stockData.price}\n` +
            `📈 Change: ${stockData.change.toFixed(2)}%\n` +
            `🔺 High: $${stockData.high}   🔻 Low: $${stockData.low}\n` +
            `📦 Volume: ${stockData.volume.toLocaleString()}\n\n` +
            `━━━━━━━━━━━━━━━\n` +
            `🤖 *AI Signal: ${emoji} ${signal}*\n` +
            `🎯 Confidence: ${confidence}\n` +
            `⚠️ Risk Level: ${risk}\n` +
            `🎯 Target Price: ${target}\n` +
            `💡 Reason: ${reason}\n\n` +
            `_⚠️ Disclaimer: This is AI analysis only, not financial advice._`,
            { parse_mode: 'Markdown' }
        );

    } catch (err) {
        console.error(`[US Stock Error] ${company}:`, err.message);
        await bot.sendMessage(chatId,
            `❌ Could not fetch data for *${company}*.\n\n` +
            `Try these valid symbols:\n` +
            `• /us AAPL\n` +
            `• /us TSLA\n` +
            `• /us GOOGL\n` +
            `• /us MSFT\n\n` +
            `Or type /help for more examples.`,
            { parse_mode: 'Markdown' }
        );
    }
});

// ─── Unknown Commands ─────────────────────────────────────────
bot.onText(/\/(.+)/, (msg, match) => {
    const command = match[1].split(' ')[0];
    if (!['start', 'help', 'trade', 'us'].includes(command)) {
        bot.sendMessage(msg.chat.id,
            `❓ Unknown command. Type /start or /help to see available commands.`
        );
    }
});

// ─── Polling Error Handler ────────────────────────────────────
bot.on('polling_error', (err) => {
    console.error('❌ Polling error:', err.message);
});

console.log('🤖 MarketMindBot with Gemini AI is running...');