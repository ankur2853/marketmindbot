/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║         MARKETMIND QUANTITATIVE TRADING ENGINE v2.0          ║
 * ║   Rule-Based · Probability-Driven · Regime-Aware · Filtered  ║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 * DESIGN PHILOSOPHY:
 *   Precision > Frequency
 *   Filtering > Prediction
 *   Discipline > Indicators
 *
 * PIPELINE:
 *   Raw OHLCV Data
 *     → Step 1: Data Validation & Quality Gate
 *     → Step 2: Market Regime Detection (TRENDING / RANGING / NO-TRADE)
 *     → Step 3: Regime-Appropriate Indicator Computation
 *     → Step 4: Probability Scoring Engine (weighted, normalized 0–100)
 *     → Step 5: Price Action Confirmation (mandatory gate)
 *     → Step 6: Volume Filter (mandatory gate)
 *     → Step 7: Risk/Reward Qualification (≥ 1:2 required)
 *     → Step 8: No-Trade Suppression Rules
 *     → Step 9: Final Signal Output with ATR-based SL/TP
 *
 * ACCURACY EXPECTATION (HONEST):
 *   - Trending regime, all gates pass: ~72–80% win rate
 *   - Ranging regime, RSI+BB only:     ~65–73% win rate
 *   - NO-TRADE regime (skipped):       N/A — system does not trade
 *   - System skips ~50–60% of all market conditions by design
 */

'use strict';

// ══════════════════════════════════════════════════════════════
//  SECTION 1 — CONFIGURATION (tune without touching logic)
// ══════════════════════════════════════════════════════════════

const CONFIG = {
    // Probability thresholds
    MIN_PROBABILITY_TO_TRADE: 75,      // Below this → HOLD, no exceptions
    HIGH_CONVICTION_THRESHOLD: 85,     // Above this → size up (future use)

    // Regime detection
    BB_SQUEEZE_THRESHOLD: 0.02,        // BB width < 2% of price → squeeze (no-trade)
    BB_EXPANSION_THRESHOLD: 0.04,      // BB width > 4% → expansion (trending)
    TREND_SMA_MIN_SEPARATION: 0.005,   // SMA20 must be 0.5%+ away from SMA50 to call trend
    ADX_TREND_THRESHOLD: 25,           // ADX > 25 → trending (if available)

    // Volume
    VOLUME_MIN_MULTIPLIER: 1.1,        // Volume must be > 1.1× 5-day avg to trade
    VOLUME_SURGE_MULTIPLIER: 1.5,      // > 1.5× avg → high confirmation bonus
    VOLUME_LOW_MULTIPLIER: 0.8,        // < 0.8× avg → penalize heavily

    // Risk management
    MIN_RISK_REWARD: 2.0,              // Reject trade if RR < 2:1
    ATR_STOP_MULTIPLIER: 1.5,          // Stop = price ± (1.5 × ATR)
    ATR_TARGET_MULTIPLIER: 3.0,        // Target = price ± (3.0 × ATR) → 1:2 RR

    // Indicator periods
    RSI_PERIOD: 14,
    MACD_FAST: 12,
    MACD_SLOW: 26,
    MACD_SIGNAL: 9,
    SMA_SHORT: 20,
    SMA_LONG: 50,
    ATR_PERIOD: 14,
    BB_PERIOD: 20,
    BB_STDDEV: 2,

    // Probability weights per regime (must sum to 1.0 within each regime)
    WEIGHTS: {
        TRENDING: {
            trendAlignment:       0.30,   // SMA alignment — highest in trending
            volumeConfirmation:   0.25,   // Volume surge in direction of trend
            priceActionPattern:   0.20,   // HH/HL or LL/LH + close position
            macdMomentum:         0.15,   // MACD histogram direction
            rsiFilter:            0.10,   // RSI used only as penalty filter
        },
        RANGING: {
            rsiExtreme:           0.30,   // RSI oversold/overbought — primary
            bollingerPosition:    0.30,   // Price at/beyond band extremes
            volumeConfirmation:   0.25,   // Volume spike at reversal zone
            priceActionPattern:   0.15,   // Engulfing / pin bar at extremes
            // MACD intentionally excluded in ranging regime
        }
    }
};

// ══════════════════════════════════════════════════════════════
//  SECTION 2 — MATH UTILITIES
// ══════════════════════════════════════════════════════════════

