---
title: "Crux"
layout: "crux"
weight: 3
genre: "Platformer"
description: "A climb you plan before you make it. Holds, stamina and hazards on a beat clock; the route is the whole game."
blurb: "A wall of holds and a beat clock. Rocks fall and gusts blow on beats you can read in advance. Build the route with clicks, then watch the climber follow it exactly."
slow: "static moves, rests on the ledges, wait out the rock, never fall."
fast: "dynos two holds at a time and a plan that spends every point of stamina."
date: 2026-09-19T20:00:00-04:00
draft: false
---

The first Crux was a real-time climber with a stamina bar, and a fair test showed
what it was: a platformer. Delay every input in a good run by a quarter of a second
and it still summits; delay them by one second and it falls. The plan mattered less
than the fingers.

This one has no fingers. The wall is a grid of holds, time is a **beat**, and the
route is built before anyone moves. Every step of the plan is one beat: a static
move to a touching hold, a dyno to a hold two away, or a wait. Each has a stamina
price that is printed on the page and computed as you plan, so the panel always says
where you'd be, when, and with how much left. The hazards run on the same clock:
each rock chute drops on a published cadence, each wind band gusts on its own, and
the wall always shows you the hazards of the beat your next click would take. A
pocket is safe from rock. A crumbling hold can't be waited on and is gone once you
leave it. Press **Climb** and the climber follows the plan exactly; if the plan
falls, you see where and why, and the route is kept up to that point so you can
trim it and try again.

**Par** is the fewest beats any plan can reach the anchor in; a solver computes it
for every wall, including the random ones. The six set walls add one idea at a time
(stamina, then a chute, then wind across a gap only a dyno crosses, then crumbling
shortcuts and long runs between rests), and the bests are kept per wall.

**The slow way.** Static moves only, a rest on every ledge, a beat or two in a pocket
while the rock goes by. It costs beats and it never falls.

**The fast way.** Dynos cover two holds in a beat for twenty stamina, so a plan built
around them arrives with the tank nearly empty and no room to wait. The wall gates
it: a gust beat blows a dyno off, a rock beat clears the column, and a crimp costs
five a beat just to hang on while you wait for either to pass. The fastest plan on
most walls is a mix, and finding it is the puzzle.

The delay test that sank the first version passes trivially here: a plan doesn't
care when it was clicked.
