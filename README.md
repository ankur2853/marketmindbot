# MarketMindBot Pro 🤖📈

**MarketMindBot Pro** is an intelligent Telegram bot powered by Google Gemini AI that provides real-time stock market insights, technical analysis, and professional trading signals for both Indian (NSE/BSE) and US (NASDAQ/NYSE) stocks.

Just type any company name or ticker symbol, and the bot will automatically identify the stock, compute 7 advanced technical indicators based on historical data, and ask Google Gemini AI to analyze the data to provide an accurate `BUY`, `HOLD`, or `SELL` signal.

## ✨ Features

- **Smart Stock Identification**: Automatically detects if a stock belongs to the Indian or US market using Gemini AI.
- **Real-Time & Historical Data**: Fetches 3 months of historical data to compute daily technical trends. 
  - *Indian Stocks*: via Yahoo Finance endpoints
  - *US Stocks*: via Alpha Vantage API
- **Advanced Technical Analysis**: Computes the following 7 indicators automatically:
  1. **RSI (Relative Strength Index)**
  2. **MACD (Moving Average Convergence Divergence)**
  3. **20-Day SMA (Simple Moving Average)**
  4. **50-Day SMA**
  5. **Bollinger Bands**
  6. **Volume Trend Analysis**
  7. **Price Action Change**
- **AI Trading Signals**: Uses Google's **Gemini 2.5 Flash** model to generate rapid, professional trading signals (BUY 🟢 / SELL 🔴 / HOLD ⚪) only when 4 or more indicators reach a strong consensus.
- **Detailed Intelligence summary**: Provides a confidence level, risk assessment, stop-loss recommendation, short-term target price, and a short logical reasoning block justifying its bias. 

## 🛠️ Project Structure

The bot has been elegantly refactored into a scalable modular structure:

```text
/
├── src/
│   ├── index.js                  # Application entry point
│   ├── config/
│   │   └── env.js                # Centralized environment variable validation
│   ├── api/
│   │   ├── yahoo.js              # Fetching logic for Indian Stocks 
│   │   └── alphavantage.js       # Fetching logic for US Stocks 
│   ├── services/
│   │   ├── gemini.js             # Interaction with Google Gemini AI API
│   │   └── indicators.js         # Technical indicator math and consensus building
│   └── bot/
│       ├── instance.js           # Telegram bot instance initialization
│       └── handlers.js           # Telegram message routing and command logic
```

## 🚀 Getting Started

### Prerequisites

Ensure you have [Node.js](https://nodejs.org/) installed on your machine. You will also need API keys for the following services:
1. **Telegram Bot Token** – Get this from [@BotFather](https://t.me/botfather) on Telegram.
2. **Google Gemini API Key** – Get this from [Google AI Studio](https://aistudio.google.com/).
3. **Alpha Vantage API Key** – Get this from [Alpha Vantage](https://www.alphavantage.co/) (required for US stock data).

### Installation

1. Clone or download this repository.
2. Install the necessary dependencies:

   ```bash
   npm install
   ```

3. Create a `.env` file in the root directory and add your API credentials:

   ```env
   TELEGRAM_TOKEN=your_telegram_bot_token_here
   GEMINI_API_KEY=your_gemini_api_key_here
   ALPHA_KEY=your_alpha_vantage_api_key_here
   ```

### Running the Bot

Start the bot by running:

```bash
npm start
```

Or run via node:

```bash
node src/index.js
```

You should see an output indicating the bot is up and running:
> `🤖 MarketMindBot Pro with Gemini AI + Technical Analysis is running...`

## 🎯 Usage

1. Open Telegram and start a chat with your bot.
2. Type `/start` to see the welcome message.
3. Simply type the name of **any company** or **stock symbol**. Examples:
   - `Apple` or `AAPL`
   - `Reliance` or `RELIANCE.NS`
   - `Tesla` or `TSLA`
   - `HDFCBANK`

The bot will ping the APIs to get the live data and historical closing prices, compute the indicators, ask Gemini for the final verdict, and format a beautiful report on whether to buy, sell, or hold.

## ⚠️ Disclaimer

*MarketMindBot Pro provides purely AI-generated analyses based on real-time data inputs and common technical formulas. These analyses **do not constitute financial advice**. Always do your own research or consult a certified financial advisor before making any investment decisions.*
