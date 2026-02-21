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

// ════════════════════════════════════════════════════════════
//  TECHNICAL INDICATOR CALCULATIONS (No extra npm needed)
// ════════════════════════════════════════════════════════════

/**
 * Simple Moving Average
 */
function calcSMA(closes, period) {
    if (closes.length < period) return null;
    const slice = closes.slice(-period);
    return slice.reduce((a, b) => a + b, 0) / period;
}

/**
 * Exponential Moving Average
 */
function calcEMA(closes, period) {
    if (closes.length < period) return null;
    const k = 2 / (period + 1);
    let ema = closes.slice(0, period).reduce((a, b) => a + b, 0) / period;
    for (let i = period; i < closes.length; i++) {
        ema = closes[i] * k + ema * (1 - k);
    }
    return ema;
}

/**
 * RSI (14-period)
 */
function calcRSI(closes, period = 14) {
    if (closes.length < period + 1) return null;
    const changes = [];
    for (let i = 1; i < closes.length; i++) {
        changes.push(closes[i] - closes[i - 1]);
    }
    const recent = changes.slice(-period);
    const gains = recent.filter(c => c > 0).reduce((a, b) => a + b, 0) / period;
    const losses = Math.abs(recent.filter(c => c < 0).reduce((a, b) => a + b, 0)) / period;
    if (losses === 0) return 100;
    const rs = gains / losses;
    return 100 - (100 / (1 + rs));
}

/**
 * MACD (12, 26, 9)
 */
function calcMACD(closes) {
    if (closes.length < 35) return null;
    const ema12 = calcEMA(closes, 12);
    const ema26 = calcEMA(closes, 26);
    if (!ema12 || !ema26) return null;

    const macdLine = ema12 - ema26;

    // Calculate signal line (9-period EMA of macdLine history)
    const macdHistory = [];
    for (let i = 26; i <= closes.length; i++) {
        const e12 = calcEMA(closes.slice(0, i), 12);
        const e26 = calcEMA(closes.slice(0, i), 26);
        if (e12 && e26) macdHistory.push(e12 - e26);
    }

    const signalLine = macdHistory.length >= 9
        ? calcEMA(macdHistory, 9)
        : macdHistory[macdHistory.length - 1];

    const histogram = macdLine - signalLine;
    const bullishCross = macdLine > signalLine;

    return {
        macdLine: +macdLine.toFixed(4),
        signalLine: +signalLine.toFixed(4),
        histogram: +histogram.toFixed(4),
        bullishCross
    };
}

/**
 * Bollinger Bands (20-period, 2 std dev)
 */
function calcBollingerBands(closes, period = 20) {
    if (closes.length < period) return null;
    const sma = calcSMA(closes, period);
    const slice = closes.slice(-period);
    const variance = slice.reduce((sum, val) => sum + Math.pow(val - sma, 2), 0) / period;
    const stdDev = Math.sqrt(variance);
    return {
        upper: +(sma + 2 * stdDev).toFixed(2),
        middle: +sma.toFixed(2),
        lower: +(sma - 2 * stdDev).toFixed(2)
    };
}

/**
 * Volume Trend: compare today's volume vs 5-day average
 */
function calcVolumeTrend(volumes) {
    if (volumes.length < 6) return null;
    const avg5 = volumes.slice(-6, -1).reduce((a, b) => a + b, 0) / 5;
    const today = volumes[volumes.length - 1];
    const pct = ((today - avg5) / avg5) * 100;
    return {
        today,
        avg5: Math.round(avg5),
        changePercent: +pct.toFixed(1),
        surge: pct > 30,
        dry: pct < -30
    };
}

/**
 * Count how many indicators are bullish/bearish
 */
