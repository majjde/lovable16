# LOVABLE Telegram License Key Bot

A simple Telegram Bot for generating **LOVABLE** 12-character formatted license keys (`LOVE-XXXX-XXXX`).

## Features
- Interactive inline keyboard to select license duration (30, 90, 180, 365 days).
- Custom numeric day input support.
- Formatted 12-character license key output (`LOVE-XXXX-XXXX`).

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```

2. Configure environment variables:
   Copy `.env.example` to `.env` and insert your Telegram Bot Token from [@BotFather](https://t.me/BotFather):
   ```bash
   cp .env.example .env
   ```

3. Run the bot:
   ```bash
   npm start
   ```