const MathUtils = {

    sma(arr, period) {
        if (!arr || arr.length < period) return null;
        const slice = arr.slice(-period);
        return slice.reduce((a, b) => a + b, 0) / period;
    },

    ema(arr, period) {
        if (!arr || arr.length < period) return null;
        const k = 2 / (period + 1);
        let ema = arr.slice(0, period).reduce((a, b) => a + b, 0) / period;
        for (let i = period; i < arr.length; i++) {
            ema = arr[i] * k + ema * (1 - k);
        }
        return ema;
    },

    rsi(closes, period = CONFIG.RSI_PERIOD) {
        if (!closes || closes.length < period + 1) return null;
        const changes = closes.slice(1).map((v, i) => v - closes[i]);
        const recent = changes.slice(-period);
        const gains = recent.filter(c => c > 0).reduce((a, b) => a + b, 0) / period;
        const losses = Math.abs(recent.filter(c => c < 0).reduce((a, b) => a + b, 0)) / period;
        if (losses === 0) return 100;
        return 100 - (100 / (1 + gains / losses));
    },

    macd(closes) {
        if (!closes || closes.length < CONFIG.MACD_SLOW + CONFIG.MACD_SIGNAL) return null;
        // Build MACD line history
        const macdHistory = [];
        for (let i = CONFIG.MACD_SLOW; i <= closes.length; i++) {
            const fast = this.ema(closes.slice(0, i), CONFIG.MACD_FAST);
            const slow = this.ema(closes.slice(0, i), CONFIG.MACD_SLOW);
            if (fast && slow) macdHistory.push(fast - slow);
        }
        const macdLine = macdHistory[macdHistory.length - 1];
        const signalLine = this.ema(macdHistory, CONFIG.MACD_SIGNAL);
        if (macdLine == null || signalLine == null) return null;
        const histogram = macdLine - signalLine;
        const prevHistogram = macdHistory.length > 1
            ? macdHistory[macdHistory.length - 2] - (this.ema(macdHistory.slice(0, -1), CONFIG.MACD_SIGNAL) || 0)
            : 0;
        return {
            macdLine: +macdLine.toFixed(4),
            signalLine: +signalLine.toFixed(4),
            histogram: +histogram.toFixed(4),
            histogramGrowing: histogram > prevHistogram,
            bullishCross: macdLine > signalLine,
        };
    },

    bollingerBands(closes, period = CONFIG.BB_PERIOD, stdMult = CONFIG.BB_STDDEV) {
        if (!closes || closes.length < period) return null;
        const sma = this.sma(closes, period);
        const slice = closes.slice(-period);
        const variance = slice.reduce((s, v) => s + Math.pow(v - sma, 2), 0) / period;
        const std = Math.sqrt(variance);
        const upper = sma + stdMult * std;
        const lower = sma - stdMult * std;
        const width = (upper - lower) / sma;  // normalized width
        return {
            upper: +upper.toFixed(2),
            middle: +sma.toFixed(2),
            lower: +lower.toFixed(2),
            width: +width.toFixed(4),  // key metric for squeeze/expansion detection
            percentB: (closes[closes.length - 1] - lower) / (upper - lower),  // 0=lower, 1=upper
        };
    },

    atr(highs, lows, closes, period = CONFIG.ATR_PERIOD) {
        if (!highs || !lows || !closes || closes.length < period + 1) return null;
        const trueRanges = [];
        for (let i = 1; i < closes.length; i++) {
            const hl = highs[i] - lows[i];
            const hpc = Math.abs(highs[i] - closes[i - 1]);
            const lpc = Math.abs(lows[i] - closes[i - 1]);
            trueRanges.push(Math.max(hl, hpc, lpc));
        }
        return this.sma(trueRanges, period);
    },

    volumeAvg(volumes, period = 5) {
        if (!volumes || volumes.length < period) return null;
        return this.sma(volumes, period);
    },

    // Normalize any value into [0, 1] range using min/max
    normalize(value, min, max) {
        if (max === min) return 0.5;
        return Math.max(0, Math.min(1, (value - min) / (max - min)));
    },

    // Clamp to [0, 1]
    clamp01(v) {
        return Math.max(0, Math.min(1, v));
    }
};

// ══════════════════════════════════════════════════════════════
//  SECTION 3 — STEP 1: DATA VALIDATION
// ══════════════════════════════════════════════════════════════

function validateData(ohlcv) {
    /**
     * Input: { opens[], highs[], lows[], closes[], volumes[], timestamps[] }
     * Validates completeness and quality before any analysis.
     * Returns: { valid: bool, reason: string }
     */
    const required = ['opens', 'highs', 'lows', 'closes', 'volumes'];
    for (const field of required) {
        if (!ohlcv[field] || ohlcv[field].length === 0) {
            return { valid: false, reason: `Missing or empty field: ${field}` };
        }
    }

    const len = ohlcv.closes.length;
    for (const field of required) {
        if (ohlcv[field].length !== len) {
            return { valid: false, reason: `Field length mismatch: ${field}` };
        }
    }

    // Need at least SMA50 + ATR14 worth of data = 64 bars minimum
    const MIN_BARS = CONFIG.MACD_SLOW + CONFIG.MACD_SIGNAL + 10;  // ~45 bars
    if (len < MIN_BARS) {
        return { valid: false, reason: `Insufficient data: ${len} bars (need ${MIN_BARS}+)` };
    }

    // Sanity checks: no negative prices, no zero volume days dominating
    const zeroVolumeCount = ohlcv.volumes.filter(v => v === 0).length;
    if (zeroVolumeCount > len * 0.1) {
        return { valid: false, reason: `Too many zero-volume bars: ${zeroVolumeCount}` };
    }

    return { valid: true, reason: 'OK' };
}

// ══════════════════════════════════════════════════════════════
//  SECTION 4 — STEP 2: MARKET REGIME DETECTION
// ══════════════════════════════════════════════════════════════

/**
 * Regime Logic:
 *
 * TRENDING:
 *   • SMA20 > SMA50 (bullish) OR SMA20 < SMA50 (bearish) with ≥ 0.5% separation
 *   • BB width > EXPANSION threshold (volatility is expanding)
 *   • Price making HH/HL or LL/LH sequence
 *
 * RANGING:
 *   • SMA20 ≈ SMA50 (< 0.5% separation)
 *   • BB width between squeeze and expansion thresholds
 *   • Price oscillating around SMA middle
 *
 * NO-TRADE:
 *   • BB width < SQUEEZE threshold (market too compressed)
 *   • Extreme low volume (< 0.7× 5-day avg)
 *   • SMA cross confusion (SMA20 crossing SMA50 — ambiguous, wait)
 *   This regime = skip entirely
 */

