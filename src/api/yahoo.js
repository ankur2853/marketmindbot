'use strict';
const axios = require('axios');
const { buildOHLCVFromYahoo } = require('../services/tradingEngine');

async function fetchIndianStock(symbol) {
    const formats = [`${symbol}.NS`, `${symbol}.BO`];

    for (const fmt of formats) {
        try {
            const url = `https://query1.finance.yahoo.com/v8/finance/chart/${fmt}?range=3mo&interval=1d`;
            const response = await axios.get(url, {
                headers: { 'User-Agent': 'Mozilla/5.0' },
                timeout: 12000
            });

            const chartResult = response.data.chart.result?.[0];
            if (!chartResult) continue;

            const rawData = buildOHLCVFromYahoo(chartResult, symbol);
            rawData.currency = '₹';
            rawData.currentPrice = chartResult.meta.regularMarketPrice;
            rawData.prevClose = chartResult.meta.chartPreviousClose;
            rawData.high = chartResult.meta.regularMarketDayHigh;
            rawData.low = chartResult.meta.regularMarketDayLow;
            rawData.volume = chartResult.meta.regularMarketVolume;
            rawData.change = ((rawData.currentPrice - rawData.prevClose) / rawData.prevClose) * 100;

            return rawData;
        } catch (e) {
            continue;
        }
    }

    throw new Error('Symbol not found on NSE/BSE');
}

module.exports = { fetchIndianStock };
