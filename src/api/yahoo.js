const axios = require('axios');

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

module.exports = { fetchIndianStock };