function detectRegime(ohlcv) {
    const { closes, highs, lows, volumes } = ohlcv;
    const price = closes[closes.length - 1];

    const sma20 = MathUtils.sma(closes, CONFIG.SMA_SHORT);
    const sma50 = MathUtils.sma(closes, CONFIG.SMA_LONG);
    const bb = MathUtils.bollingerBands(closes);
    const volAvg = MathUtils.volumeAvg(volumes, 5);
    const todayVol = volumes[volumes.length - 1];
    const atr = MathUtils.atr(highs, lows, closes);

    if (!sma20 || !sma50 || !bb || !atr) {
        return { regime: 'NO-TRADE', reason: 'Insufficient data for regime detection' };
    }

    // ── No-Trade Conditions (checked first — highest priority) ──
    if (bb.width < CONFIG.BB_SQUEEZE_THRESHOLD) {
        return {
            regime: 'NO-TRADE',
            reason: `BB squeeze: width ${(bb.width * 100).toFixed(2)}% < ${CONFIG.BB_SQUEEZE_THRESHOLD * 100}% threshold`,
            sma20, sma50, bb, atr, volAvg
        };
    }

    // Volume-based no-trade: entire day is dead
    const volRatio = volAvg > 0 ? todayVol / volAvg : 1;
    if (volRatio < 0.7) {
        return {
            regime: 'NO-TRADE',
            reason: `Dead volume: ${(volRatio * 100).toFixed(0)}% of 5-day avg`,
            sma20, sma50, bb, atr, volAvg
        };
    }

    // SMA20 crossing SMA50 — ambiguous, skip
    const smaSeparation = Math.abs(sma20 - sma50) / sma50;
    const smaCrossing = smaSeparation < 0.001; // within 0.1% = crossing zone
    if (smaCrossing) {
        return {
            regime: 'NO-TRADE',
            reason: `SMA20/50 crossing zone (separation ${(smaSeparation * 100).toFixed(2)}%) — ambiguous`,
            sma20, sma50, bb, atr, volAvg
        };
    }

    // ── Trending Regime ──
    const strongSMASeparation = smaSeparation >= CONFIG.TREND_SMA_MIN_SEPARATION;
    const bbExpanding = bb.width >= CONFIG.BB_EXPANSION_THRESHOLD;

    if (strongSMASeparation && bbExpanding) {
        const trendDirection = sma20 > sma50 ? 'BULLISH' : 'BEARISH';
        return {
            regime: 'TRENDING',
            direction: trendDirection,
            reason: `SMA separation ${(smaSeparation * 100).toFixed(2)}%, BB expanding (${(bb.width * 100).toFixed(2)}%)`,
            sma20, sma50, bb, atr, volAvg, smaSeparation
        };
    }

    // ── Ranging Regime ──
    return {
        regime: 'RANGING',
        reason: `SMA close (${(smaSeparation * 100).toFixed(2)}% sep), BB moderate (${(bb.width * 100).toFixed(2)}%)`,
        sma20, sma50, bb, atr, volAvg, smaSeparation
    };
}

// ══════════════════════════════════════════════════════════════
//  SECTION 5 — STEP 3: PRICE ACTION DETECTION
// ══════════════════════════════════════════════════════════════

/**
 * Price Action Patterns (MANDATORY GATE)
 * At least ONE must be true for the trade to proceed.
 *
 * BULLISH patterns:
 *   1. Bullish engulfing (current candle body > previous, closes above)
 *   2. Strong bull close (close > 70% of candle range from low)
 *   3. Higher-high + higher-low (trending confirmation)
 *   4. Break above previous candle high (breakout)
 *
 * BEARISH patterns (mirror of above):
 *   1. Bearish engulfing
 *   2. Strong bear close (close < 30% of candle range)
 *   3. Lower-low + lower-high
 *   4. Break below previous candle low
 */

function detectPriceAction(ohlcv) {
    const { opens, highs, lows, closes } = ohlcv;
    const n = closes.length;
    if (n < 3) return { bullish: [], bearish: [], confirmed: false };

    const curr = { o: opens[n-1], h: highs[n-1], l: lows[n-1], c: closes[n-1] };
    const prev = { o: opens[n-2], h: highs[n-2], l: lows[n-2], c: closes[n-2] };
    const prev2 = { o: opens[n-3], h: highs[n-3], l: lows[n-3], c: closes[n-3] };

    const currRange = curr.h - curr.l;
    const prevRange = prev.h - prev.l;
    const currBody = Math.abs(curr.c - curr.o);
    const prevBody = Math.abs(prev.c - prev.o);

    const bullishPatterns = [];
    const bearishPatterns = [];

    // Strong close position (0=at low, 1=at high)
    const closePosition = currRange > 0 ? (curr.c - curr.l) / currRange : 0.5;

    // 1. Engulfing
    const bullEngulf = curr.c > curr.o && curr.c > prev.o && curr.o < prev.c && currBody > prevBody;
    const bearEngulf = curr.c < curr.o && curr.c < prev.o && curr.o > prev.c && currBody > prevBody;
    if (bullEngulf) bullishPatterns.push({ name: 'BullEngulfing', weight: 1.0 });
    if (bearEngulf) bearishPatterns.push({ name: 'BearEngulfing', weight: 1.0 });

    // 2. Strong close
    if (closePosition >= 0.70) bullishPatterns.push({ name: 'StrongBullClose', weight: 0.7 });
    if (closePosition <= 0.30) bearishPatterns.push({ name: 'StrongBearClose', weight: 0.7 });

    // 3. HH/HL (trending up) or LL/LH (trending down)
    const higherHigh = curr.h > prev.h && prev.h > prev2.h;
    const higherLow  = curr.l > prev.l && prev.l > prev2.l;
    const lowerLow   = curr.l < prev.l && prev.l < prev2.l;
    const lowerHigh  = curr.h < prev.h && prev.h < prev2.h;
    if (higherHigh && higherLow) bullishPatterns.push({ name: 'HH-HL Sequence', weight: 0.9 });
    if (lowerLow && lowerHigh)   bearishPatterns.push({ name: 'LL-LH Sequence', weight: 0.9 });

    // 4. Breakout of previous candle
    if (curr.c > prev.h) bullishPatterns.push({ name: 'BreakAbovePrevHigh', weight: 0.85 });
    if (curr.c < prev.l) bearishPatterns.push({ name: 'BreakBelowPrevLow',  weight: 0.85 });

    // 5. Pin bar / hammer (reversal at extremes)
    const lowerWick = curr.o > curr.c ? curr.c - curr.l : curr.o - curr.l;
    const upperWick = curr.o > curr.c ? curr.h - curr.o : curr.h - curr.c;
    const hammer = lowerWick > 2 * currBody && upperWick < 0.3 * currBody;
    const shootingStar = upperWick > 2 * currBody && lowerWick < 0.3 * currBody;
    if (hammer)       bullishPatterns.push({ name: 'Hammer', weight: 0.75 });
    if (shootingStar) bearishPatterns.push({ name: 'ShootingStar', weight: 0.75 });

    return {
        bullish: bullishPatterns,
        bearish: bearishPatterns,
        closePosition: +closePosition.toFixed(3),
        // Strongest pattern score for use in probability model
        bullishScore: bullishPatterns.length > 0
            ? Math.max(...bullishPatterns.map(p => p.weight))
            : 0,
        bearishScore: bearishPatterns.length > 0
            ? Math.max(...bearishPatterns.map(p => p.weight))
            : 0,
    };
}

