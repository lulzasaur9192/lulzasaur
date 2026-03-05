# Slack Integration Setup Guide

## Overview

The Slack integration uses **Socket Mode** (WebSocket connection) so no public URL or ngrok is needed.

## Setup Steps

### Step 1: Create a Slack App

1. Go to https://api.slack.com/apps
2. Click **Create New App** > **From scratch**
3. Name it (e.g. "Lulzasaur"), select your workspace
4. Click **Create App**

### Step 2: Get Signing Secret

1. On the **Basic Information** page, scroll to **App Credentials**
2. Click **Show** next to **Signing Secret**
3. Copy it — this is your `SLACK_SIGNING_SECRET`

### Step 3: Generate App-Level Token

1. Still on **Basic Information**, scroll to **App-Level Tokens**
2. Click **Generate Token and Scopes**
3. Name it `socket-mode`
4. Add scope: `connections:write`
5. Click **Generate**
6. Copy the `xapp-1-...` token — this is your `SLACK_APP_TOKEN`

### Step 4: Enable Socket Mode

1. In the left sidebar, click **Socket Mode**
2. Toggle **Enable Socket Mode** to **On**

### Step 5: Add Bot Token Scopes

1. In the left sidebar, click **OAuth & Permissions**
2. Scroll to **Bot Token Scopes**
3. Add these scopes:
   - `chat:write` — Send messages
   - `channels:history` — Read channel messages
   - `channels:read` — List channels
   - `app_mentions:read` — Respond to @mentions
   - `im:history` — Read DM messages
   - `im:read` — Open DMs
   - `im:write` — Send DMs

### Step 6: Subscribe to Events

1. In the left sidebar, click **Event Subscriptions**
2. Toggle **Enable Events** to **On**
3. Under **Subscribe to bot events**, add:
   - `message.im` — Triggers when someone DMs the bot
   - `app_mention` — Triggers when someone @mentions the bot in a channel

### Step 7: Install to Workspace

1. In the left sidebar, click **Install App**
2. Click **Install to Workspace**
3. Click **Allow** to authorize
4. Copy the **Bot User OAuth Token** (`xoxb-...`) — this is your `SLACK_BOT_TOKEN`

### Step 8: Configure Environment

Add to your `.env` file:

```bash
SLACK_BOT_TOKEN=xoxb-your-bot-token
SLACK_SIGNING_SECRET=your-signing-secret
SLACK_APP_TOKEN=xapp-1-your-app-token
SLACK_ALLOWED_CHANNELS=C07XXXXXXXX    # Optional: channel IDs for broadcast
```

To find a channel ID: right-click a channel in Slack > **View channel details** > the ID is at the bottom of the popup.

### Step 9: Invite the Bot

In Slack, invite the bot to any channels you want it in:
```
/invite @Lulzasaur
```

### Step 10: Start Lulzasaur

```bash
npm start
```

You should see `Slack connected` in the logs.

## How It Works

```
┌─────────────────┐
│     Slack        │
│   (Your App)     │
└────────┬────────┘
         │
         │ Socket Mode (WebSocket)
         │
┌────────▼────────┐
│  Slack Adapter   │◄──── Auto-starts if tokens present
│   (slack.ts)     │
└────────┬────────┘
         │
         │ Registers with notification system
         │
┌────────▼────────┐
│  message_user    │◄──── All agents can send messages
│      Tool        │
└────────┬────────┘
         │
         │ Broadcasts to all interfaces
         │
┌────────▼──────┬──────┬───────┐
│      CLI      │  Web │ Slack │
└───────────────┴──────┴───────┘
```

## Usage

### Chatting with the Bot

**DM the bot** — just send a message directly:
```
What tasks are currently in progress?
```

**@mention in a channel** — the bot responds to mentions:
```
@Lulzasaur summarize the current project status
```

### Receiving Agent Notifications

When any agent uses `message_user`, you get a Slack message:
```
[Proposal] *research-agent* (proposal)

I found a more efficient algorithm for the data processing task.
Would you like me to implement it?
```

### Approving/Rejecting Tasks

When an agent requests review:
```
*Review Requested*

*Implement new feature X*
Feature implemented with tests

_Evidence: All 15 tests passing, deployed to staging_

Reply with `approve 4aea655c` or `reject 4aea655c <feedback>`
```

Reply in Slack:
```
approve 4aea655c
```

Or:
```
reject 4aea655c Please add error handling for edge case Y
```

## Configuration

### Broadcast Channels

`SLACK_ALLOWED_CHANNELS` controls where unsolicited agent messages go (notifications, review requests). Comma-separated channel IDs:

```bash
SLACK_ALLOWED_CHANNELS=C07ABC123,C07DEF456
```

If empty, the bot can still respond to DMs and mentions but won't proactively send messages.

### Multiple Interfaces

Slack works alongside all other interfaces. When an agent sends a message, it goes to CLI + Web + Slack simultaneously.

## Troubleshooting

### Bot doesn't respond to DMs

**Cause**: Missing `message.im` event subscription

**Solution**: Go to **Event Subscriptions** > **Subscribe to bot events** > add `message.im`

### Bot doesn't respond to @mentions

**Cause**: Missing `app_mention` event subscription or bot not in channel

**Solution**: Add `app_mention` to bot events, and `/invite @YourBot` in the channel

### "not_authed" or "invalid_auth" errors

**Cause**: Token mismatch or expired tokens

**Solution**: Reinstall the app (**Install App** > **Reinstall to Workspace**) and update `SLACK_BOT_TOKEN`

### Bot connects but no messages arrive

**Cause**: Socket Mode not enabled

**Solution**: Go to **Socket Mode** and ensure the toggle is **On**

### "missing_scope" errors

**Cause**: Bot token scopes not added

**Solution**: Add all required scopes under **OAuth & Permissions** > **Bot Token Scopes**, then reinstall the app

## Source Code

- **Slack Adapter**: `src/interfaces/chat-adapters/slack.ts`
- **System Integration**: `src/index.ts`
- **Notification System**: `src/tools/built-in/message-user.ts`
- **Review System**: `src/tools/built-in/request-review.ts`
- **Config Schema**: `src/config/index.ts`