function buildConsensus(indicators) {
    let bullish = 0;
    let bearish = 0;
    const signals = [];

    // RSI
    if (indicators.rsi !== null) {
        if (indicators.rsi < 30) { bullish++; signals.push(`RSI ${indicators.rsi.toFixed(1)} (Oversold → Bullish)`); }
        else if (indicators.rsi > 70) { bearish++; signals.push(`RSI ${indicators.rsi.toFixed(1)} (Overbought → Bearish)`); }
        else signals.push(`RSI ${indicators.rsi.toFixed(1)} (Neutral)`);
    }

    // MACD
    if (indicators.macd) {
        if (indicators.macd.bullishCross) { bullish++; signals.push(`MACD Bullish Cross (MACD > Signal)`); }
        else { bearish++; signals.push(`MACD Bearish Cross (MACD < Signal)`); }
    }

    // Price vs 20MA
    if (indicators.sma20 && indicators.currentPrice) {
        if (indicators.currentPrice > indicators.sma20) { bullish++; signals.push(`Price above 20-SMA (${indicators.sma20.toFixed(2)})`); }
        else { bearish++; signals.push(`Price below 20-SMA (${indicators.sma20.toFixed(2)})`); }
    }

    // Price vs 50MA
    if (indicators.sma50 && indicators.currentPrice) {
        if (indicators.currentPrice > indicators.sma50) { bullish++; signals.push(`Price above 50-SMA (${indicators.sma50.toFixed(2)})`); }
        else { bearish++; signals.push(`Price below 50-SMA (${indicators.sma50.toFixed(2)})`); }
    }

    // Bollinger Bands position
    if (indicators.bb && indicators.currentPrice) {
        if (indicators.currentPrice <= indicators.bb.lower) { bullish++; signals.push(`Price at Lower Bollinger Band (Oversold)`); }
        else if (indicators.currentPrice >= indicators.bb.upper) { bearish++; signals.push(`Price at Upper Bollinger Band (Overbought)`); }
        else signals.push(`Price within Bollinger Bands (Normal range)`);
    }

    // Volume trend
    if (indicators.volumeTrend) {
        if (indicators.volumeTrend.surge) signals.push(`Volume Surge: +${indicators.volumeTrend.changePercent}% above 5-day avg (confirms move)`);
        else if (indicators.volumeTrend.dry) signals.push(`Low Volume: ${indicators.volumeTrend.changePercent}% below 5-day avg (weak move)`);
        else signals.push(`Normal Volume: ${indicators.volumeTrend.changePercent}% vs 5-day avg`);
    }

    // Today's price change
    if (indicators.todayChange !== undefined) {
        if (indicators.todayChange > 1.5) { bullish++; signals.push(`Strong up day: +${indicators.todayChange.toFixed(2)}%`); }
        else if (indicators.todayChange < -1.5) { bearish++; signals.push(`Strong down day: ${indicators.todayChange.toFixed(2)}%`); }
        else signals.push(`Flat day: ${indicators.todayChange.toFixed(2)}%`);
    }

    const total = bullish + bearish;
    const consensusScore = total > 0 ? Math.round((bullish / total) * 100) : 50;

    let overallBias;
    if (bullish >= 4) overallBias = 'STRONG BULLISH';
    else if (bullish === 3) overallBias = 'BULLISH';
    else if (bearish >= 4) overallBias = 'STRONG BEARISH';
    else if (bearish === 3) overallBias = 'BEARISH';
    else overallBias = 'MIXED/NEUTRAL';

    return { bullish, bearish, total, consensusScore, overallBias, signals };
}

// ════════════════════════════════════════════════════════════
//  STOCK IDENTIFICATION VIA GEMINI
// ════════════════════════════════════════════════════════════

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

// ════════════════════════════════════════════════════════════
//  FETCH INDIAN STOCK (Yahoo Finance — 3 months of history)
// ════════════════════════════════════════════════════════════

