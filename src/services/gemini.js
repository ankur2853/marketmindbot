'use strict';
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { GEMINI_API_KEY } = require('../config/env');
const { isForexInput, normalisePair, FOREX_PAIRS } = require('../api/twelvedata');

const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

// ════════════════════════════════════════════════════════════
//  ASSET IDENTIFICATION VIA GEMINI
// ════════════════════════════════════════════════════════════

async function identifyAsset(input) {
    // ── Fast-path: detect Forex before calling Gemini ────────
    if (isForexInput(input)) {
        const pair = normalisePair(input);
        const info = FOREX_PAIRS[pair];
        return {
            market: 'FOREX',
            symbol: pair,
            name: info ? `${pair} Forex Pair` : `${pair}`,
            pairInfo: info || {}
        };
    }

    // ── Stock identification via Gemini ───────────────────────
    const prompt = `
You are a financial market expert. The user typed: "${input}"

Identify if this is an Indian stock, US stock, or Forex currency pair.

Reply in this EXACT format only, nothing else:
MARKET: [INDIA/US/FOREX/UNKNOWN]
SYMBOL: [exact symbol — stock ticker OR forex pair like EUR/USD]
NAME: [full name]

Rules:
- Indian stocks → NSE symbol (RELIANCE, TCS, ADANIPOWER, HDFCBANK, INFY)
- US stocks → NASDAQ/NYSE symbol (AAPL, TSLA, GOOGL, MSFT, NVDA)
- Forex pairs → standard pair (EUR/USD, GBP/USD, USD/JPY, USD/INR, XAU/USD for Gold)
- If FOREX, SYMBOL must be in format BASE/QUOTE
- If you cannot identify → MARKET: UNKNOWN
`;
    const result = await model.generateContent(prompt);
    const text = result.response.text().trim();

    const market = text.match(/MARKET:\s*(\w+)/i)?.[1]?.toUpperCase() || 'UNKNOWN';
    const rawSym = text.match(/SYMBOL:\s*(\S+)/i)?.[1]?.toUpperCase() || '';
    const symbol = market === 'FOREX'
        ? rawSym.replace(/[^A-Z\/]/g, '')       // Keep slash for forex
        : rawSym.replace(/[^A-Z0-9.&]/g, '');  // Remove slash for stocks
    const name = text.match(/NAME:\s*(.+)/i)?.[1]?.trim() || input;

    return { market, symbol, name };
}

// ════════════════════════════════════════════════════════════
//  MASTER ANALYST — single unified Gemini agent
//  Integrates technicals + sentiment + risk in one prompt
// ════════════════════════════════════════════════════════════

