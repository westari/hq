# Seeker outreach

Emails businesses in DC and Miami every weekday morning, and reads their replies. No AI: it follows
exact rules (`rules.js`), like the Watchdog does. Runs on GitHub, so your PC can be off. Costs $0.

- `email.js` = the approved email, word for word
- `rules.js` = who gets emailed today, and what a reply means
- `config.json` = the switches (app name, upload link, live on/off, emails per day)
- The list of places is on the `outreach-data` branch (`places.json`). Claude adds places there.

## What it does each morning
1. Reads new replies. "Not interested" → Said no. A video file or a Drive/Dropbox link → Sent videos.
   Out-of-office → ignored. Anything else → Replied (you read it yourself). Our own email quoted
   at the bottom of a reply is ignored.
2. Sends new emails: 10 a day in week 1, then 20, 35, and 50 a day from week 4.
3. Skips any place with no email, no reason, or a blank that wasn't filled in.
4. Saves the updated list.

## Turn it on (once)
1. Make the app's Gmail. Turn on 2-Step Verification, then make an App password
   (myaccount.google.com/apppasswords).
2. github.com/westari/hq → Settings → Secrets and variables → Actions → add
   `GMAIL_ADDRESS` and `GMAIL_APP_PASSWORD`.
3. In `config.json`: fill in `uploadLink`, then set `"live": true`.

Until all three are done, every run is a practice run: it prints the emails and sends nothing.
Try one any time: Actions tab → Outreach emails → Run workflow.

## The Seeker app (on your PC)
Shows your places, who got emailed, who replied, and the morning runs. It reads and saves the list
straight from GitHub, so it's always up to date. The emails are still sent by GitHub, not your PC.

Set up once (in PowerShell):
```
cd "C:\Users\arize\hq"
git pull
powershell -ExecutionPolicy Bypass -File seeker\make-shortcut.ps1
```
Then double-click **Seeker** on your Desktop. It gets the newest version from GitHub each time it opens.