async function fetchIndianStock(symbol) {
    const formats = [`${symbol}.NS`, `${symbol}.BO`];

    for (const fmt of formats) {
        try {
            const url = `https://query1.finance.yahoo.com/v8/finance/chart/${fmt}?range=3mo&interval=1d`;
            const response = await axios.get(url, {
                headers: { 'User-Agent': 'Mozilla/5.0' },
                timeout: 12000
            });

            const result = response.data.chart.result[0];
            if (!result) continue;

            const meta = result.meta;
            const timestamps = result.timestamp || [];
            const ohlcv = result.indicators?.quote?.[0] || {};

            const closes = (ohlcv.close || []).filter(Boolean);
            const highs = (ohlcv.high || []).filter(Boolean);
            const lows = (ohlcv.low || []).filter(Boolean);
            const volumes = (ohlcv.volume || []).filter(Boolean);

            if (closes.length < 20) continue; // Need enough data

            const price = meta.regularMarketPrice;
            const prevClose = meta.chartPreviousClose;
            const high = meta.regularMarketDayHigh;
            const low = meta.regularMarketDayLow;
            const volume = meta.regularMarketVolume;
            const change = ((price - prevClose) / prevClose) * 100;

            return {
                price, prevClose, high, low, volume, change, currency: '₹',
                closes, volumes, highs, lows
            };
        } catch (e) {
            continue;
        }
    }

    throw new Error('Symbol not found on NSE/BSE');
}

// ════════════════════════════════════════════════════════════
//  FETCH US STOCK (Alpha Vantage — daily data)
// ════════════════════════════════════════════════════════════

async function fetchUSStock(symbol) {
    if (!process.env.ALPHA_KEY) throw new Error('ALPHA_KEY missing in .env');

    // Fetch current quote
    const quoteRes = await axios.get(
        `https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${symbol}&apikey=${process.env.ALPHA_KEY}`,
        { timeout: 12000 }
    );

    const data = quoteRes.data['Global Quote'];
    if (!data || !data['05. price']) throw new Error('No quote data found');

    const price = parseFloat(data['05. price']);
    const prevClose = parseFloat(data['08. previous close']);
    const high = parseFloat(data['03. high']);
    const low = parseFloat(data['04. low']);
    const volume = parseInt(data['06. volume']);
    const change = parseFloat(data['10. change percent']);

    // Fetch 3 months of daily closes for indicators
    let closes = [], volumes = [], highs = [], lows = [];
    try {
        const histRes = await axios.get(
            `https://www.alphavantage.co/query?function=TIME_SERIES_DAILY&symbol=${symbol}&outputsize=compact&apikey=${process.env.ALPHA_KEY}`,
            { timeout: 12000 }
        );
        const ts = histRes.data['Time Series (Daily)'];
        if (ts) {
            const keys = Object.keys(ts).sort();
            closes = keys.map(k => parseFloat(ts[k]['4. close']));
            volumes = keys.map(k => parseInt(ts[k]['5. volume']));
            highs = keys.map(k => parseFloat(ts[k]['2. high']));
            lows = keys.map(k => parseFloat(ts[k]['3. low']));
        }
    } catch (e) {
        // Historical fetch failed — will skip indicator calculations
    }

    return { price, prevClose, high, low, volume, change, currency: '$', closes, volumes, highs, lows };
}

// ════════════════════════════════════════════════════════════
//  COMPUTE ALL INDICATORS
// ════════════════════════════════════════════════════════════

function computeIndicators(stockData) {
    const { closes, volumes, price, change } = stockData;

    if (!closes || closes.length < 20) {
        return null;
    }

    const allCloses = [...closes, price]; // Include today

    const rsi = calcRSI(allCloses);
    const macd = calcMACD(allCloses);
    const sma20 = calcSMA(allCloses, 20);
    const sma50 = calcSMA(allCloses, 50);
    const bb = calcBollingerBands(allCloses, 20);
    const volumeTrend = volumes && volumes.length >= 6 ? calcVolumeTrend(volumes) : null;

    return {
        rsi: rsi ? +rsi.toFixed(2) : null,
        macd,
        sma20: sma20 ? +sma20.toFixed(2) : null,
        sma50: sma50 ? +sma50.toFixed(2) : null,
        bb,
        volumeTrend,
        currentPrice: price,
        todayChange: change
    };
}

// ════════════════════════════════════════════════════════════
//  ASK GEMINI FOR HIGH-ACCURACY TRADE SIGNAL
// ════════════════════════════════════════════════════════════

