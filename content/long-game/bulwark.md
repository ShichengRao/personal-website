---
title: "Bulwark"
layout: "bulwark"
weight: 1
genre: "Bullet hell"
description: "A bullet hell rebuilt as a siege. The weather is slow and never aimed at you; the question is whether your structure holds."
blurb: "Slow, dense, unaimed bullets; streams and bastions that announce themselves seconds ahead. Click where to stand, drag where to build, and let the beam fire itself. A hit costs charge, not life."
slow: "build a canopy, stand in its shadow, let the walls pay for the beam."
fast: "stand under the boss where the weather is thickest and ride the heat."
date: 2026-09-19T20:00:00-04:00
draft: false
---

The first Bulwark had walls and a shield and a boss that read your style, and it was
still a bullet hell: delay every input in a good run by fifty milliseconds and the
run died. Everything that decided the fight happened in under a second, so nothing
built on top of that loop could outweigh it.

This one moves the whole fight onto a slower clock. The boss doesn't aim. It makes
**weather**: a steady drizzle of bullets that take eight to twelve seconds to cross
the arena, a **sweep** that wipes the sky and shows its line two seconds early, a
**stream** that marks its lane for three and a half seconds before it flows. From
phase two it sends **breakers** that crawl toward your walls, and raises
**bastions** between itself and wherever you stand, three seconds after showing you
where. You give it positions: a click is where to stand, a right-drag is where a
wall goes. The shield faces the boss on its own, and the beam fires itself.

**Charge** is the only economy. The shield pays four per bullet it absorbs but heats
up, and at full heat it drops for two and a half seconds. Walls pay one per bullet
from any side, never heat, and cost thirty to build. A hit costs charge; only when
you have none does it cost **integrity**, which never comes back. The beam costs
sixty and takes eight percent of the boss. After four minutes the sky closes and the
drizzle doubles every thirty seconds, so the structure has to be paying for the beam
by then.

**The slow way.** Build a canopy above where you stand and let its shadow keep the
drizzle off you. The boss's plan is to grind it: streams go for whichever wall earns
you the most, breakers try to demolish one, bastions take your beam until you walk
out from behind them. Whether the structure holds under that is the whole game, and
none of it is decided in under a second.

**The fast way.** Stand at the line under the boss, where the weather is thickest,
and take it on the shield: four charge a bullet, no walls to buy. The heat bar is
what you manage, and a stream you fail to step out of is twenty-five charge a hit.

Scripted runs of both, with every input delayed by five seconds: the canopy still
kills the boss in every run, the rusher dies in every run. Without the delay the
rusher is about a minute faster when it lives. That is the trade the page promises
on the hub, and this is the first version of the game that actually makes it.
