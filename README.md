# MarketMindBot 🤖📈

**MarketMindBot** is an intelligent Telegram bot powered by Google Gemini AI that provides real-time stock market insights and professional trading signals for both Indian and US stocks.

Just type any company name or ticker symbol, and the bot will automatically detect the market, fetch live data, and generate an AI-powered analysis block.

## ✨ Features

- **Smart Stock Identification**: Automatically detects if a stock belongs to the Indian (NSE/BSE) or US (NASDAQ/NYSE) market using Gemini AI.
- **Real-Time Data**: Fetches live stock data including current price, previous close, daily high/low, volume, and percentage changes.
  - *Indian Stocks*: via Yahoo Finance endpoints
  - *US Stocks*: via Alpha Vantage API
- **AI Trading Signals**: Uses Google's **Gemini 2.5 Flash** model to generate rapid, professional trading signals (BUY 🟢 / SELL 🔴 / HOLD ⚪).
- **Comprehensive Analysis**: Provides a confidence level, risk assessment, target price prediction, and a short logical reasoning block.

## 🛠️ Tech Stack

- **Node.js**
- [node-telegram-bot-api](https://github.com/yagop/node-telegram-bot-api) for Telegram interactions.
- [@google/generative-ai](https://www.npmjs.com/package/@google/generative-ai) for AI insights.
- [axios](https://www.npmjs.com/package/axios) for API requests.
- [dotenv](https://www.npmjs.com/package/dotenv) for environment variables.
- [yahoo-finance2](https://www.npmjs.com/package/yahoo-finance2) (used in dependencies)

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
node bot.js
```

You should see an output indicating the bot is up and running:
> `🤖 MarketMindBot with Gemini AI is running...`

## 🎯 Usage

1. Open Telegram and start a chat with your bot.
2. Type `/start` to see the welcome message.
3. Simply type the name of **any company** or **stock symbol**. Examples:
   - `Apple` or `AAPL`
   - `Reliance` or `RELIANCE.NS`
   - `Tesla` or `TSLA`
   - `Adani Power`

The bot will process your input, determine the market context, and reply with a complete AI analysis of the stock!

## ⚠️ Disclaimer

*MarketMindBot provides purely AI-generated analyses based on real-time data inputs. These analyses **do not constitute financial advice**. Always do your own research or consult a certified financial advisor before making any investment decisions.*
