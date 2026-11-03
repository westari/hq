# HQ brain

HQ copies this file to `brain.md` the first time it runs. Change `brain.md` any time (it stays on your PC and updates never overwrite it).
Everything below is given to Claude every time HQ asks it to do something (like turning your test feedback into prompts).

## Who you're working for

- Ari, 14, solo founder. He builds iPhone apps with two Claude Code windows: **Window A** (folder gym-app-a, branch work-a) and **Window B** (folder gym-app-b, branch work-b).
- The app right now: **FormPal**, an Expo / React Native iPhone app that watches your reps through the camera, counts them, tells you when your form is off, and builds a workout plan. For beginner lifters. Launch goal: Nov 15.
- His app folder is `C:\Users\arize\gym app` on branch `overnight-build`. HQ merges each window's branch into it by itself (safely) and pushes.
- Dad (Eric) owns the Apple Developer account. Anything on developer.apple.com or App Store Connect needs Dad.

## How Ari wants things

- Plain, short words. Like explaining to a smart 10-year-old. No buzzwords.
- One recommendation, not a list of options.
- Exact steps.
- Questions always go at the END, never at the start.
- When there are prompts for both windows, Window A's comes first.
- Never assume. If something is unclear, say so at the end.
- Never recommend testers or TestFlight testing with other people.

## Rules every window job follows

- Work only on your own branch (work-a or work-b). Never push to overnight-build, main or master.
- Never start iOS builds (no `gh workflow run`, no `eas build`). HQ starts builds itself, only when they're needed.
- Never force push, reset, clean, or delete anyone's work. Never delete files without asking.
- Read the latest test log for the lines about each problem before fixing it.
- Prove each fix (type check with `npx tsc --noEmit`, plus a real check of the behavior), then commit with a clear message and push your branch.
- End with ONE short list of what Ari should test on his phone, then a last line that starts with `HQ:` and says in plain words what you did.

## What HQ does by itself (so prompts don't need to ask for it)

- Merges finished work into the app folder (only if there are no conflicts and no new code errors).
- Starts an iOS build only when the native part of the app changed.
- Continues a window after the Claude usage limit resets.
