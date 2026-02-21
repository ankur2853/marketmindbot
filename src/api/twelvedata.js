'use strict';
const axios = require('axios');
const { TWELVE_KEY } = require('../config/env');

const FOREX_PAIRS = {
    // Major pairs
    'EUR/USD': { base: 'EUR', quote: 'USD', pipScale: 4, emoji: '🇪🇺🇺🇸' },
    'GBP/USD': { base: 'GBP', quote: 'USD', pipScale: 4, emoji: '🇬🇧🇺🇸' },
    'USD/JPY': { base: 'USD', quote: 'JPY', pipScale: 2, emoji: '🇺🇸🇯🇵' },
    'USD/CHF': { base: 'USD', quote: 'CHF', pipScale: 4, emoji: '🇺🇸🇨🇭' },
    'AUD/USD': { base: 'AUD', quote: 'USD', pipScale: 4, emoji: '🇦🇺🇺🇸' },
    'USD/CAD': { base: 'USD', quote: 'CAD', pipScale: 4, emoji: '🇺🇸🇨🇦' },
    'NZD/USD': { base: 'NZD', quote: 'USD', pipScale: 4, emoji: '🇳🇿🇺🇸' },
    // Cross pairs
    'EUR/GBP': { base: 'EUR', quote: 'GBP', pipScale: 4, emoji: '🇪🇺🇬🇧' },
    'EUR/JPY': { base: 'EUR', quote: 'JPY', pipScale: 2, emoji: '🇪🇺🇯🇵' },
    'GBP/JPY': { base: 'GBP', quote: 'JPY', pipScale: 2, emoji: '🇬🇧🇯🇵' },
    // INR pairs
    'USD/INR': { base: 'USD', quote: 'INR', pipScale: 2, emoji: '🇺🇸🇮🇳' },
    'EUR/INR': { base: 'EUR', quote: 'INR', pipScale: 2, emoji: '🇪🇺🇮🇳' },
    'GBP/INR': { base: 'GBP', quote: 'INR', pipScale: 2, emoji: '🇬🇧🇮🇳' },
    // Commodity pairs (via Twelve Data forex endpoint)
    'XAU/USD': { base: 'XAU', quote: 'USD', pipScale: 2, emoji: '🥇🇺🇸' },
    'XAG/USD': { base: 'XAG', quote: 'USD', pipScale: 4, emoji: '🥈🇺🇸' },
};

function normalisePair(input) {
    const upper = input.toUpperCase().replace(/\s+/g, '');
    if (FOREX_PAIRS[upper.replace('', '/')]) return upper;
    if (upper.length === 6) {
        const pair = upper.slice(0, 3) + '/' + upper.slice(3);
        if (FOREX_PAIRS[pair]) return pair;
        return pair;
    }
    const aliases = {
        'EURODOLLAR': 'EUR/USD', 'EURO': 'EUR/USD', 'CABLE': 'GBP/USD',
        'POUND': 'GBP/USD', 'GBPUSD': 'GBP/USD', 'USDJPY': 'USD/JPY',
        'YEN': 'USD/JPY', 'USDINR': 'USD/INR', 'GOLD': 'XAU/USD',
        'XAUUSD': 'XAU/USD', 'SILVER': 'XAG/USD', 'EURUSD': 'EUR/USD',
        'AUDUSD': 'AUD/USD', 'NZDUSD': 'NZD/USD', 'USDCAD': 'USD/CAD',
        'USDCHF': 'USD/CHF', 'EURGBP': 'EUR/GBP', 'EURJPY': 'EUR/JPY',
        'GBPJPY': 'GBP/JPY', 'GBPINR': 'GBP/INR', 'EURINR': 'EUR/INR',
    };
    return aliases[upper] || upper;
}

