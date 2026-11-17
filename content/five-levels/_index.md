---
title: "This Site in Five Levels"
description: "This site explained five times, from what a website is to how its DNS and routing work. Each level goes deeper than the last."
lede: "The same site, explained five times. Each level goes deeper than the last."
date: 2026-11-16T09:00:00-05:00
draft: false
levels:
  - topic: "The basics"
    asks: "What is this?"
  - topic: "The projects"
    asks: "What's here, and where do I start?"
  - topic: "The code"
    asks: "What's it written in, and how does a change get made?"
  - topic: "Deploys and hosting"
    asks: "How is GitHub hooked up, and where does the site live?"
  - topic: "DNS and the network"
    asks: "Is the zone signed, how do packets get here, and what happens when someone floods it?"
    facts:
      - k: "Registrar"
        v: "Porkbun"
      - k: "Nameservers"
        v: "Netlify DNS, run on NS1. Anycast, AS62597."
      - k: "Apex and www"
        v: "A and AAAA, steered by location"
      - k: "Edge"
        v: "Netlify on AWS EC2, AS14618"
      - k: "TLS"
        v: "1.2 and 1.3. ECDSA P-256, Let's Encrypt wildcard."
      - k: "HTTP"
        v: "HTTP/2 over ALPN"
      - k: "HSTS"
        v: "One year, `includeSubDomains`"
      - k: "CAA"
        v: "Let's Encrypt only"
      - k: "Mail"
        v: "MX at ImprovMX"
      - k: "DMARC"
        v: "`p=reject`"
---

{{< level 1 >}}
This is my website. It's my own little spot on the internet, where I put games and other things I've made.

Think about a Roblox game. Somebody built it, and Roblox keeps it running so you can jump in from your phone. My site is kind of like that. I build things on my computer. Then a company called Netlify keeps copies on computers all over the world. When you open shichengrao.com, the one closest to you sends the page to your phone.

Two things you could try:

- **[Seven Tiles](/seven-tiles/)** is a word game. You get seven letters and make words on a board. You can play against a robot and pick how good it is, from 0 to 100.
- **[Hangul Practice](/hangul/)** teaches you to read Korean. You hear a word and pick how it's spelled.

On a phone you can add Seven Tiles to your home screen, and then it opens like an app.
{{< /level >}}

{{< level 2 >}}
Everything runs in the browser, on a phone or a computer. There's nothing to install and you don't need an account. The [homepage](/) has a card for each project, and the menu at the top goes to the same places.

### On this site

