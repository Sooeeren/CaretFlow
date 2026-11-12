# Privacy Policy

*Last updated: 12 November 2026*

This policy covers the CaretFlow app (Windows, Linux, Android), its extensions (including the
**CaretFlow Discord application** used by Discord Status), and the website
[caretflow.vercel.app](https://caretflow.vercel.app/) with its browser version of the editor.

## In short

- CaretFlow has **no servers and no accounts**. The maintainer never receives your documents,
  settings or any personal data.
- There is **no telemetry**: no usage statistics, crash reports or analytics in the app.
- The app goes online only for features **you turn on**, and then talks directly to the service
  you chose. Each case is listed below.

## What stays on your device

Your documents, settings, recent files, custom dictionary words, drafts, AI usage counters and
caches are stored on your device only. Passwords and API keys you enter are kept in `secrets.json`
in CaretFlow's config folder, readable only by your user account. See
[NOTES.md](NOTES.md#where-things-are-stored) for the exact places. Uninstalling the app and deleting
those folders removes everything.

## When the app connects to the internet

| Feature | When | What is sent, and to whom |
| --- | --- | --- |
| Update check | Only after you agree, or when you pick Help → Check for Updates | A request to GitHub for the latest version file. No data about you or your documents. |
| Spelling dictionaries for other languages | When you choose to download one | A download from cdn.jsdelivr.net. Checking itself then runs offline. |
| LanguageTool (online) | Only if you turn it on | The text being checked goes to the LanguageTool server you configure (by default languagetool.org, run by LanguageTooler GmbH, under [their privacy policy](https://languagetool.org/legal/privacy)). |
| Advanced Grammar | When you install it | Downloads LanguageTool from languagetool.org and a Java runtime from adoptium.net. Checking then runs on your computer; your text is not sent anywhere. |
| AI Writing Help | Only if you install it and add a provider | The paragraphs being checked go to the AI provider you pick (for example Anthropic or OpenAI), under that provider's terms, within limits you set. With a local model (Ollama, LM Studio) nothing leaves your computer. |
| Cloud Sync | Only if you install and set it up | Files in your sync folder are uploaded to the WebDAV server, S3 storage or rclone remote you configured, and nowhere else. |
| Discord Status | Only if you install it and Discord is running | See below. |

The default spelling and grammar checker (Harper) never sends anything. The MCP server, when you turn
it on, listens on this computer only (`127.0.0.1`) and needs a token.

## Discord Status

The Discord Status extension sends your activity to the **Discord app running on your own
computer**, over Discord's local connection (a named pipe or socket). CaretFlow does not contact
Discord's servers itself, and the CaretFlow Discord application does not use a bot, OAuth, or
access to your Discord account, messages or servers.

What is sent: whether you are writing, reading or idle, the CaretFlow version and logo, and, only
if you turn them on, the word count, the editing mode, the time spent and a "Get CaretFlow" button.
The **file name is not sent** unless you turn on "Show the file name". The text of your documents is
never sent.

Discord then shows this status on your profile to the people who can see your activity, as
described in [Discord's privacy policy](https://discord.com/privacy). You can hide it there with
Discord's activity privacy settings, or by removing the extension in CaretFlow.

## The website

The website and the browser version of the editor set no cookies. The page remembers your chosen
theme, and the browser version keeps your files, in your browser's local storage; they never leave
your browser. The site is hosted on Vercel, which keeps standard server logs, and uses Vercel Web
Analytics to count page views anonymously (no cookies, no cross-site tracking). See
[Vercel's privacy policy](https://vercel.com/legal/privacy-policy).

## Children

CaretFlow collects no personal data from anyone, including children.

## Changes

If this policy changes, the new version is published here with a new date. The history of this file
on GitHub shows every change.

## Contact

Questions or concerns: open an issue at
[github.com/Sooeeren/CaretFlow/issues](https://github.com/Sooeeren/CaretFlow/issues).