async function getAISignal(symbol, companyName, stockData, market, indicators, consensus) {
    const { price, prevClose, high, low, volume, change, currency } = stockData;

    // Only send a directional signal if consensus is strong (4+ of 6 indicators agree)
    const forceHold = consensus.bullish < 4 && consensus.bearish < 4;

    const prompt = `
You are a professional stock market analyst. Analyze the following comprehensive data and give a high-accuracy trading signal.

═══ STOCK INFO ═══
Company: ${companyName} (${symbol})
Market: ${market}
Current Price: ${currency}${price}
Previous Close: ${currency}${prevClose}
Today's Change: ${change.toFixed(2)}%
Day High: ${currency}${high} | Day Low: ${currency}${low}
Volume Today: ${volume.toLocaleString()}

═══ TECHNICAL INDICATORS ═══
RSI (14): ${indicators.rsi !== null ? indicators.rsi : 'N/A'}  ${indicators.rsi < 30 ? '← OVERSOLD' : indicators.rsi > 70 ? '← OVERBOUGHT' : '(neutral zone)'}
MACD Line: ${indicators.macd?.macdLine ?? 'N/A'}
MACD Signal: ${indicators.macd?.signalLine ?? 'N/A'}
MACD Histogram: ${indicators.macd?.histogram ?? 'N/A'}  ${indicators.macd?.bullishCross ? '← BULLISH CROSS' : '← BEARISH CROSS'}
20-Day SMA: ${currency}${indicators.sma20 ?? 'N/A'}  ${indicators.sma20 ? (price > indicators.sma20 ? '← Price ABOVE (bullish)' : '← Price BELOW (bearish)') : ''}
50-Day SMA: ${currency}${indicators.sma50 ?? 'N/A'}  ${indicators.sma50 ? (price > indicators.sma50 ? '← Price ABOVE (bullish)' : '← Price BELOW (bearish)') : ''}
Bollinger Upper: ${currency}${indicators.bb?.upper ?? 'N/A'}
Bollinger Middle: ${currency}${indicators.bb?.middle ?? 'N/A'}
Bollinger Lower: ${currency}${indicators.bb?.lower ?? 'N/A'}  ${indicators.bb ? (price <= indicators.bb.lower ? '← Price at LOWER BAND (oversold)' : price >= indicators.bb.upper ? '← Price at UPPER BAND (overbought)' : '') : ''}
Volume vs 5-Day Avg: ${indicators.volumeTrend ? `${indicators.volumeTrend.changePercent}% ${indicators.volumeTrend.surge ? '← VOLUME SURGE (strong confirmation)' : indicators.volumeTrend.dry ? '← LOW VOLUME (weak signal)' : '(normal)'}` : 'N/A'}

═══ INDICATOR CONSENSUS ═══
Bullish signals: ${consensus.bullish} / ${consensus.total}
Bearish signals: ${consensus.bearish} / ${consensus.total}
Overall Bias: ${consensus.overallBias}
${consensus.signals.map((s, i) => `${i + 1}. ${s}`).join('\n')}

${forceHold ? '⚠️ IMPORTANT: Consensus is mixed (less than 4/6 indicators agree). You MUST respond with SIGNAL: HOLD unless there is an exceptional reason to override this.' : ''}

Based on ALL the above data, provide a professional trading signal.
Only give BUY or SELL if the evidence is overwhelmingly clear (4+ indicators agree).
Otherwise, give HOLD.

Reply in this EXACT format only:
SIGNAL: [BUY/SELL/HOLD]
CONFIDENCE: [High/Medium/Low]
REASON: [2-3 sentences using the technical data above to justify your call]
RISK: [Low/Medium/High]
TARGET: [${currency}price — realistic short-term target based on resistance/support levels]
STOP_LOSS: [${currency}price — recommended stop-loss to manage risk]
TIMEFRAME: [e.g. 3-7 days / 1-2 weeks / Intraday]
`;

    const result = await model.generateContent(prompt);
    return result.response.text();
}

// ════════════════════════════════════════════════════════════
//  PARSE GEMINI SIGNAL RESPONSE
// ════════════════════════════════════════════════════════════