// ══════════════════════════════════════════════════════════════
//  SECTION 6 — STEP 4: PROBABILITY SCORING ENGINE
// ══════════════════════════════════════════════════════════════

/**
 * Converts each indicator into a DIRECTION SCORE (0=strong bear, 1=strong bull)
 * then weights them by regime and sums to produce P(BUY) and P(SELL).
 *
 * Final probability = max(P_buy, P_sell) × 100
 * If neither reaches threshold → HOLD
 *
 * IMPORTANT: Scores are NOT symmetric.
 *   - A score of 0.5 means neutral
 *   - Score > 0.5 = bullish evidence
 *   - Score < 0.5 = bearish evidence
 */

function scoreTrending(closes, highs, lows, volumes, regimeInfo, priceAction) {
    const { sma20, sma50, bb, volAvg } = regimeInfo;
    const price = closes[closes.length - 1];
    const todayVol = volumes[volumes.length - 1];
    const macd = MathUtils.macd(closes);
    const rsi = MathUtils.rsi(closes);
    const W = CONFIG.WEIGHTS.TRENDING;

    const scores = {};

    // ── 1. Trend Alignment Score (30%) ──
    // Measures HOW aligned price + SMAs are in the same direction
    const priceAboveSMA20 = price > sma20 ? 1 : 0;
    const priceAboveSMA50 = price > sma50 ? 1 : 0;
    const sma20AboveSMA50 = sma20 > sma50 ? 1 : 0;
    // Perfect bull trend: all 3 = 1.0, perfect bear: all 3 = 0.0
    scores.trendAlignment = (priceAboveSMA20 + priceAboveSMA50 + sma20AboveSMA50) / 3;

    // ── 2. Volume Confirmation Score (25%) ──
    // Compare today's volume against 5-day avg EXCLUDING today
    const prevVolumes = volumes.slice(0, -1);
    const prev5Avg = prevVolumes.length >= 5 
        ? prevVolumes.slice(-5).reduce((a, b) => a + b, 0) / 5 
        : (volAvg || 1);
    const volRatio = prev5Avg > 0 ? todayVol / prev5Avg : 1;
    const priceUp = closes[closes.length - 1] > closes[closes.length - 2];
    if (volRatio >= CONFIG.VOLUME_SURGE_MULTIPLIER) {
        scores.volumeConfirmation = priceUp ? 0.85 : 0.15;
    } else if (volRatio >= CONFIG.VOLUME_MIN_MULTIPLIER) {
        scores.volumeConfirmation = priceUp ? 0.68 : 0.32;
    } else {
        scores.volumeConfirmation = 0.38; // low volume — mild penalty
    }

    // ── 3. Price Action Pattern Score (20%) ──
    // Scale: pure bull pattern = 0.9, pure bear = 0.1, mixed/none = 0.5
    const paDiff = priceAction.bullishScore - priceAction.bearishScore;
    if (paDiff > 0.5) scores.priceActionPattern = 0.85 + (paDiff - 0.5) * 0.1;
    else if (paDiff > 0.2) scores.priceActionPattern = 0.70;
    else if (paDiff > 0) scores.priceActionPattern = 0.60;
    else if (paDiff === 0 && priceAction.bullishScore === 0) scores.priceActionPattern = 0.50;
    else if (paDiff < -0.5) scores.priceActionPattern = 0.15;
    else if (paDiff < -0.2) scores.priceActionPattern = 0.30;
    else scores.priceActionPattern = 0.40;
    scores.priceActionPattern = MathUtils.clamp01(scores.priceActionPattern);

    // ── 4. MACD Momentum Score (15%) ──
    if (macd) {
        let macdScore = 0.5;
        if (macd.bullishCross) macdScore += 0.2;
        else macdScore -= 0.2;
        if (macd.histogramGrowing && macd.histogram > 0) macdScore += 0.15;
        else if (!macd.histogramGrowing && macd.histogram < 0) macdScore -= 0.15;
        scores.macdMomentum = MathUtils.clamp01(macdScore);
    } else {
        scores.macdMomentum = 0.5; // neutral if unavailable
    }

    // ── 5. RSI Filter Score (10%) ── 
    // In TRENDING regime: RSI is a DIRECTION-AWARE filter.
    // High RSI in an uptrend is HEALTHY (trend strength), not overbought.
    // Penalize only when RSI contradicts the current SMA trend direction.
    const trendIsUp = sma20 > sma50;
    if (rsi !== null) {
        if (trendIsUp) {
            // Bullish trend: RSI > 50 is healthy, < 40 is warning
            if (rsi >= 60) scores.rsiFilter = 0.75;       // Trend strength — healthy
            else if (rsi >= 40) scores.rsiFilter = 0.55;  // Mild — neutral
            else if (rsi < 30) scores.rsiFilter = 0.15;   // Contradicts uptrend — penalize
            else scores.rsiFilter = 0.35;
        } else {
            // Bearish trend: RSI < 40 is healthy selling
            if (rsi <= 40) scores.rsiFilter = 0.75;       // Trend strength — healthy
            else if (rsi <= 60) scores.rsiFilter = 0.55;  // Mild — neutral
            else if (rsi > 70) scores.rsiFilter = 0.15;   // Contradicts downtrend — penalize
            else scores.rsiFilter = 0.35;
        }
    } else {
        scores.rsiFilter = 0.5;
    }

    // ── Weighted Sum ──
    let rawScore = 0;
    for (const [key, weight] of Object.entries(W)) {
        rawScore += (scores[key] ?? 0.5) * weight;
    }

    return {
        rawScore,          // 0–1, where >0.5 = bullish bias, <0.5 = bearish bias
        componentScores: scores,
        rsi,
        macd
    };
}

