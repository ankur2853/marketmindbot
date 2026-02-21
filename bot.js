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

// ─── Ask Gemini to Identify Stock ────────────────────────────
async function identifyStock(input) {
    const prompt = `
You are a stock market expert. The user typed: "${input}"

Identify if this is an Indian stock or a US stock and return the correct ticker symbol.

Reply in this EXACT format only, nothing else:
MARKET: [INDIA/US]
SYMBOL: [exact ticker symbol]
NAME: [full company name]

Rules:
- For Indian stocks, use NSE symbol (e.g. RELIANCE, TCS, ADANIPOWER, HDFCBANK)
- For US stocks, use NASDAQ/NYSE symbol (e.g. AAPL, TSLA, GOOGL, MSFT)
- If you cannot identify, reply with MARKET: UNKNOWN
`;
    const result = await model.generateContent(prompt);
    const text = result.response.text().trim();

    const market = text.match(/MARKET:\s*(\w+)/i)?.[1]?.toUpperCase() || 'UNKNOWN';
    const symbol = text.match(/SYMBOL:\s*(\S+)/i)?.[1]?.toUpperCase().replace(/[^A-Z0-9.&]/g, '') || '';
    const name = text.match(/NAME:\s*(.+)/i)?.[1]?.trim() || input;

    return { market, symbol, name };
}

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

    throw new Error('Symbol not found');
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

// ─── Ask Gemini for Trade Signal ─────────────────────────────
async function getAISignal(symbol, companyName, stockData, market) {
    const { price, prevClose, high, low, volume, change, currency } = stockData;

    const prompt = `
You are an expert stock market analyst specializing in ${market} stocks.
Analyze the following real-time stock data and give a professional trading signal.

Company: ${companyName} (${symbol})
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

// ─── Parse Gemini Signal Response ────────────────────────────
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
        `Just type any *company name or symbol* and I will automatically detect if it's Indian or US stock and give you an AI trading signal!\n\n` +
        `📊 *Examples — just type:*\n` +
        `• Reliance\n` +
        `• Adani Power\n` +
        `• TCS\n` +
        `• HDFCBANK\n` +
        `• Apple\n` +
        `• Tesla\n` +
        `• Google\n\n` +
        `_⚠️ Disclaimer: This is AI analysis only, not financial advice._`,
        { parse_mode: 'Markdown' }
    );
});

// ─── Handle All Messages ──────────────────────────────────────
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text?.trim();

    // Ignore commands
    if (!text || text.startsWith('/')) return;

    try {
        await bot.sendMessage(chatId,
            `🧠 Asking Gemini to identify *${text}*... please wait ⏳`,
            { parse_mode: 'Markdown' }
        );

        // Step 1: Gemini identifies the stock
        const { market, symbol, name } = await identifyStock(text);

        if (market === 'UNKNOWN' || !symbol) {
            await bot.sendMessage(chatId,
                `❌ Could not identify *${text}* as a stock.\n\n` +
                `Try typing:\n` +
                `• Reliance\n` +
                `• Adani Power\n` +
                `• Apple\n` +
                `• Tesla`,
                { parse_mode: 'Markdown' }
            );
            return;
        }

        const marketFlag = market === 'INDIA' ? '🇮🇳' : '🇺🇸';
        const marketName = market === 'INDIA' ? 'NSE/BSE' : 'NASDAQ/NYSE';

        await bot.sendMessage(chatId,
            `${marketFlag} Found: *${name}* (${symbol}) on ${marketName}\n🔍 Fetching live data...`,
            { parse_mode: 'Markdown' }
        );

        // Step 2: Fetch stock data
        let stockData;
        if (market === 'INDIA') {
            stockData = await fetchIndianStock(symbol);
        } else {
            stockData = await fetchUSStock(symbol);
        }

        // Step 3: Get AI signal
        const aiResponse = await getAISignal(symbol, name, stockData, marketName);
        const { signal, confidence, reason, risk, target, emoji } = parseAIResponse(aiResponse);

        // Step 4: Send result
        await bot.sendMessage(chatId,
            `📊 *${name} (${symbol})*\n` +
            `${marketFlag} Market: ${marketName}\n\n` +
            `💰 Price: ${stockData.currency}${stockData.price}\n` +
            `📈 Change: ${stockData.change.toFixed(2)}%\n` +
            `🔺 High: ${stockData.currency}${stockData.high}   🔻 Low: ${stockData.currency}${stockData.low}\n` +
            `📦 Volume: ${stockData.volume.toLocaleString()}\n\n` +
            `━━━━━━━━━━━━━━━\n` +
            `🤖 *AI Signal: ${emoji} ${signal}*\n` +
            `🎯 Confidence: ${confidence}\n` +
            `⚠️ Risk Level: ${risk}\n` +
            `🎪 Target Price: ${target}\n` +
            `💡 Reason: ${reason}\n\n` +
            `_⚠️ Disclaimer: This is AI analysis only, not financial advice._`,
            { parse_mode: 'Markdown' }
        );

    } catch (err) {
        console.error(`[Error] ${text}:`, err.message);
        await bot.sendMessage(chatId,
            `❌ Something went wrong while fetching data for *${text}*.\n\nPlease try again or use the exact symbol.`,
            { parse_mode: 'Markdown' }
        );
    }
});

// ─── Polling Error Handler ────────────────────────────────────
bot.on('polling_error', (err) => {
    console.error('❌ Polling error:', err.message);
});

console.log('🤖 MarketMindBot with Gemini AI is running...');