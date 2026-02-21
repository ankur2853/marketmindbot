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
//  AGENT 1 — TECHNICAL ANALYST
//  Reads raw indicator data, gives first signal
// ════════════════════════════════════════════════════════════

async function agent1_TechnicalAnalyst(symbol, companyName, stockData, market, indicators, consensus) {
    const { currentPrice: price, prevClose, high, low, volume, change, currency } = stockData;
    const forceHold = consensus.bullish < 4 && consensus.bearish < 4;

    const prompt = `
You are Agent 1: a PURE TECHNICAL ANALYST. Your job is to analyze ONLY price action and technical indicators.
Do NOT consider news, sentiment, or fundamentals. Only the numbers.

═══ STOCK ═══
${companyName} (${symbol}) | Market: ${market}
Price: ${currency}${price} | Change: ${change.toFixed(2)}% | Prev Close: ${currency}${prevClose}
High: ${currency}${high} | Low: ${currency}${low} | Volume: ${volume.toLocaleString()}

═══ INDICATORS ═══
RSI (14): ${indicators.rsi ?? 'N/A'} ${indicators.rsi < 30 ? '[OVERSOLD]' : indicators.rsi > 70 ? '[OVERBOUGHT]' : '[NEUTRAL]'}
MACD Line: ${indicators.macd?.macdLine ?? 'N/A'} | Signal: ${indicators.macd?.signalLine ?? 'N/A'} | Histogram: ${indicators.macd?.histogram ?? 'N/A'} | Cross: ${indicators.macd?.bullishCross ? 'BULLISH' : 'BEARISH'}
20-SMA: ${currency}${indicators.sma20 ?? 'N/A'} [Price is ${indicators.sma20 ? (price > indicators.sma20 ? 'ABOVE' : 'BELOW') : 'N/A'}]
50-SMA: ${currency}${indicators.sma50 ?? 'N/A'} [Price is ${indicators.sma50 ? (price > indicators.sma50 ? 'ABOVE' : 'BELOW') : 'N/A'}]
Bollinger: Upper ${currency}${indicators.bb?.upper ?? 'N/A'} | Mid ${currency}${indicators.bb?.middle ?? 'N/A'} | Lower ${currency}${indicators.bb?.lower ?? 'N/A'}
Volume vs 5-day avg: ${indicators.volumeTrend?.changePercent ?? 'N/A'}% ${indicators.volumeTrend?.surge ? '[SURGE]' : indicators.volumeTrend?.dry ? '[DRY]' : '[NORMAL]'}

Indicator Consensus: ${consensus.bullish} bullish vs ${consensus.bearish} bearish out of ${consensus.total} total
${consensus.signals.map((s, i) => '  ' + (i + 1) + '. ' + s).join('\n')}

${forceHold ? 'IMPORTANT: Less than 4/6 indicators agree. Default to HOLD unless chart pattern is exceptionally clear.' : ''}

Provide your technical-only analysis. Reply in EXACT format:
SIGNAL: [BUY/SELL/HOLD]
CONFIDENCE: [High/Medium/Low]
REASON: [2 sentences — cite specific indicator values]
TARGET: [${currency}price]
STOP_LOSS: [${currency}price]
`;

    const result = await model.generateContent(prompt);
    const text = result.response.text().trim();
    return {
        agentName: 'Technical Analyst',
        agentEmoji: '📐',
        signal: text.match(/SIGNAL:\s*(\w+)/i)?.[1]?.toUpperCase() || 'HOLD',
        confidence: text.match(/CONFIDENCE:\s*(\w+)/i)?.[1] || 'Low',
        reason: text.match(/REASON:\s*(.+?)(?=\n[A-Z_]+:|$)/is)?.[1]?.trim() || 'No reason',
        target: text.match(/TARGET:\s*(.+?)(?=\n[A-Z_]+:|$)/is)?.[1]?.trim() || 'N/A',
        stopLoss: text.match(/STOP_LOSS:\s*(.+?)(?=\n[A-Z_]+:|$)/is)?.[1]?.trim() || 'N/A',
    };
}