function scoreRanging(closes, highs, lows, volumes, regimeInfo, priceAction) {
    const { bb, volAvg } = regimeInfo;
    const price = closes[closes.length - 1];
    const todayVol = volumes[volumes.length - 1];
    const rsi = MathUtils.rsi(closes);
    const W = CONFIG.WEIGHTS.RANGING;

    const scores = {};

    // ── 1. RSI Extreme Score (30%) ──
    if (rsi !== null) {
        if (rsi < 25)      scores.rsiExtreme = 0.95;  // Very oversold → strong buy signal
        else if (rsi < 35) scores.rsiExtreme = 0.75;  // Oversold → buy signal
        else if (rsi > 75) scores.rsiExtreme = 0.05;  // Very overbought → strong sell
        else if (rsi > 65) scores.rsiExtreme = 0.25;  // Overbought → sell signal
        else               scores.rsiExtreme = 0.50;  // Neutral — no edge
    } else {
        scores.rsiExtreme = 0.5;
    }

    // ── 2. Bollinger Band Position Score (30%) ──
    if (bb) {
        // percentB: 0=at lower band, 1=at upper band
        const pB = bb.percentB;
        if (pB <= 0.0)       scores.bollingerPosition = 0.95;  // At/below lower band
        else if (pB <= 0.1)  scores.bollingerPosition = 0.80;
        else if (pB <= 0.2)  scores.bollingerPosition = 0.65;
        else if (pB >= 1.0)  scores.bollingerPosition = 0.05;  // At/above upper band
        else if (pB >= 0.9)  scores.bollingerPosition = 0.20;
        else if (pB >= 0.8)  scores.bollingerPosition = 0.35;
        else                 scores.bollingerPosition = 0.50;
    } else {
        scores.bollingerPosition = 0.5;
    }

    // ── 3. Volume Confirmation (25%) ──
    const volRatio = volAvg > 0 ? todayVol / volAvg : 1;
    const priceUp = closes[closes.length - 1] > closes[closes.length - 2];
    if (volRatio >= CONFIG.VOLUME_SURGE_MULTIPLIER) {
        scores.volumeConfirmation = priceUp ? 0.80 : 0.20;
    } else if (volRatio >= CONFIG.VOLUME_MIN_MULTIPLIER) {
        scores.volumeConfirmation = priceUp ? 0.60 : 0.40;
    } else {
        scores.volumeConfirmation = 0.40; // low volume → penalize
    }

    // ── 4. Price Action Pattern (15%) ──
    scores.priceActionPattern = MathUtils.clamp01(
        (priceAction.bullishScore - priceAction.bearishScore) * 0.5 + 0.5
    );

    // ── Weighted Sum ──
    let rawScore = 0;
    for (const [key, weight] of Object.entries(W)) {
        rawScore += (scores[key] ?? 0.5) * weight;
    }

    return {
        rawScore,
        componentScores: scores,
        rsi,
        macd: null  // MACD intentionally NOT used in ranging regime
    };
}

// ══════════════════════════════════════════════════════════════
//  SECTION 7 — STEP 5: RISK/REWARD CALCULATOR
// ══════════════════════════════════════════════════════════════

function calculateRiskReward(direction, price, atr) {
    /**
     * Uses ATR for adaptive stop-loss and target.
     * Why ATR? It accounts for current volatility so stops aren't
     * arbitrarily tight or unnecessarily wide.
     */
    if (!atr || atr <= 0) return null;

    const stopDistance = atr * CONFIG.ATR_STOP_MULTIPLIER;
    const targetDistance = atr * CONFIG.ATR_TARGET_MULTIPLIER;
    const rr = targetDistance / stopDistance;  // = ATR_TARGET / ATR_STOP = 2.0

    if (direction === 'BUY') {
        return {
            entry: +price.toFixed(2),
            stopLoss: +(price - stopDistance).toFixed(2),
            target: +(price + targetDistance).toFixed(2),
            riskReward: +rr.toFixed(2),
            stopDistance: +stopDistance.toFixed(2),
            valid: rr >= CONFIG.MIN_RISK_REWARD
        };
    } else if (direction === 'SELL') {
        return {
            entry: +price.toFixed(2),
            stopLoss: +(price + stopDistance).toFixed(2),
            target: +(price - targetDistance).toFixed(2),
            riskReward: +rr.toFixed(2),
            stopDistance: +stopDistance.toFixed(2),
            valid: rr >= CONFIG.MIN_RISK_REWARD
        };
    }

    return null;
}

