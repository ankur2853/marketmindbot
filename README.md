# MarketMindBot Pro 🤖📈

**MarketMindBot Pro** is an advanced, intelligent Telegram bot powered by **Google Gemini AI** and a custom **8-Gate Quantitative Trading Engine**. It provides institutional-grade stock market insights, technical analysis, and professional multi-agent trading signals for Indian Stocks (NSE/BSE), US Stocks (NASDAQ/NYSE), and Forex currency pairs.

Just type any company name, ticker symbol, or forex pair, and the bot will:
1. Automatically identify the asset and market.
2. Fetch 90 days of precise historical price and volume data.
3. Run the data through a rigorous **8-Gate Quant Engine**.
4. Deploy **3 separate Gemini AI Agents** (Technical, Sentiment, and Risk) to debate and finalize a `BUY`, `HOLD`, or `SELL` signal.

## ✨ Core Features

- **Smart Asset Identification**: Detects Indian stocks, US stocks, and Forex pairs (including Gold & Silver) automatically.
- **8-Gate Quantitative Engine**: Acts as the first line of defense.
  1. *Data Validation Gate*
  2. *Market Regime Detection* (Trending, Ranging, No-Trade)
  3. *Price Action Pattern Recognition* (Engulfing, Doji, Marubozu, etc.)
  4. *Volume Confirmation Filter* 
  5. *Probability Scoring* (0-100 scale)
  6. *No-Trade Suppression* (Squeeze, Inside bars, etc.)
  7. *ATR-based Risk/Reward Calculation*
  8. *Final Signal Generation*
- **Multi-Agent AI System**: Uses Gemini 2.5 Flash to orchestrate three distinct personas:
  - 📐 **Agent 1 (Technical Analyst)**: Analyzes pure price action and quant indicators.
  - 🌐 **Agent 2 (Sentiment Analyst)**: Evaluates sector health, company fundamentals, and macroeconomic mood.
  - 🛡️ **Agent 3 (Risk Manager)**: Reviews Agents 1 & 2, challenges weaknesses, and delivers the final conservative trading verdict.
- **Unified Data Providers**: 
  - *Indian Stocks*: via Yahoo Finance
  - *US Stocks & Forex*: via Twelve Data API

## 🛠️ Project Architecture

The bot is built on a highly scalable, professional modular architecture:

```text
/
├── src/
│   ├── index.js                  # Application entry point
│   ├── config/
│   │   └── env.js                # Centralized environment variable validation
│   ├── api/
│   │   ├── twelvedata.js         # Fetching logic for US Stocks & Forex pairs
│   │   └── yahoo.js              # Fetching logic for Indian Stocks 
│   ├── services/
│   │   ├── tradingEngine.js      # The comprehensive 8-Gate Quantitative Engine
│   │   └── gemini.js             # 3-Agent AI Orchestrator & Asset Identification
│   └── bot/
│       ├── instance.js           # Telegram bot instance initialization
│       └── handlers.js           # Telegram message routing and unified data formatting
```

## 🚀 Getting Started

### Prerequisites

Ensure you have [Node.js](https://nodejs.org/) installed on your machine. You will also need API keys for the following services:
1. **Telegram Bot Token** – Get this from [@BotFather](https://t.me/botfather) on Telegram.
2. **Google Gemini API Key** – Get this from [Google AI Studio](https://aistudio.google.com/).
3. **Twelve Data API Key** – Get this from [Twelve Data](https://twelvedata.com/register) (required for US stock and Forex data).

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
   TWELVE_KEY=your_twelve_data_api_key_here
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

## 🎯 Usage

1. Open Telegram and start a chat with your bot.
2. Type `/start` to see the welcome message and capabilities.
3. Simply type the name of **any company, stock symbol, or forex pair**. Examples:
   - `Apple` or `AAPL` (US Stock)
   - `Reliance` or `RELIANCE.NS` (Indian Stock)
   - `EUR/USD` or `USDINR` (Forex)
   - `Gold` or `XAUUSD` (Commodity Forex)

The bot will execute the pipeline, block bad trades at the Quant Engine stage, or deploy the 3 AI Agents to provide a comprehensive, multi-layered trading report.

## ⚠️ Disclaimer

*MarketMindBot Pro provides purely AI-generated analyses based on real-time data inputs and common technical formulas. These analyses **do not constitute financial advice**. Always do your own research or consult a certified financial advisor before making any investment decisions. Skipping trades is a fundamental capital protection feature of this specific system architecture.*
