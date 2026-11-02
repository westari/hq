# HQ

Your city dashboard as a real app on your PC. Works offline. Uses zero Claude tokens.

## Setup (once)

1. Close the old HQ (the PowerShell window that says "HQ is running").
2. Unzip this into `C:\Users\arize` (replace files).
3. Run:

```
cd "C:\Users\arize\hq"
npm install
powershell -ExecutionPolicy Bypass -File make-shortcut.ps1
```

4. Double-click **HQ** on your Desktop.

Hooks from before still work. You don't need to run install-hooks again.

## Updates

HQ updates itself from GitHub every time you open it. Nothing to download.

## Every day

Double-click **HQ**. It fills your screen. It talks out loud when a window is done, needs you, or is ready to test (turn sound off with the speaker button on the left).

- Top right buttons = minimize, smaller window, close. Drag the top middle of the screen to move it.
- **F11** = full screen on/off
- **F12** = error window (send me a screenshot if something breaks)
- **Ctrl+R** = reload

## What's real

- Aliens and cards = your real Window A and Window B.
- Test Lab = the "what to test" list from each window's last message.
- Pulse:
  - Claude usage = tokens in your current 5-hour window, from your chats.
    The % is compared to your busiest 5 hours so far, until you hit the real limit once. Then HQ learns your real limit.
  - TestFlight card = your GitHub builds. "New build" opens GitHub.
  - Crash free = errors in your last test log.
  - Code = real branches. "Copy merge" copies the merge commands.
- Output button (bottom left) = full output, summary, merge commands, logs.

## Sending a message to a window

- Window working: your message waits and sends itself when it finishes.
- Window done: HQ copies it. Paste it into that window in VS Code.
- Your latest test log is added automatically.

## Your plan (click Ari)

- Today's goals = what to finish today to launch FormPal by Nov 15. Click a goal to check it off.
- Skip a day and HQ spreads the leftover work over the days left. If you fall behind, it tells you.
- AI tasks have a "Send to Window" button that sends the full prompt.
- The plan lives in plan.json. Change it any time; HQ updates by itself. Your checkmarks are in plan-state.json.

## Not connected yet

Social follower counts (TikTok, Instagram, X, YouTube).

## New design from Claude Design

Export the standalone .html, then:

```
cd "C:\Users\arize\hq"
node update-design.js "C:\Users\arize\Downloads\HQ Mission Control.html"
```

Press Ctrl+R in HQ.

## Settings (hq.config.json)

- `windows`: folder name → window name
- `projects`: where each LAUNCH.md is
- `usageLimitTokens`: your real 5-hour limit, if you know it
- `allowPhone`: true to open HQ on your phone (same Wi-Fi)

## Turn hooks off

```
cd "C:\Users\arize\hq"
node install-hooks.js --remove
```