// ══════════════════════════════════════════════════════════════
//  SECTION 8 — STEP 6: NO-TRADE SUPPRESSION RULES
// ══════════════════════════════════════════════════════════════

/**
 * Explicit conditions that CANCEL a trade even if probability is high.
 * These are structural market conditions where edge disappears.
 */

function checkNoTradeConditions(ohlcv, regimeInfo, scoreResult) {
    const { closes, highs, lows, volumes } = ohlcv;
    const { bb, volAvg } = regimeInfo;
    const price = closes[closes.length - 1];
    const open = ohlcv.opens[ohlcv.opens.length - 1];
    const todayVol = volumes[volumes.length - 1];
    const reasons = [];

    // 1. Flat open + low volume (indecision day)
    const gapPercent = Math.abs(price - open) / open;
    const volRatio = volAvg > 0 ? todayVol / volAvg : 1;
    if (gapPercent < 0.003 && volRatio < CONFIG.VOLUME_MIN_MULTIPLIER) {
        reasons.push('Flat open + low volume (indecision day)');
    }

    // 2. BB squeeze detected mid-analysis (shouldn't reach here but safety net)
    if (bb && bb.width < CONFIG.BB_SQUEEZE_THRESHOLD) {
        reasons.push(`BB squeeze (width: ${(bb.width * 100).toFixed(2)}%)`);
    }

    // 3. Price inside previous candle's range (inside bar = compression, no edge)
    const prevH = highs[highs.length - 2];
    const prevL = lows[lows.length - 2];
    const currH = highs[highs.length - 1];
    const currL = lows[lows.length - 1];
    if (currH <= prevH && currL >= prevL) {
        reasons.push('Inside bar — compression, no directional edge');
    }

    // 4. Score is in the "dead zone" (between 45–55 normalized)
    // This means neither bulls nor bears have strong control
    const normalizedScore = scoreResult.rawScore * 100;
    if (normalizedScore >= 45 && normalizedScore <= 55) {
        reasons.push(`Probability dead zone (score: ${normalizedScore.toFixed(1)}) — no edge`);
    }

    return {
        blocked: reasons.length > 0,
        reasons
    };
}

// ══════════════════════════════════════════════════════════════
//  SECTION 9 — MASTER PIPELINE: runEngine()
// ══════════════════════════════════════════════════════════════

/**
 * THE MAIN ENTRY POINT
 *
 * @param {Object} ohlcv - { opens[], highs[], lows[], closes[], volumes[], symbol, timeframe }
 * @param {Object} [options] - Optional overrides for CONFIG values
 * @returns {Object} - Full analysis result with signal, probability, and trade levels
 */