function isForexInput(input) {
    const upper = input.toUpperCase().replace(/[\s\/]/g, '');
    const known = Object.keys(FOREX_PAIRS).map(k => k.replace('/', ''));
    if (known.includes(upper)) return true;
    const fxWords = ['FOREX', 'FX', 'GOLD', 'XAU', 'XAG', 'SILVER', 'CABLE', 'EURODOLLAR',
        'EUR/USD', 'GBP/USD', 'USD/JPY', 'USD/INR', 'EUR', 'GBP', 'JPY', 'AUD', 'NZD',
        'USDINR', 'GBPINR', 'EURINR', 'AUDUSD', 'NZDUSD'];
    if (fxWords.some(w => upper.includes(w.replace('/', '')))) return true;
    if (/^[A-Z]{6}$/.test(upper)) return true;
    return false;
}

async function fetchForex(pairInput) {
    if (!TWELVE_KEY) throw new Error('TWELVE_KEY missing in .env — get a free key at twelvedata.com');
    const pair = normalisePair(pairInput);
    const pairInfo = FOREX_PAIRS[pair] || { pipScale: 4, emoji: '💱' };
    const url = `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(pair)}&interval=1day&outputsize=90&apikey=${TWELVE_KEY}`;

    const response = await axios.get(url, { timeout: 12000 });
    const data = response.data;
    if (data.status === 'error' || data.code) throw new Error(`Twelve Data Forex error: ${data.message || data.code}`);
    if (!data.values || data.values.length === 0) throw new Error(`No Forex data returned for ${pair}`);

    const bars = [...data.values].reverse();
    const opens = bars.map(b => parseFloat(b.open));
    const highs = bars.map(b => parseFloat(b.high));
    const lows = bars.map(b => parseFloat(b.low));
    const closes = bars.map(b => parseFloat(b.close));
    const volumes = new Array(bars.length).fill(1000000);

    const latest = bars[bars.length - 1];
    const prevBar = bars[bars.length - 2];
    const price = parseFloat(latest.close);
    const prevClose = parseFloat(prevBar.close);
    const high = parseFloat(latest.high);
    const low = parseFloat(latest.low);
    const change = ((price - prevClose) / prevClose) * 100;

    const pipDivisor = pairInfo.pipScale === 2 ? 100 : 10000;
    const pipValue = (price - prevClose) * pipDivisor;

    return {
        opens, highs, lows, closes, volumes,
        price, prevClose, high, low,
        volume: 0,
        change: +change.toFixed(4),
        currency: pairInfo.quote === 'INR' ? '₹' : pairInfo.quote === 'JPY' ? '¥' : '$',
        isForex: true,
        pair,
        pairInfo,
        pipValue: +pipValue.toFixed(1),
        pipScale: pairInfo.pipScale,
        symbol: pair,
    };
}

async function fetchUSStock(symbol) {
    if (!TWELVE_KEY) throw new Error('TWELVE_KEY missing in .env — get a free key at twelvedata.com');

    const url = `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(symbol)}&interval=1day&outputsize=90&apikey=${TWELVE_KEY}`;
    const response = await axios.get(url, { timeout: 12000 });
    const data = response.data;

    if (data.status === 'error' || data.code) throw new Error(`Twelve Data error: ${data.message || data.code}`);
    if (!data.values || data.values.length === 0) throw new Error(`No data returned for ${symbol}`);

    const bars = [...data.values].reverse();
    const opens = bars.map(b => parseFloat(b.open));
    const highs = bars.map(b => parseFloat(b.high));
    const lows = bars.map(b => parseFloat(b.low));
    const closes = bars.map(b => parseFloat(b.close));
    const volumes = bars.map(b => parseInt(b.volume) || 0);

    const latest = bars[bars.length - 1];
    const prevBar = bars[bars.length - 2];
    const price = parseFloat(latest.close);
    const prevClose = parseFloat(prevBar.close);
    const high = parseFloat(latest.high);
    const low = parseFloat(latest.low);
    const volume = parseInt(latest.volume) || 0;
    const change = ((price - prevClose) / prevClose) * 100;

    return {
        opens, highs, lows, closes, volumes,
        price, prevClose, high, low, volume,
        change: +change.toFixed(2),
        currency: '$',
        symbol,
        meta: data.meta || {}
    };
}

module.exports = { fetchForex, isForexInput, normalisePair, FOREX_PAIRS, fetchUSStock };