function parseAIResponse(text) {
    const signal = text.match(/SIGNAL:\s*(\w+)/i)?.[1]?.toUpperCase() || 'HOLD';
    const confidence = text.match(/CONFIDENCE:\s*(\w+)/i)?.[1] || 'Low';
    const reason = text.match(/REASON:\s*(.+?)(?=\n[A-Z]+:|$)/is)?.[1]?.trim() || 'No reason provided';
    const risk = text.match(/RISK:\s*(\w+)/i)?.[1] || 'Medium';
    const target = text.match(/TARGET:\s*(.+?)(?=\n[A-Z]+:|$)/is)?.[1]?.trim() || 'N/A';
    const stopLoss = text.match(/STOP_LOSS:\s*(.+?)(?=\n[A-Z]+:|$)/is)?.[1]?.trim() || 'N/A';
    const timeframe = text.match(/TIMEFRAME:\s*(.+?)(?=\n[A-Z]+:|$)/is)?.[1]?.trim() || 'Short-term';
    const emoji = signal === 'BUY' ? '🟢' : signal === 'SELL' ? '🔴' : '⚪';

    return { signal, confidence, reason, risk, target, stopLoss, timeframe, emoji };
}

// ════════════════════════════════════════════════════════════
//  TELEGRAM COMMANDS
// ════════════════════════════════════════════════════════════

bot.onText(/\/start/, (msg) => {
    bot.sendMessage(msg.chat.id,
        `👋 Welcome to <b>MarketMindBot Pro!</b> 🤖\n\n` +
        `🧠 Powered by <b>Google Gemini AI + Technical Analysis</b>\n\n` +
        `This bot uses <b>7 technical indicators</b> to generate high-accuracy signals:\n` +
        `📊 RSI • MACD • 20-SMA • 50-SMA\n` +
        `📉 Bollinger Bands • Volume Trend • Price Action\n\n` +
        `A BUY/SELL is only given when <b>4+ indicators agree.</b>\n` +
        `Otherwise the bot says <b>HOLD</b> — protecting you from noise.\n\n` +
        `Just type any <b>company name or symbol:</b>\n` +
        `• Reliance\n` +
        `• Adani Power\n` +
        `• HDFCBANK\n` +
        `• Apple\n` +
        `• Tesla\n` +
        `• Google\n\n` +
        `<i>⚠️ Disclaimer: AI analysis only — not financial advice.</i>`,
        { parse_mode: 'HTML' }
    );
});

// ════════════════════════════════════════════════════════════
//  MAIN MESSAGE HANDLER
// ════════════════════════════════════════════════════════════

bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text?.trim();

    if (!text || text.startsWith('/')) return;

    try {
        // Step 1: Identify stock
        await bot.sendMessage(chatId,
            `🧠 Identifying <b>${text}</b>...`,
            { parse_mode: 'HTML' }
        );

        const { market, symbol, name } = await identifyStock(text);

        if (market === 'UNKNOWN' || !symbol) {
            await bot.sendMessage(chatId,
                `❌ Could not identify <b>${text}</b> as a stock.\n\nTry: Reliance, Apple, HDFCBANK, Tesla`,
                { parse_mode: 'HTML' }
            );
            return;
        }

        const marketFlag = market === 'INDIA' ? '🇮🇳' : '🇺🇸';
        const marketName = market === 'INDIA' ? 'NSE/BSE' : 'NASDAQ/NYSE';

        await bot.sendMessage(chatId,
            `${marketFlag} Found: <b>${name}</b> (${symbol})\n📡 Fetching 3 months of data + computing indicators...`,
            { parse_mode: 'HTML' }
        );

        // Step 2: Fetch stock data (with history)
        let stockData;
        if (market === 'INDIA') {
            stockData = await fetchIndianStock(symbol);
        } else {
            stockData = await fetchUSStock(symbol);
        }

        // Step 3: Compute technical indicators
        const indicators = computeIndicators(stockData);

        if (!indicators) {
            // Fallback: not enough historical data
            await bot.sendMessage(chatId,
                `⚠️ Not enough historical data for <b>${name}</b>. Try a more actively traded stock.`,
                { parse_mode: 'HTML' }
            );
            return;
        }

        // Step 4: Build consensus score
        const consensus = buildConsensus(indicators);

        await bot.sendMessage(chatId,
            `📐 Indicators computed. ${consensus.bullish}🟢 vs ${consensus.bearish}🔴\n🤖 Asking Gemini AI for signal...`,
            { parse_mode: 'HTML' }
        );

        // Step 5: Get AI signal with all indicator data
        const aiResponse = await getAISignal(symbol, name, stockData, marketName, indicators, consensus);
        const { signal, confidence, reason, risk, target, stopLoss, timeframe, emoji } = parseAIResponse(aiResponse);

        // Step 6: Build indicator summary text
        const indicatorLines = consensus.signals.map(s => `  • ${s}`).join('\n');

        // Step 7: Format signal strength bar
        const filled = consensus.bullish;
        const empty = consensus.bearish;
        const neutral = consensus.total - filled - empty;
        const bar = '🟩'.repeat(filled) + '⬜'.repeat(neutral) + '🟥'.repeat(empty);

        // Helper: escape HTML special characters to prevent Telegram parse errors
        const esc = (str) => String(str ?? 'N/A')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');

        // Step 8: Send full result (HTML mode — safer than Markdown)
        await bot.sendMessage(chatId,
            `📊 <b>${esc(name)} (${esc(symbol)})</b>  ${marketFlag}\n` +
            `━━━━━━━━━━━━━━━━━━━━━\n` +
            `💰 Price: ${esc(stockData.currency)}${esc(stockData.price)}  |  Change: ${stockData.change >= 0 ? '📈' : '📉'} ${stockData.change.toFixed(2)}%\n` +
            `🔺 High: ${esc(stockData.currency)}${esc(stockData.high)}  🔻 Low: ${esc(stockData.currency)}${esc(stockData.low)}\n` +
            `📦 Volume: ${stockData.volume.toLocaleString()}\n\n` +

            `━━━━━━ 📐 INDICATORS ━━━━━━\n` +
            `${consensus.signals.map(s => `  • ${esc(s)}`).join('\n')}\n\n` +

            `📊 Consensus: ${bar}\n` +
            `🟢 Bullish: ${consensus.bullish}  🔴 Bearish: ${consensus.bearish}  Overall: <b>${esc(consensus.overallBias)}</b>\n\n` +

            `━━━━━━ 🤖 AI SIGNAL ━━━━━━\n` +
            `${emoji} <b>Signal: ${esc(signal)}</b>\n` +
            `🎯 Confidence: <b>${esc(confidence)}</b>\n` +
            `⚠️ Risk Level: ${esc(risk)}\n` +
            `🏹 Target Price: ${esc(target)}\n` +
            `🛡️ Stop Loss: ${esc(stopLoss)}\n` +
            `⏰ Timeframe: ${esc(timeframe)}\n\n` +
            `💡 <b>Reason:</b> ${esc(reason)}\n\n` +
            `<i>⚠️ Disclaimer: AI analysis only — not financial advice.</i>`,
            { parse_mode: 'HTML' }
        );

    } catch (err) {
        console.error(`[Error] ${text}:`, err.message);
        await bot.sendMessage(chatId,
            `❌ Error fetching data for <b>${text}</b>.\n\nPossible causes:\n• Symbol not found\n• API rate limit (Alpha Vantage free tier: 25 calls/day)\n• Network timeout\n\nPlease try again in a moment.`,
            { parse_mode: 'HTML' }
        );
    }
});

// ─── Polling Error Handler ────────────────────────────────────
bot.on('polling_error', (err) => {
    console.error('❌ Polling error:', err.message);
});

console.log('🤖 MarketMindBot Pro with Gemini AI + Technical Analysis is running...');
console.log('📊 Indicators: RSI • MACD • SMA20 • SMA50 • Bollinger Bands • Volume Trend');