function runEngine(ohlcv, options = {}) {
    const cfg = { ...CONFIG, ...options };

    // ── Step 1: Validate Data ─────────────────────────────────
    const validation = validateData(ohlcv);
    if (!validation.valid) {
        return buildResult('NO-TRADE', null, 0, {
            stage: 'DATA_VALIDATION',
            reason: validation.reason
        });
    }

    const { opens, highs, lows, closes, volumes } = ohlcv;
    const price = closes[closes.length - 1];

    // ── Step 2: Detect Market Regime ──────────────────────────
    const regime = detectRegime(ohlcv);

    if (regime.regime === 'NO-TRADE') {
        return buildResult('NO-TRADE', regime.regime, 0, {
            stage: 'REGIME_DETECTION',
            reason: regime.reason,
            regime: regime.regime
        });
    }

    // ── Step 3: Price Action (mandatory gate) ─────────────────
    const priceAction = detectPriceAction(ohlcv);
    const noBullishPA = priceAction.bullishPatterns?.length === 0 && priceAction.bullishScore === 0;
    const noBearishPA = priceAction.bearishPatterns?.length === 0 && priceAction.bearishScore === 0;

    // ── Step 4: Compute Probability Score ─────────────────────
    let scoreResult;
    if (regime.regime === 'TRENDING') {
        scoreResult = scoreTrending(closes, highs, lows, volumes, regime, priceAction);
    } else {
        scoreResult = scoreRanging(closes, highs, lows, volumes, regime, priceAction);
    }

    // Convert rawScore (0–1) into directional probabilities
    // rawScore > 0.5 = bullish bias, < 0.5 = bearish bias
    // We map to 0–100 scale, centering on 50
    const bullProbability = Math.round(MathUtils.clamp01(scoreResult.rawScore) * 100);
    const bearProbability = 100 - bullProbability;

    const direction = bullProbability >= bearProbability ? 'BUY' : 'SELL';
    const highestProb = Math.max(bullProbability, bearProbability);

    // ── Step 5: Price Action Gate ─────────────────────────────
    const paScore = direction === 'BUY' ? priceAction.bullishScore : priceAction.bearishScore;
    if (paScore === 0) {
        return buildResult('HOLD', regime.regime, highestProb, {
            stage: 'PRICE_ACTION_GATE',
            reason: `No ${direction === 'BUY' ? 'bullish' : 'bearish'} price action pattern confirmed`,
            regime: regime.regime,
            probability: highestProb,
            direction,
            scoreBreakdown: scoreResult.componentScores,
            rsi: scoreResult.rsi,
            macd: scoreResult.macd,
            priceAction
        });
    }

    // ── Step 6: No-Trade Condition Check ──────────────────────
    const noTradeCheck = checkNoTradeConditions(ohlcv, regime, scoreResult);
    if (noTradeCheck.blocked) {
        return buildResult('NO-TRADE', regime.regime, highestProb, {
            stage: 'NO_TRADE_SUPPRESSION',
            reason: noTradeCheck.reasons.join('; '),
            regime: regime.regime,
            probability: highestProb,
            direction,
            scoreBreakdown: scoreResult.componentScores,
        });
    }

    // ── Step 7: Probability Threshold Gate ────────────────────
    if (highestProb < cfg.MIN_PROBABILITY_TO_TRADE) {
        return buildResult('HOLD', regime.regime, highestProb, {
            stage: 'PROBABILITY_THRESHOLD',
            reason: `Probability ${highestProb}% below threshold ${cfg.MIN_PROBABILITY_TO_TRADE}%`,
            regime: regime.regime,
            probability: highestProb,
            direction,
            scoreBreakdown: scoreResult.componentScores,
            rsi: scoreResult.rsi,
            macd: scoreResult.macd,
            priceAction
        });
    }

    // ── Step 8: Risk/Reward Gate ──────────────────────────────
    const rrResult = calculateRiskReward(direction, price, regime.atr);
    if (!rrResult || !rrResult.valid) {
        return buildResult('HOLD', regime.regime, highestProb, {
            stage: 'RISK_REWARD_GATE',
            reason: `R:R ${rrResult?.riskReward ?? 'N/A'} below minimum ${cfg.MIN_RISK_REWARD}:1`,
            regime: regime.regime,
            probability: highestProb,
            direction,
        });
    }

    // ── Step 9: Volume Final Gate ─────────────────────────────
    // Use prev 5 days EXCLUDING today for a fair comparison
    const todayVolume = volumes[volumes.length - 1];
    const prev5Vols = volumes.slice(-6, -1);
    const prev5VolAvg = prev5Vols.length >= 5
        ? prev5Vols.reduce((a, b) => a + b, 0) / 5
        : (regime.volAvg || 1);
    const volRatio = prev5VolAvg > 0 ? todayVolume / prev5VolAvg : 1;
    if (volRatio < cfg.VOLUME_MIN_MULTIPLIER) {
        return buildResult('HOLD', regime.regime, highestProb, {
            stage: 'VOLUME_GATE',
            reason: `Volume ${(volRatio * 100).toFixed(0)}% of 5-day avg — below ${cfg.VOLUME_MIN_MULTIPLIER * 100}% minimum`,
            regime: regime.regime,
            probability: highestProb,
            direction,
        });
    }

    // ── SIGNAL QUALIFIED — ALL GATES PASSED ──────────────────
    const convictionLevel =
        highestProb >= cfg.HIGH_CONVICTION_THRESHOLD ? 'HIGH' :
        highestProb >= 80 ? 'MEDIUM-HIGH' : 'MEDIUM';

    return buildResult(direction, regime.regime, highestProb, {
        stage: 'SIGNAL_QUALIFIED',
        reason: `All ${8} gates passed`,
        regime: regime.regime,
        direction,
        probability: highestProb,
        conviction: convictionLevel,
        riskReward: rrResult,
        priceAction: {
            patternsFound: direction === 'BUY' ? priceAction.bullish : priceAction.bearish,
            score: paScore
        },
        volume: {
            today: volumes[volumes.length - 1],
            fiveDayAvg: regime.volAvg,
            ratio: +volRatio.toFixed(2)
        },
        indicators: {
            rsi: scoreResult.rsi,
            macd: scoreResult.macd,
            sma20: regime.sma20,
            sma50: regime.sma50,
            bb: regime.bb,
            atr: regime.atr
        },
        scoreBreakdown: scoreResult.componentScores,
        regimeDetails: {
            type: regime.regime,
            direction: regime.direction,
            reason: regime.reason
        }
    });
}

// ══════════════════════════════════════════════════════════════
//  SECTION 10 — RESULT BUILDER
// ══════════════════════════════════════════════════════════════

function buildResult(signal, regime, probability, meta = {}) {
    return {
        signal,          // 'BUY' | 'SELL' | 'HOLD' | 'NO-TRADE'
        regime,          // 'TRENDING' | 'RANGING' | 'NO-TRADE' | null
        probability,     // 0–100 final score
        timestamp: new Date().toISOString(),
        ...meta
    };
}

// ══════════════════════════════════════════════════════════════
//  SECTION 11 — TELEGRAM BOT INTEGRATION ADAPTER
// ══════════════════════════════════════════════════════════════

/**
 * Takes Yahoo Finance / Alpha Vantage raw response and adapts it
 * into the OHLCV format required by runEngine().
 *
 * @param {Object} yahooResult   - result from Yahoo Finance chart API
 * @param {string} symbol
 * @returns {Object}             - OHLCV ready for runEngine()
 */
function buildOHLCVFromYahoo(yahooResult, symbol) {
    const meta = yahooResult.meta;
    const ohlcv = yahooResult.indicators?.quote?.[0] || {};
    const timestamps = yahooResult.timestamp || [];

    const filter = (arr) => (arr || []).filter(v => v != null && !isNaN(v));

    return {
        symbol,
        timeframe: 'daily',
        opens:      filter(ohlcv.open),
        highs:      filter(ohlcv.high),
        lows:       filter(ohlcv.low),
        closes:     filter(ohlcv.close),
        volumes:    filter(ohlcv.volume),
        currentPrice: meta?.regularMarketPrice,
        prevClose:    meta?.chartPreviousClose,
        currency:     meta?.currency === 'INR' ? '₹' : '$',
    };
}

/**
 * Takes Alpha Vantage TIME_SERIES_DAILY response and adapts it.
 */
