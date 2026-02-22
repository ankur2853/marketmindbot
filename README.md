# MarketMindBot Pro 🤖📈

**MarketMindBot Pro** is a professional Telegram bot powered by **Google Gemini AI** and a custom **8-Gate Quantitative Trading Engine**. It delivers institutional-grade market analysis for Indian Stocks (NSE/BSE), US Stocks (NASDAQ/NYSE), and Forex currency pairs — including Gold.

Just type any company name, ticker symbol, or forex pair and the bot will:
1. **Identify** the asset and its market automatically.
2. **Fetch** 90 days of historical OHLCV price data.
3. **Filter** the trade through a rigorous 8-Gate Quant Engine.
4. **Analyse** with a unified Master AI Analyst (technicals + sentiment + risk in one decisive call).
5. **Deliver** a clear `BUY`, `HOLD`, or `SELL` verdict with target, stop-loss, and timeframe.

---

## ✨ Core Features

### ⚙️ 8-Gate Quantitative Engine
First line of defence — acts on raw data before any AI is involved:

| Gate | Purpose |
|------|---------|
| 1. Data Validation | Rejects incomplete or stale data |
| 2. Market Regime Detection | Classifies as Trending / Ranging / No-Trade |
| 3. Price Action Patterns | Detects Engulfing, Doji, Marubozu, Pin Bar, etc. |
| 4. Volume Confirmation | Filters signals on suspiciously low volume |
| 5. Probability Scoring | 0–100% conviction score |
| 6. No-Trade Suppression | Kills trades on inside bars, squeeze, choppy regimes |
| 7. ATR Risk/Reward | Auto-calculates entry, stop-loss, take-profit |
| 8. Final Signal | Outputs `BUY`, `SELL`, or `NO-TRADE` |

> If the engine returns `NO-TRADE`, the AI is **never** called. Saves API quota and protects capital.

### 🤖 Master AI Analyst (Gemini 2.5 Flash)
A single, unified Gemini prompt that thinks like a **senior quant trader** — combining all three dimensions in one holistic call:

- 📐 **Technical Layer** — RSI, MACD, SMA-20/50, Bollinger Bands, volume trend, indicator consensus
- 🌐 **Sentiment Layer** — sector health, macro environment, market mood (Risk-On / Risk-Off)
- 🛡️ **Risk Layer** — conservative decision rules, stop-loss discipline, key risk identification

One call. One expert. One decisive verdict.

### 📡 Data Sources
| Asset Class | Provider |
|-------------|----------|
| 🇮🇳 Indian Stocks | Yahoo Finance |
| 🇺🇸 US Stocks | Twelve Data API |
| 💱 Forex & Gold | Twelve Data API |

---

## 🛠️ Project Structure

```text
marketmindbot/
├── src/
│   ├── index.js                  # Entry point
│   ├── config/
│   │   └── env.js                # Environment variable validation
│   ├── api/
│   │   ├── twelvedata.js         # US Stocks & Forex data fetcher
│   │   └── yahoo.js              # Indian Stocks data fetcher
│   ├── services/
│   │   ├── tradingEngine.js      # 8-Gate Quantitative Engine
│   │   └── gemini.js             # Master AI Analyst & asset identification
│   └── bot/
│       ├── instance.js           # Telegram bot instance
│       └── handlers.js           # Message routing & response formatting
├── .env                          # API keys (not committed)
└── package.json
```

---

## 🚀 Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) v18+
- API keys for three services (see below)

### API Keys Required

| Service | Purpose | Link |
|---------|---------|------|
| Telegram Bot Token | Bot communication | [@BotFather](https://t.me/botfather) |
| Google Gemini API Key | Master AI Analyst | [Google AI Studio](https://aistudio.google.com/) |
| Twelve Data API Key | US Stocks & Forex data | [Twelve Data](https://twelvedata.com/register) |

> **Twelve Data free tier:** 8 requests/minute, 800/day. The bot respects this limit.

### Installation

```bash
# 1. Clone the repo
git clone https://github.com/your-username/marketmindbot.git
cd marketmindbot

# 2. Install dependencies
npm install

# 3. Create your .env file
cp .env.example .env   # or create manually
```

Add your keys to `.env`:

```env
TELEGRAM_TOKEN=your_telegram_bot_token_here
GEMINI_API_KEY=your_gemini_api_key_here
TWELVE_KEY=your_twelve_data_api_key_here
```

### Run

```bash
npm start
# or
node src/index.js
```

---

## 🎯 Usage

1. Open Telegram and start a chat with your bot.
2. Send `/start` to see the welcome message.
3. Type any stock or forex pair:

| Input | What it does |
|-------|-------------|
| `Apple` or `AAPL` | Analyses Apple (NASDAQ) |
| `Reliance` or `RELIANCE` | Analyses Reliance Industries (NSE) |
| `HDFCBANK` or `HDFC Bank` | Analyses HDFC Bank (NSE) |
| `EUR/USD` or `EURUSD` | Analyses Euro/Dollar forex |
| `Gold` or `XAUUSD` | Analyses Gold spot price |

### Sample Output

```
📊 Reliance Industries (RELIANCE)  🇮🇳
━━━━━━━━━━━━━━━━━━━
💰 Price: ₹2,430.15  📈 0.87%
🔺 H: ₹2,451.00  🔻 L: ₹2,410.25  📦 8,234,100

━━━━ ⚙️ QUANT ENGINE ━━━━
📊 Probability: ███████░░░ 72%
📈 Regime: Trending Bullish
🕯️ Pattern: Bullish Engulfing
💱 Entry: ₹2,430 | SL: ₹2,390 | TP: ₹2,520 | R:R 1:2.3

━━━━ 🤖 MASTER ANALYST ━━━━
📐 Technicals: RSI at 58 shows momentum without overbought risk...
🌐 Sector: Bullish | Mood: Risk-On
🏢 Company: Strong — market leader in energy & telecom
⚡ Key Risk: Crude oil price volatility

━━━━ 🛡️ FINAL VERDICT ━━━━
🟢 SIGNAL: BUY
🎯 Confidence: High | Risk: Low | ⏰ 5-10 days
🏹 Target: ₹2,520 | 🛡️ SL: ₹2,390
💡 Reason: Strong technicals align with bullish sector momentum...
```

---

## 🔧 Tech Stack

| Component | Technology |
|-----------|-----------|
| Runtime | Node.js (CommonJS) |
| Telegram API | `node-telegram-bot-api` |
| AI Model | Google Gemini 2.5 Flash (`@google/generative-ai`) |
| Indian Stock Data | `yahoo-finance2` |
| US/Forex Data | Twelve Data REST API (`axios`) |
| Technical Indicators | `technicalindicators` |
| Config | `dotenv` |

---

## ⚠️ Disclaimer

*MarketMindBot Pro provides AI-generated analyses based on real-time market data and technical formulas. These analyses **do not constitute financial advice**. Always conduct your own research or consult a certified financial advisor before making any investment decisions. Capital protection — including skipping low-conviction trades — is a core design principle of this system.*
