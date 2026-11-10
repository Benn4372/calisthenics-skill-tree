# Calisthenics Skill Tree

An interactive skill tree for bodyweight training. It shows progressions within each skill family (push, pull, planche, front lever, back lever, handstand and more) and how the families feed into each other.

**Live site:** https://benn4372.github.io/calisthenics-skill-tree/

It's a static site with no build step and no dependencies, so it runs on GitHub Pages as-is.

## How it works

- **Columns** are skill families. **Nodes** are skills, laid out top to bottom by difficulty.
- **Each skill has levels.** Level 1 is the bare minimum ("can do it"). Later levels are the reps or hold times that build toward the next skill. Completing every level marks a skill as mastered.
- **Solid lines** are hard prerequisites at a specific level. For example, Pseudo planche push-up requires Push-up at *10 reps*. A line turns green once you've met it.
- **Dashed lines** are carryover: the skill helps with another but isn't required (for example, back lever work helping planche). You can hide these with the toggle.
- Click a skill to log your level, see what it requires and what each level unlocks. Selecting a skill also highlights its full prerequisite chain.

Progress is stored in the browser's `localStorage`, so it's per browser and per device. Use **Export** and **Import** to back it up or move it.

## Run locally

Open `index.html` directly in a browser, or serve the folder:

```bash
python -m http.server 8000
```

Then visit http://localhost:8000.

## Deploy to GitHub Pages

1. Push this folder to a GitHub repository (the files should be at the repo root).
2. In the repository, go to **Settings → Pages**.
3. Under **Build and deployment**, choose **Deploy from a branch**, pick `main` and `/ (root)`, and save.
4. The site will be live at `https://<your-username>.github.io/<repo-name>/` after a minute or so.

## Editing the tree

All skills live in [`js/data.js`](js/data.js). Each skill looks like this:

```js
{ id: 'pppu', name: 'Pseudo planche push-up', family: 'push',
  tiers: ['1 rep', '5 reps', '10 reps'],
  requires: [['pushup', 3]],      // needs Push-up at its 3rd level (10 reps)
  carry: ['planche_lean'],        // Planche lean helps with this one
  cue: 'Hands by the hips, fingers turned out, lean forward the whole rep.' }
```

- `tiers`: levels from easiest to hardest. The first is "can do it" and the last is mastered.
- `requires`: `[skillId, level]` pairs. The level number is 1-based into that skill's `tiers`.
- `carry`: skills that help with this one but aren't required.
- Rows are computed from the prerequisites, so you don't position anything by hand.
- Problems such as unknown skill IDs or out-of-range levels are reported as warnings in the browser console.

Don't rename an existing `id` unless you're fine losing saved progress for that skill. Saved progress is keyed by `id`.

## Files

- `index.html`: page shell
- `style.css`: styles, including light and dark themes
- `js/data.js`: skills, levels and links
- `js/app.js`: layout, rendering, progress storage, pan and zoom