// ════════════════════════════════════════════════════════════
//  AGENT 2 — SENTIMENT & FUNDAMENTAL ANALYST
//  Reads company/sector context, gives second signal
// ════════════════════════════════════════════════════════════

async function agent2_SentimentAnalyst(symbol, companyName, stockData, market) {
    const { currentPrice: price, change, currency, volume } = stockData;

    const prompt = `
You are Agent 2: a SENTIMENT and FUNDAMENTAL ANALYST. Your job is to evaluate the broader context of this stock.
Use your knowledge of: company business model, sector health, market conditions, typical valuation, and any known risks.

═══ STOCK ═══
${companyName} (${symbol}) | Market: ${market}
Current Price: ${currency}${price} | Today's Move: ${change.toFixed(2)}%
Volume: ${volume.toLocaleString()}

Your tasks:
1. Assess the company's sector strength (is the sector hot or struggling right now?)
2. Assess the company's fundamental position (is this company a market leader, under pressure, growing?)
3. Assess the overall market sentiment for ${market === 'NSE/BSE' ? 'Indian' : 'US'} equities currently
4. Based on context, is this stock likely to be attractive to buyers or sellers right now?

Reply in EXACT format:
SIGNAL: [BUY/SELL/HOLD]
CONFIDENCE: [High/Medium/Low]
SECTOR_OUTLOOK: [Bullish/Neutral/Bearish — 1 sentence on sector]
COMPANY_STRENGTH: [Strong/Moderate/Weak — 1 sentence on company]
MARKET_MOOD: [Risk-On/Neutral/Risk-Off]
REASON: [2 sentences combining sector + company + macro to justify your signal]
KEY_RISK: [1 sentence — biggest risk factor for this stock right now]
`;

    const result = await model.generateContent(prompt);
    const text = result.response.text().trim();
    return {
        agentName: 'Sentiment Analyst',
        agentEmoji: '🌐',
        signal: text.match(/SIGNAL:\s*(\w+)/i)?.[1]?.toUpperCase() || 'HOLD',
        confidence: text.match(/CONFIDENCE:\s*(\w+)/i)?.[1] || 'Low',
        reason: text.match(/REASON:\s*(.+?)(?=\n[A-Z_]+:|$)/is)?.[1]?.trim() || 'No reason',
        sectorOutlook: text.match(/SECTOR_OUTLOOK:\s*(.+?)(?=\n[A-Z_]+:|$)/is)?.[1]?.trim() || 'N/A',
        companyStrength: text.match(/COMPANY_STRENGTH:\s*(.+?)(?=\n[A-Z_]+:|$)/is)?.[1]?.trim() || 'N/A',
        marketMood: text.match(/MARKET_MOOD:\s*(.+?)(?=\n[A-Z_]+:|$)/is)?.[1]?.trim() || 'N/A',
        keyRisk: text.match(/KEY_RISK:\s*(.+?)(?=\n[A-Z_]+:|$)/is)?.[1]?.trim() || 'N/A',
    };
}

// ════════════════════════════════════════════════════════════
//  AGENT 3 — RISK MANAGER (FINAL ARBITER)
//  Reads Agent 1 + Agent 2 outputs, challenges them,
//  and delivers the final trade decision
// ════════════════════════════════════════════════════════════

