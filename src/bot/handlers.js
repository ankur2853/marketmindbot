const bot = require('./instance');
const { fetchIndianStock } = require('../api/yahoo');
const { fetchUSStock, fetchForex } = require('../api/twelvedata');
const { runEngine, formatResultForTelegram } = require('../services/tradingEngine');
const { identifyAsset, runMasterAnalyst } = require('../services/gemini');

const esc = (str) => String(str ?? 'N/A')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

const sigEmoji = (s) => s === 'BUY' ? '🟢' : s === 'SELL' ? '🔴' : '⚪';

bot.onText(/\/start/, (msg) => {
    bot.sendMessage(msg.chat.id,
        `👋 Welcome to <b>MarketMindBot Pro!</b> 🤖\n\n` +
        `🧠 Powered by <b>1 Master Gemini AI Analyst + 8-Gate Quant Engine</b>\n\n` +
        `<b>Supports 3 asset types:</b>\n` +
        `🇮🇳 Indian Stocks (NSE/BSE)\n` +
        `🇺🇸 US Stocks (NASDAQ/NYSE)\n` +
        `💱 Forex Pairs (all majors + USD/INR + Gold)\n\n` +
        `<b>How it works:</b>\n` +
        `⚙️ <b>8-Gate Quant Engine</b> — regime detection, probability scoring,\n` +
        `  price action gate, volume filter, ATR risk/reward\n` +
        `🤖 <b>Master AI Analyst</b> — technicals + sector sentiment + risk management\n` +
        `  all synthesised in one decisive, holistic trade call\n\n` +
        `<b>Just type anything:</b>\n` +
        `📊 <i>Stocks:</i>  Reliance  |  HDFCBANK  |  Apple  |  Tesla\n` +
        `💱 <i>Forex:</i>   EUR/USD  |  USD/INR  |  GBP/USD  |  Gold\n\n` +
        `<i>⚠️ Disclaimer: AI + quant analysis only — not financial advice.</i>`,
        { parse_mode: 'HTML' }
    );
});

bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text?.trim();

    if (!text || text.startsWith('/')) return;

    try {
        await bot.sendMessage(chatId, `🧠 Identifying <b>${esc(text)}</b>...`, { parse_mode: 'HTML' });

        const { market, symbol, name, pairInfo } = await identifyAsset(text);

        if (market === 'UNKNOWN' || !symbol) {
            await bot.sendMessage(chatId,
                `❌ Could not identify <b>${esc(text)}</b>.\n\n` +
                `Try stocks: Reliance, Apple, Tesla, HDFCBANK\n` +
                `Try forex:  EUR/USD, GBP/USD, USD/INR, Gold`,
                { parse_mode: 'HTML' });
            return;
        }

        const isForex = market === 'FOREX';
        const marketFlag = isForex
            ? (pairInfo?.emoji || '💱')
            : market === 'INDIA' ? '🇮🇳' : '🇺🇸';
        const marketName = isForex
            ? 'Forex'
            : market === 'INDIA' ? 'NSE/BSE' : 'NASDAQ/NYSE';

        await bot.sendMessage(chatId,
            `${marketFlag} Found: <b>${esc(name)}</b>\n` +
            `📡 Fetching 90 days of ${isForex ? 'Forex' : 'price'} data...`,
            { parse_mode: 'HTML' });

        let rawData;

        if (isForex) {
            rawData = await fetchForex(symbol);
            rawData.currentPrice = rawData.price;
        } else if (market === 'INDIA') {
            rawData = await fetchIndianStock(symbol);
        } else {
            rawData = await fetchUSStock(symbol);
            rawData.currentPrice = rawData.price;
        }

        await bot.sendMessage(chatId, `📡 Data fetched. Running 8-gate quant engine...`, { parse_mode: 'HTML' });
        const engineResult = runEngine(rawData);

        if (engineResult.signal === 'NO-TRADE') {
            await bot.sendMessage(chatId, formatResultForTelegram(engineResult, name, symbol, marketFlag), { parse_mode: 'HTML' });
            return;
        }

        const engineSummary = `Engine prob: ${engineResult.probability}% | Regime: ${engineResult.regime} | Engine bias: ${engineResult.signal}`;
        const fakeConsensus = {
            signals: [engineSummary],
            bullish: engineResult.probability > 50 ? 1 : 0,
            bearish: engineResult.probability <= 50 ? 1 : 0,
            total: 1,
            overallBias: engineResult.signal
        };

        await bot.sendMessage(chatId,
            `⚙️ Engine: ${engineResult.probability}% | Regime: ${engineResult.regime}\n🤖 Running Master AI Analyst...`,
            { parse_mode: 'HTML' });

        const analyst = await runMasterAnalyst(symbol, name, rawData, marketName, engineResult.indicators || {}, fakeConsensus);

        const rr = engineResult.riskReward;
        const finalEmoji = sigEmoji(analyst.signal);
        const filled = Math.round((engineResult.probability || 0) / 10);
        const probBar = '█'.repeat(filled) + '░'.repeat(10 - filled);

        await bot.sendMessage(chatId,
            `📊 <b>${esc(name)} (${esc(symbol)})</b>  ${marketFlag}\n` +
            `━━━━━━━━━━━━━━━━━━━\n` +
            `💰 Price: ${esc(rawData.currency)}${esc(rawData.currentPrice)}  ${Number(rawData.change) >= 0 ? '📈' : '📉'} ${Number(rawData.change).toFixed(rawData.isForex ? 4 : 2)}%${rawData.isForex && rawData.pipValue !== undefined ? '  |  Pips: ' + rawData.pipValue : ''}\n` +
            `🔺 H: ${esc(rawData.currency)}${esc(rawData.high)}  🔻 L: ${esc(rawData.currency)}${esc(rawData.low)}  📦 ${Number(rawData.volume).toLocaleString()}\n\n` +

            `━━━━ ⚙️ QUANT ENGINE ━━━━\n` +
            `📊 Probability: ${probBar} ${engineResult.probability}%\n` +
            `📈 Regime: <b>${esc(engineResult.regime)}</b> ${esc(engineResult.regimeDetails?.direction || '')}\n` +
            `🕯️ Pattern: ${esc((engineResult.priceAction?.patternsFound || []).map(p => p.name).join(', ') || 'None detected')}\n` +
            `📦 Volume: ${esc(engineResult.volume?.ratio || 'N/A')}× of 5-day avg\n` +
            (rr ? `💱 Entry: ${esc(rr.entry)} | SL: ${esc(rr.stopLoss)} | TP: ${esc(rr.target)} | R:R 1:${esc(rr.riskReward)}\n` : '') +

            `\n━━━━ 🤖 MASTER ANALYST ━━━━\n` +
            `📐 <b>Technicals:</b> ${esc(analyst.technicalSummary)}\n` +
            `🌐 <b>Sector:</b> ${esc(analyst.sectorOutlook)} | Mood: ${esc(analyst.marketMood)}\n` +
            `🏢 <b>Company:</b> ${esc(analyst.companyStrength)}\n` +
            `⚡ <b>Key Risk:</b> ${esc(analyst.keyRisk)}\n\n` +

            `━━━━ 🛡️ FINAL VERDICT ━━━━\n` +
            `${finalEmoji} <b>SIGNAL: ${esc(analyst.signal)}</b>\n` +
            `🎯 Confidence: <b>${esc(analyst.confidence)}</b> | Risk: ${esc(analyst.riskLevel)} | ⏰ ${esc(analyst.timeframe)}\n` +
            `🏹 Target: ${esc(analyst.target)} | 🛡️ SL: ${esc(analyst.stopLoss)}\n\n` +
            `💡 <b>Reason:</b> ${esc(analyst.reason)}\n` +
            `\n<i>⚠️ Disclaimer: AI + quant analysis only — not financial advice.</i>`,
            { parse_mode: 'HTML' }
        );

    } catch (err) {
        console.error(`[Error] ${text}:`, err);
        await bot.sendMessage(chatId,
            `❌ Error for <b>${esc(text)}</b>.\n\n` +
            `🚨 <b>System Error Log:</b>\n` +
            `<code>${esc(err.message)}</code>\n\n` +
            `Possible causes:\n` +
            `• Symbol not found\n` +
            `• API Limit Reached (Twelve Data: 8/min or Gemini rate limit)\n` +
            `• Network timeout\n\n` +
            `Please try again in a moment.`,
            { parse_mode: 'HTML' }
        );
    }
});

module.exports = bot;
