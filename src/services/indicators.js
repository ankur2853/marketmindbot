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

module.exports = {
    computeIndicators,
    buildConsensus
};
