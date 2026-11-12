# Better grammar checking with LanguageTool

CaretFlow checks English offline with [Harper](https://writewithharper.com), and other languages
with downloaded Hunspell dictionaries (spelling only). For full grammar and style checking in 30+
languages, switch the checker to [LanguageTool](https://languagetool.org) in
**Preferences → Writing → Checker**. There are four ways to run it, all but the last free:

| | Limits | Your text goes to | Setup |
| --- | --- | --- | --- |
| **Public server** (default) | About 20 checks a minute, 20 KB each; fewer rules | languagetool.org | None |
| **Advanced Grammar extension** | None | Stays on this computer | One click (downloads about 300 MB) |
| **Docker on this computer** | None | Stays on this computer | One command |
| **LanguageTool Premium** | None; all Premium rules | languagetool.org | Username and API key |

## Advanced Grammar (the easy way)

Install **Advanced Grammar** in Preferences → Extensions (Windows and Linux). Its Preferences page
downloads LanguageTool from languagetool.org and a Java runtime from adoptium.net (about 300 MB
together), and **Use for Checking** switches the checker to it. From then on CaretFlow:

- starts LanguageTool in the background when you write (a few seconds; Harper checks meanwhile),
- stops it after 15 minutes without checking (Preferences → Advanced Grammar can turn this off),
- stops it when CaretFlow closes.

It uses about 0.5–1 GB of memory while it runs; the **Memory** setting is the upper limit.
**Remove** deletes everything it downloaded.

## Docker

With [Docker](https://www.docker.com/) installed:

```bash
docker run -d --name languagetool -p 8081:8010 --restart unless-stopped erikvl87/languagetool
```

Then pick **On this computer (Docker, port 8081)** as the LanguageTool server in
Preferences → Writing. The container starts with your computer and needs no further care.

## N-gram data: catch confused words

LanguageTool gets noticeably better with its n-gram data: statistics from large amounts of text
that catch words that are spelled right but wrong in context (*their/there*, *then/than*,
*advice/advise*, *seit/seid*, *das/dass*). The data is available for English (9 GB), German
(1.7 GB), French (1.8 GB), Spanish (1.7 GB) and Dutch (1.2 GB). It is read from disk, so it needs
space more than memory.

- **Advanced Grammar:** download it per language on its Preferences page.
- **Docker:** download a file from <https://languagetool.org/download/ngram-data/>, unpack it into
  a folder (for example `~/ngrams/en`) and start the container with that folder:

  ```bash
  docker run -d --name languagetool -p 8081:8010 --restart unless-stopped -e langtool_languageModel=/ngrams -v ~/ngrams:/ngrams erikvl87/languagetool
  ```

## Premium

With a [LanguageTool Premium](https://languagetool.org/premium) account, enter your username (the
email address) and API key (languagetool.org → Account → API access) in Preferences → Writing. The
key is stored on this computer only, outside the editor's settings. CaretFlow then checks on
Premium's server with all Premium rules.