async function runMasterAnalyst(symbol, companyName, stockData, market, indicators, consensus) {
    const { currentPrice: price, prevClose, high, low, volume, change, currency } = stockData;

    const forceHold = consensus.bullish < 4 && consensus.bearish < 4;

    const prompt = `
You are a MASTER MARKET ANALYST — a senior quantitative trader who integrates technical analysis,
sector sentiment, fundamental context, and risk management into ONE decisive, well-reasoned trade call.
You do NOT delegate. You analyse everything yourself and issue the final verdict.

═══ ASSET ═══
${companyName} (${symbol}) | Market: ${market}
Price: ${currency}${price} | Change: ${change.toFixed(2)}% | Prev Close: ${currency}${prevClose}
High: ${currency}${high} | Low: ${currency}${low} | Volume: ${volume.toLocaleString()}

═══ TECHNICAL INDICATORS ═══
RSI (14): ${indicators.rsi ?? 'N/A'} ${indicators.rsi < 30 ? '[OVERSOLD]' : indicators.rsi > 70 ? '[OVERBOUGHT]' : '[NEUTRAL]'}
MACD Line: ${indicators.macd?.macdLine ?? 'N/A'} | Signal: ${indicators.macd?.signalLine ?? 'N/A'} | Histogram: ${indicators.macd?.histogram ?? 'N/A'} | Cross: ${indicators.macd?.bullishCross ? 'BULLISH' : 'BEARISH'}
20-SMA: ${currency}${indicators.sma20 ?? 'N/A'} [Price is ${indicators.sma20 ? (price > indicators.sma20 ? 'ABOVE' : 'BELOW') : 'N/A'}]
50-SMA: ${currency}${indicators.sma50 ?? 'N/A'} [Price is ${indicators.sma50 ? (price > indicators.sma50 ? 'ABOVE' : 'BELOW') : 'N/A'}]
Bollinger: Upper ${currency}${indicators.bb?.upper ?? 'N/A'} | Mid ${currency}${indicators.bb?.middle ?? 'N/A'} | Lower ${currency}${indicators.bb?.lower ?? 'N/A'}
Volume vs 5-day avg: ${indicators.volumeTrend?.changePercent ?? 'N/A'}% ${indicators.volumeTrend?.surge ? '[SURGE]' : indicators.volumeTrend?.dry ? '[DRY]' : '[NORMAL]'}

Quant Consensus: ${consensus.bullish} bullish vs ${consensus.bearish} bearish out of ${consensus.total} signals
${consensus.signals.map((s, i) => '  ' + (i + 1) + '. ' + s).join('\n')}

${forceHold ? 'CAUTION: Less than 4 indicators agree — default to HOLD unless the chart pattern is exceptionally clear.' : ''}

═══ SECTOR & FUNDAMENTAL CONTEXT ═══
Use your deep knowledge of ${companyName}'s business model, sector health, current macro environment,
institutional sentiment, and any known risks or catalysts for ${market === 'NSE/BSE' ? 'Indian' : market === 'Forex' ? 'global currency' : 'US'} markets.

═══ DECISION RULES ═══
1. If ≥4/6 technicals agree AND sector/macro supports → issue strong signal
2. If technicals conflict OR macro cuts against → default to HOLD
3. If only weak alignment → issue signal with Low confidence
4. Always set a realistic stop-loss to protect capital
5. Be conservative: a missed opportunity is better than a loss

Reply in EXACT format, nothing else:
SIGNAL: [BUY/SELL/HOLD]
CONFIDENCE: [High/Medium/Low]
TECHNICAL_SUMMARY: [2 sentences citing specific indicator values and what they tell you]
SECTOR_OUTLOOK: [Bullish/Neutral/Bearish — 1 sentence on the sector right now]
COMPANY_STRENGTH: [Strong/Moderate/Weak — 1 sentence on the company's position]
MARKET_MOOD: [Risk-On/Neutral/Risk-Off]
KEY_RISK: [1 sentence — the single biggest risk factor for this trade right now]
REASON: [2-3 sentences synthesising technicals + sector + macro into your final call]
TARGET: [${currency}price]
STOP_LOSS: [${currency}price]
TIMEFRAME: [e.g. 3-7 days / 1-2 weeks / Intraday]
RISK_LEVEL: [Low/Medium/High]
`;

    const result = await model.generateContent(prompt);
    const text = result.response.text().trim();

    return {
        signal:           text.match(/SIGNAL:\s*(\w+)/i)?.[1]?.toUpperCase() || 'HOLD',
        confidence:       text.match(/CONFIDENCE:\s*(\w+)/i)?.[1] || 'Low',
        technicalSummary: text.match(/TECHNICAL_SUMMARY:\s*(.+?)(?=\n[A-Z_]+:|$)/is)?.[1]?.trim() || 'N/A',
        sectorOutlook:    text.match(/SECTOR_OUTLOOK:\s*(.+?)(?=\n[A-Z_]+:|$)/is)?.[1]?.trim() || 'N/A',
        companyStrength:  text.match(/COMPANY_STRENGTH:\s*(.+?)(?=\n[A-Z_]+:|$)/is)?.[1]?.trim() || 'N/A',
        marketMood:       text.match(/MARKET_MOOD:\s*(.+?)(?=\n[A-Z_]+:|$)/is)?.[1]?.trim() || 'N/A',
        keyRisk:          text.match(/KEY_RISK:\s*(.+?)(?=\n[A-Z_]+:|$)/is)?.[1]?.trim() || 'N/A',
        reason:           text.match(/REASON:\s*(.+?)(?=\n[A-Z_]+:|$)/is)?.[1]?.trim() || 'No reason',
        target:           text.match(/TARGET:\s*(.+?)(?=\n[A-Z_]+:|$)/is)?.[1]?.trim() || 'N/A',
        stopLoss:         text.match(/STOP_LOSS:\s*(.+?)(?=\n[A-Z_]+:|$)/is)?.[1]?.trim() || 'N/A',
        timeframe:        text.match(/TIMEFRAME:\s*(.+?)(?=\n[A-Z_]+:|$)/is)?.[1]?.trim() || 'Short-term',
        riskLevel:        text.match(/RISK_LEVEL:\s*(\w+)/i)?.[1] || 'Medium',
    };
}

module.exports = {
    identifyAsset,
    runMasterAnalyst,
};
