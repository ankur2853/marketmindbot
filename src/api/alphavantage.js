const axios = require('axios');
const { ALPHA_KEY } = require('../config/env');

// ════════════════════════════════════════════════════════════
//  FETCH US STOCK (Alpha Vantage — daily data)
// ════════════════════════════════════════════════════════════

async function fetchUSStock(symbol) {
    if (!ALPHA_KEY) throw new Error('ALPHA_KEY missing in .env');

    // Fetch current quote
    const quoteRes = await axios.get(
        `https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${symbol}&apikey=${ALPHA_KEY}`,
        { timeout: 12000 }
    );

    const data = quoteRes.data['Global Quote'];
    if (!data || !data['05. price']) throw new Error('No quote data found');

    const price = parseFloat(data['05. price']);
    const prevClose = parseFloat(data['08. previous close']);
    const high = parseFloat(data['03. high']);
    const low = parseFloat(data['04. low']);
    const volume = parseInt(data['06. volume']);
    const change = parseFloat(data['10. change percent']);

    // Fetch 3 months of daily closes for indicators
    let closes = [], volumes = [], highs = [], lows = [];
    try {
        const histRes = await axios.get(
            `https://www.alphavantage.co/query?function=TIME_SERIES_DAILY&symbol=${symbol}&outputsize=compact&apikey=${ALPHA_KEY}`,
            { timeout: 12000 }
        );
        const ts = histRes.data['Time Series (Daily)'];
        if (ts) {
            const keys = Object.keys(ts).sort();
            closes = keys.map(k => parseFloat(ts[k]['4. close']));
            volumes = keys.map(k => parseInt(ts[k]['5. volume']));
            highs = keys.map(k => parseFloat(ts[k]['2. high']));
            lows = keys.map(k => parseFloat(ts[k]['3. low']));
        }
    } catch (e) {
        // Historical fetch failed — will skip indicator calculations
    }

    return { price, prevClose, high, low, volume, change, currency: '$', closes, volumes, highs, lows };
}

module.exports = { fetchUSStock };