async function agent3_RiskManager(symbol, companyName, stockData, market, agent1, agent2, consensus) {
    const { currentPrice: price, currency } = stockData;

    const agreementStatus = agent1.signal === agent2.signal
        ? `BOTH AGENTS AGREE: ${agent1.signal}`
        : `AGENTS DISAGREE: Technical=${agent1.signal}, Sentiment=${agent2.signal}`;

    const prompt = `
You are Agent 3: the RISK MANAGER and FINAL DECISION MAKER.
Two specialist agents have analyzed ${companyName} (${symbol}) and you must review their work, challenge weak reasoning, and issue the final trading signal.

═══ AGENT 1 REPORT (Technical Analyst) ═══
Signal: ${agent1.signal} | Confidence: ${agent1.confidence}
Reason: ${agent1.reason}
Target: ${agent1.target} | Stop Loss: ${agent1.stopLoss}
Indicator Consensus: ${consensus.bullish} bullish vs ${consensus.bearish} bearish

═══ AGENT 2 REPORT (Sentiment Analyst) ═══
Signal: ${agent2.signal} | Confidence: ${agent2.confidence}
Reason: ${agent2.reason}
Sector: ${agent2.sectorOutlook} | Company: ${agent2.companyStrength} | Market Mood: ${agent2.marketMood}
Key Risk: ${agent2.keyRisk}

═══ CURRENT STATUS ═══
${agreementStatus}
Price: ${currency}${price}

Your rules:
- If both agents agree with High/Medium confidence → follow their signal
- If agents disagree → issue HOLD (conflicting evidence is too risky)
- If one agent is Low confidence → reduce overall confidence and lean toward HOLD
- Always set a realistic stop-loss to protect capital
- Be conservative: a missed opportunity is better than a loss

Reply in EXACT format:
FINAL_SIGNAL: [BUY/SELL/HOLD]
FINAL_CONFIDENCE: [High/Medium/Low]
AGREEMENT: [Agents Agree/Agents Disagree/Partial]
FINAL_REASON: [2-3 sentences — synthesize both agents, explain your final call]
FINAL_TARGET: [${currency}price]
FINAL_STOP_LOSS: [${currency}price]
TIMEFRAME: [e.g. 3-7 days / 1-2 weeks / Intraday]
RISK_LEVEL: [Low/Medium/High]
OVERRIDE_NOTE: [If you overrode an agent's call, explain why. Otherwise write "None"]
`;

    const result = await model.generateContent(prompt);
    const text = result.response.text().trim();
    return {
        signal: text.match(/FINAL_SIGNAL:\s*(\w+)/i)?.[1]?.toUpperCase() || 'HOLD',
        confidence: text.match(/FINAL_CONFIDENCE:\s*(\w+)/i)?.[1] || 'Low',
        agreement: text.match(/AGREEMENT:\s*(.+?)(?=\n[A-Z_]+:|$)/is)?.[1]?.trim() || 'Unknown',
        reason: text.match(/FINAL_REASON:\s*(.+?)(?=\n[A-Z_]+:|$)/is)?.[1]?.trim() || 'No reason',
        target: text.match(/FINAL_TARGET:\s*(.+?)(?=\n[A-Z_]+:|$)/is)?.[1]?.trim() || 'N/A',
        stopLoss: text.match(/FINAL_STOP_LOSS:\s*(.+?)(?=\n[A-Z_]+:|$)/is)?.[1]?.trim() || 'N/A',
        timeframe: text.match(/TIMEFRAME:\s*(.+?)(?=\n[A-Z_]+:|$)/is)?.[1]?.trim() || 'Short-term',
        riskLevel: text.match(/RISK_LEVEL:\s*(\w+)/i)?.[1] || 'Medium',
        overrideNote: text.match(/OVERRIDE_NOTE:\s*(.+?)(?=\n[A-Z_]+:|$)/is)?.[1]?.trim() || 'None',
    };
}

// ════════════════════════════════════════════════════════════
//  MULTI-AGENT ORCHESTRATOR
//  Runs all 3 agents in optimal order
// ════════════════════════════════════════════════════════════

async function runMultiAgentAnalysis(symbol, companyName, stockData, market, indicators, consensus) {
    const [agent1Result, agent2Result] = await Promise.all([
        agent1_TechnicalAnalyst(symbol, companyName, stockData, market, indicators, consensus),
        agent2_SentimentAnalyst(symbol, companyName, stockData, market)
    ]);

    const agent3Result = await agent3_RiskManager(
        symbol, companyName, stockData, market,
        agent1Result, agent2Result, consensus
    );

    return { agent1: agent1Result, agent2: agent2Result, final: agent3Result };
}

module.exports = {
    identifyAsset,
    agent1_TechnicalAnalyst,
    agent2_SentimentAnalyst,
    agent3_RiskManager,
    runMultiAgentAnalysis
};
