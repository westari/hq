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

## Starting iOS builds from HQ

Install the GitHub CLI once and log in:

```
cd "$HOME"
winget install --id GitHub.cli
gh auth login
```

Then Factory > Start build (or Pulse > New build) starts your iOS build.

## Claude inside HQ (✦ button or Ctrl+J)

Opens claude.ai on the right side of HQ: your same chats and the ATHLT project. Sign in once with **Continue with email** (Google sign-in is blocked inside apps by Google). The microphone button works there too. It uses your normal Claude plan, nothing extra. HQ never reads what's in it.

## Test Lab (talk, then send)

1. Test the app on your phone.
2. In Test Lab press **Talk** and say everything you found. (Whisper turns it into words on your PC: free, offline. First use downloads it, about 65 MB.)
3. Press **Make the prompts**. Claude (Sonnet, one short message from your plan) splits it into a Window A prompt and a Window B prompt, using what each window built and your test log.
4. Check them, fix anything, press **Send to the windows**. The UFO flies home.

HQ's rules for Claude live in `brain.md` (made from `brain.default.md`; change it any time).

## The Watchdog (the shield tower)

Plain code on your PC. No AI, no API key, no money. Every 20 seconds it checks everything and fixes what it safely can:

- **Merges** each window's finished work in a temporary copy first. Your app folder only changes if there are no conflicts, no `<<<<<<<` lines and no NEW TypeScript errors. Then it pushes.
- **Conflicts / broken lines / new code errors**: your app is never touched. The window that caused it gets one fix job (twice max), then it tells you.
- **Builds** start by themselves only when the native part changed (Expo fingerprint). Max 1 automatic build per commit, 6 per day. Apple signing and GitHub secret problems are never retried: it tells you exactly what to do.
- **Windows**: continues after the usage limit resets, retries Claude hiccups (1, 4, 15 min), tells you when a window waits for your OK or looks stuck. Weekly limit, login or billing problems pause everything.
- **Money**: HQ never lets Claude Code use an API key. If one is found on your PC, the Watchdog warns you. If a job tries to use one, it's stopped right away.
- **Safety rules** are added to each window folder (no force-push, no reset --hard, no starting builds) plus a Git check that blocks committing `<<<<<<<` lines.
- New version ready → the UFO flies to Test Lab.

Everything it does is in `watchdog-log.jsonl`. Set `"watchdog": { "mode": "watch" }` in hq.config.json to make it only say what it WOULD do. Tests: `npm test`.

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
