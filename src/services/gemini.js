const { GoogleGenerativeAI } = require('@google/generative-ai');
const { GEMINI_API_KEY } = require('../config/env');

const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

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

module.exports = {
    identifyStock,
    getAISignal,
    parseAIResponse
};
