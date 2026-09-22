---
title: "Scrabble Mod"
description: "A two-player word game on a 15×15 board with rebalanced tile values, an open bonus layout, and an ending where nobody loses points for what is left on the rack."
date: 2026-09-22T02:00:00-04:00
draft: false
---

The board, the bag and the scoring here follow the ruleset of the New York
Times' two-player word game, which I like better than classic Scrabble for a
few reasons: the tile values are rebalanced so the common letters are cheap and
the awkward consonants pay, the bonus squares sit where they open the board up
instead of walling it off, and the ending is fairer. Nothing else from that game
is here: not the app, not the look, not the name, and not its word list.

**Rules.** Each player holds 7 tiles from a bag of 100, including three blanks.
Words connect to what is on the board; the first covers the center. Letter
values add up, the coloured squares double or triple a letter or the whole
word, and playing all 7 tiles in one turn is a *sweep* worth 40 more. You can
swap any of your tiles instead of playing, which uses the turn, or pass. Once
the bag is empty each player gets one last turn and the higher score wins.
Leftover tiles do not count against you. If both players pass twice running,
the game ends there.

**Word list.** Plays are checked against ENABLE, the public-domain list most
hobby word games use, so a few words go through here that a stricter list would
refuse. I am working on a licence for the NASPA list; when that lands it drops
in as a file swap.

**Playing.** Click a square and type, or click a rack tile and then a square;
the arrow keys (or a second click on the cursor square) switch between across
and down. The score of what you have laid out shows as you go, and the board
turns green when it is a legal play. The bag button shows which tiles are still
unseen. The bot on
*hard* always plays the highest-scoring move it can find, which is a fair
picture of how much score is on the board each turn. The review at the end
compares each of your turns with the best play that was available. Every game
gets a three-word address like `/scrabble-mod/otter-slate-plum`. Games against
the bot and pass-and-play games are saved in this browser under that address;
online games live on a small database, and the private link in the side panel
opens your seat from another device.
