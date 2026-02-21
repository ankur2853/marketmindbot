const bot = require('./instance');
const { fetchIndianStock } = require('../api/yahoo');
const { fetchUSStock } = require('../api/alphavantage');
const { computeIndicators, buildConsensus } = require('../services/indicators');
const { identifyStock, getAISignal, parseAIResponse } = require('../services/gemini');

// Helper: escape HTML special characters to prevent Telegram parse errors
const esc = (str) => String(str ?? 'N/A')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

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

module.exports = bot;