- **[Seven Tiles](/seven-tiles/).** A word game for two. You can play the bot, pass one phone back and forth, or send a friend a link to an online game. Same Rack is the group mode, where everyone gets the same letters each round. After a game, the review shows the best play for every turn. I'd start with a bot game. Its level goes from 0 to 100.
- **[Don't Blunder Again](/dont-blunder-again/).** 2,939 chess positions where I blundered in my own games. You play a move, and it tells you whether you repeated my blunder, played something else that's still worse, or held the position. In more than half of them there's no winning trick to find, only a move that keeps the game going.
- **[Hangul Practice](/hangul/).** For learning to read and hear Korean. Hear a word and pick how it's written, or read one aloud and check yourself against the recording. It covers common words, phrases and the sound changes that final consonants cause.
- **[Eval Bar](/evalbar/).** The eval bar from chess streams, for the official Pokémon VGC broadcasts. It shows each side's chance to win and the best options for each Pokémon, turn by turn. When nothing is live it shows the games from the last broadcast. It's unofficial.
- **[Said & Done](/said-and-done/).** A benchmark I built. Coding agents sometimes say they finished a task when they didn't. Said & Done tests Reflection's Beam and other models on 28 tasks built to tempt that. Checks I built around Beam cut its false "complete" reports from 25 of 56 runs to 7.

### On their own sites

- **[Vine](https://vine-learning-app.vercel.app/vine-app).** The app for Vine, a community tutoring program in Kips Bay. Students practice English and math, and tutors and parents follow along.
- **[DeskBooks](https://deskbooks-demo.vercel.app).** A personal finance app that keeps your data on your own computer. The demo is read-only and runs on made-up data.
- **[Harvest NYC](https://www.harvest-nyc.com/).** The website for Harvest, a bilingual ministry of Remnant Church NYC. It has service times, the Sunday livestream, events and a Spanish version.
{{< /level >}}

{{< level 3 >}}
### The repo

The code is public at [github.com/ShichengRao/personal-website](https://github.com/ShichengRao/personal-website). Clone it with `--recurse-submodules` and run `hugo server`, and the site comes up at localhost:1313. You don't need npm to build it.

### The stack

The site is built with [Hugo](https://gohugo.io/), a static site generator written in Go. Each page is a Markdown file with a bit of YAML at the top. Hugo runs them through Go templates and writes out plain HTML. The look comes from a theme called Ananke, pulled in as a git submodule. When I want something different, I copy the theme's template into `layouts/` and change my copy. The theme itself stays untouched.

The apps are plain JavaScript with no framework and no build step. Each one is a few script files in `static/` that the browser loads as they are. GitHub counts the repo as a bit under half JavaScript and about a third HTML. Most of the rest is Python, for a prototype that goes with Said & Done.

### Where the backend is

Almost every page is a static file. Four things need a server.

- **Seven Tiles online games.** These use Supabase, which is hosted Postgres with sign-in built in. The browser calls Postgres functions through Supabase's API, and row-level security guards the tables. The whole schema is one SQL file in `plans/`.

  Each game is stored as its random seed and its list of moves, and nothing else. The board, the scores and whose turn it is all get rebuilt by replaying the moves through the same rules file the page uses. That file has no DOM code in it, so it runs in Node too, and the tests use it directly.

- **Turn notifications.** When a move is saved, the database calls a small Netlify Function, `push.mjs`. It sends a web push to the player whose turn it is.
- **The Eval Bar's data.** A separate project on my Mac follows the broadcast and uploads each game through another function, `evalbar.mts`. The function keeps it in Netlify Blobs, a key-value store.
- **The Resume.** The resume is a Google Doc published to the web. A third function, `resume.mjs`, fetches it and passes its content to the page. The CDN keeps a copy for five minutes, so editing the doc updates the page without a deploy.

### Tests and CI

The tests use Node's built-in test runner, with no test framework. They check the Seven Tiles scoring and move generator, that saved games replay the same way, and that the Said & Done data has the fields its page reads. GitHub Actions runs them on every pull request, along with a full Hugo build.

### How a change gets made

Every change goes through a pull request. Most of the work here was done with AI coding agents, mostly Claude Code and lately Codex too. The agent works on a branch and opens the PR. Merging is up to me. About three in four commits in the history list Claude as a co-author.

Only one PR is open at a time, and unrelated changes ride along on whichever one is open. The reason is money, and the next level covers it.
{{< /level >}}

{{< level 4 >}}
### From push to page

1. **A PR is opened.** Netlify's GitHub App is installed on the repo, so Netlify hears about it right away. It builds the branch and posts a deploy preview at `deploy-preview-<n>--shichengrao.netlify.app`. It also adds checks to the PR for the header and redirect rules. GitHub Actions runs the tests and its own build at the same time.
2. **The PR is merged.** The push to `main` starts a production build. Only `main` goes to production, and branch deploys are off.
3. **Netlify builds it.** The build clones the repo with the theme submodule and runs `hugo`, at the version pinned in `netlify.toml`. It bundles the three functions with esbuild.
4. **The deploy goes live all at once.** Hugo's output folder, `public/`, is uploaded as a new deploy. Visitors keep getting the old one until every file is up, then the whole site switches. Rolling back means publishing an older deploy, which takes one click.
5. **The CDN serves it.** HTML goes out with `max-age=0, must-revalidate` and an ETag. Each deploy clears the CDN's cache, so nobody sees a stale page after a merge.

`netlify.toml` also sets security headers on every response and holds the redirects. Old addresses get 301s. Seven Tiles uses a 200 rewrite, so `/seven-tiles/otter-slate-plum` serves the game page, which reads the game's id from the path.

### The domain

The domain is registered at Porkbun, and its nameservers point to Netlify DNS. With Netlify running the zone, most of the setup happened on its own. Netlify answers for the bare domain with edge servers near the visitor and sends `www` to the bare domain. It also got a Let's Encrypt certificate that covers the domain and every subdomain, and it renews it. The MX and SPF records send mail for contact@shichengrao.com through ImprovMX, which forwards it to a regular inbox.

### Who hosts what

- **Netlify:** the site, its three functions, and the Eval Bar's data in Blobs.
- **Supabase:** Seven Tiles accounts and online games.
- **Vercel:** Vine and DeskBooks, which are separate apps the homepage links to.

### What it costs

The site runs on Netlify's free plan. It gives 300 credits a month, and when they're gone the site is paused until the next month. You can't buy more. A production deploy costs 15 credits, so merges to `main` are the big expense, at most 20 a month even if nothing else used credits. Deploy previews are free. That's the reason for one open PR at a time.

Some things are set up so they never need a deploy. The Eval Bar uploads its games to Blobs instead of committing them, so a new broadcast costs nothing. The Resume page reads the published Google Doc, so editing the resume doesn't need a deploy either.
{{< /level >}}

{{< level 5 >}}
Checked from New York on November 16, 2026.

### Is the zone signed?

No. Netlify DNS doesn't sign zones. Signing would mean moving the zone to a DNS host that does, keeping Netlify for HTTP, and adding the DS at Porkbun. That move would cost the location-steered answers below. With outside DNS, Netlify has you point the apex at one load-balancer address, 75.2.60.5.

TLS covers most of what signing would. A spoofed answer can send a visitor to the wrong server, but that server can't show a valid certificate for this name. HSTS keeps returning browsers off plain HTTP. The CAA record lets only Let's Encrypt issue a certificate for the domain.

### How do packets get here?

The DNS is anycast, served by NS1 from two IPv4 /24s and two IPv6 prefixes. The web traffic isn't anycast. NS1 answers each lookup with the nearest Netlify edge, going by the resolver's address, or by the client subnet when the resolver sends one. It steers the IPv4 and IPv6 answers the same way. The TTLs are short, 120 seconds for A and 311 for AAAA, so the steering can move quickly. From there it's Amazon's network, AS14618, to the edge server.

Send a different client subnet and the region changes.

```
dig +short shichengrao.com @dns1.p02.nsone.net +subnet=195.66.224.0/24
```

| Subnet in | Edge region |
| --- | --- |
| New York | us-east-1 |
| San Francisco | us-west-1 |
| London | eu-central-1 |
| São Paulo | sa-east-1 |
| Tokyo | ap-southeast-1 |
| Australia | ap-southeast-2 |

### What happens when someone floods it?

The pages are static files on Netlify's CDN. A volumetric flood lands on Netlify's edge, inside Amazon, and Netlify says it has DDoS protection built in. The dynamic paths are narrow. The push function only takes a POST with a shared secret. The Eval Bar API takes writes only with a bearer token, and the CDN holds its reads for 10 seconds, so a flood of reads mostly hits cache. Seven Tiles talks to Supabase, which has its own limits.
{{< /level >}}