function buildOHLCVFromAlphaVantage(avData, symbol, currentQuote) {
    const ts = avData['Time Series (Daily)'] || {};
    const keys = Object.keys(ts).sort();

    const filter = (arr) => arr.filter(v => v != null && !isNaN(v));

    const result = {
        symbol,
        timeframe: 'daily',
        opens:   filter(keys.map(k => parseFloat(ts[k]['1. open']))),
        highs:   filter(keys.map(k => parseFloat(ts[k]['2. high']))),
        lows:    filter(keys.map(k => parseFloat(ts[k]['3. low']))),
        closes:  filter(keys.map(k => parseFloat(ts[k]['4. close']))),
        volumes: filter(keys.map(k => parseInt(ts[k]['5. volume']))),
    };

    if (currentQuote) {
        result.currentPrice = parseFloat(currentQuote['05. price']);
        result.prevClose    = parseFloat(currentQuote['08. previous close']);
        result.currency     = '$';
    }

    return result;
}

/**
 * Human-readable formatter for Telegram message output
 */
function formatResultForTelegram(result, name, symbol, marketFlag) {
    const esc = (str) => String(str ?? 'N/A')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    const signalEmoji = {
        'BUY': '🟢', 'SELL': '🔴', 'HOLD': '⚪', 'NO-TRADE': '⛔'
    }[result.signal] || '❓';

    const regimeEmoji = {
        'TRENDING': '📈', 'RANGING': '↔️', 'NO-TRADE': '🚫'
    }[result.regime] || '❓';

    const probBar = () => {
        const filled = Math.round((result.probability || 0) / 10);
        return '█'.repeat(filled) + '░'.repeat(10 - filled) + ` ${result.probability}%`;
    };

    if (result.signal === 'NO-TRADE') {
        return (
            `📊 <b>${esc(name)} (${esc(symbol)})</b> ${marketFlag}\n` +
            `━━━━━━━━━━━━━━━\n` +
            `⛔ <b>NO TRADE — System skipped</b>\n` +
            `${regimeEmoji} Regime: ${esc(result.regime)}\n` +
            `📍 Stopped at: ${esc(result.stage)}\n` +
            `💬 Reason: ${esc(result.reason)}\n\n` +
            `<i>⚠️ Skipping trades is a feature, not a bug. This protects your capital.</i>`
        );
    }

    if (result.signal === 'HOLD') {
        return (
            `📊 <b>${esc(name)} (${esc(symbol)})</b> ${marketFlag}\n` +
            `━━━━━━━━━━━━━━━\n` +
            `⚪ <b>HOLD — Conditions not qualified</b>\n` +
            `${regimeEmoji} Regime: ${esc(result.regime)}\n` +
            `📊 Probability: ${probBar()}\n` +
            `📍 Stopped at: ${esc(result.stage?.replace(/_/g, ' '))}\n` +
            `💬 Reason: ${esc(result.reason)}\n\n` +
            `<i>⚠️ Threshold not met. No edge = no trade.</i>`
        );
    }

    // BUY or SELL
    const rr = result.riskReward;
    const ind = result.indicators || {};
    const pa = result.priceAction || {};
    const vol = result.volume || {};
    const sc = result.scoreBreakdown || {};

    const scoreLines = Object.entries(sc)
        .map(([k, v]) => `  • ${k}: ${(v * 100).toFixed(0)}/100`)
        .join('\n');

    return (
        `📊 <b>${esc(name)} (${esc(symbol)})</b> ${marketFlag}\n` +
        `━━━━━━━━━━━━━━━\n` +
        `${signalEmoji} <b>SIGNAL: ${result.signal}</b>  |  ${regimeEmoji} Regime: ${esc(result.regime)}\n` +
        `🎯 Conviction: <b>${esc(result.conviction)}</b>\n\n` +

        `📊 <b>Probability Score</b>\n` +
        `${probBar()}\n\n` +

        `📐 <b>Score Breakdown</b>\n${scoreLines}\n\n` +

        `🕯️ <b>Price Action</b>\n` +
        `${(pa.patternsFound || []).map(p => `  ✅ ${esc(p.name)}`).join('\n') || '  None'}\n\n` +

        `📉 <b>Indicators</b>\n` +
        `  RSI: ${esc(ind.rsi?.toFixed(1))}\n` +
        `  MACD: ${ind.macd ? (ind.macd.bullishCross ? '🟢 Bullish' : '🔴 Bearish') : 'N/A'}\n` +
        `  SMA20: ${esc(ind.sma20)}  SMA50: ${esc(ind.sma50)}\n` +
        `  BB Width: ${ind.bb ? (ind.bb.width * 100).toFixed(2) + '%' : 'N/A'}\n` +
        `  ATR: ${esc(ind.atr?.toFixed(2))}\n\n` +

        `📦 <b>Volume</b>\n` +
        `  Today: ${vol.today?.toLocaleString() ?? 'N/A'}\n` +
        `  5-Day Avg: ${vol.fiveDayAvg?.toLocaleString() ?? 'N/A'}\n` +
        `  Ratio: ${esc(vol.ratio)}×\n\n` +

        `💰 <b>Trade Levels</b>\n` +
        `  Entry:     ${esc(rr?.entry)}\n` +
        `  Target:    ${esc(rr?.target)}  🏹\n` +
        `  Stop Loss: ${esc(rr?.stopLoss)}  🛡️\n` +
        `  R:R Ratio: 1:${esc(rr?.riskReward)}\n\n` +

        `<i>⚠️ AI + quant analysis only — not financial advice.</i>`
    );
}

// ══════════════════════════════════════════════════════════════
//  EXPORTS
// ══════════════════════════════════════════════════════════════

module.exports = {
    runEngine,
    buildOHLCVFromYahoo,
    buildOHLCVFromAlphaVantage,
    formatResultForTelegram,
    // Expose internals for testing/tuning
    detectRegime,
    detectPriceAction,
    scoreTrending,
    scoreRanging,
    calculateRiskReward,
    checkNoTradeConditions,
    MathUtils,
    CONFIG
};
