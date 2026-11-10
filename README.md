# Calisthenics Skill Tree

An interactive skill tree for bodyweight training. It grows from a single Start node into five branches (Legs, Push, Balance, Core and Pull), with over 100 skills and two dozen golden milestone achievements. It shows the progressions along each branch, such as push-ups to planche or pull-ups to front lever, and how the branches feed into each other.

**Live site:** https://benn4372.github.io/calisthenics-skill-tree/

It's a static site with no build step and no dependencies, so it runs on GitHub Pages as-is.

## How it works

- **The tree grows upward.** Start sits at the bottom. It splits into five branch bases, and each skill grows out of the one below it. Higher up means more prerequisites deep.
- **Each skill is a circle with a progress ring.** The ring has one segment per level. Level 1 is the bare minimum ("can do it"). Later levels are the reps or hold times that build toward the next skill. Filling every segment marks the skill as mastered.
- **Milestones** are the big achievement skills, such as the pistol squat, L-sit, freestanding handstand, muscle-up, front lever, planche and human flag. They're larger circles with a dashed gold outline, so you can see your goals from a distance. As soon as you can do one (level 1), it gets a golden cover and you get an "Achievement unlocked" message. Some milestones lead on to even harder skills. The overview panel tracks your achievements, and the header shows how many you've unlocked.
- **Thick coloured lines** are the branches themselves. Each one is a prerequisite at a specific level: for example, Pseudo planche push-up grows out of Push-up and needs *10 reps*. A branch line lights up once the skill it leads to is unlocked.
- **Thin lines** are extra prerequisites, often from another branch. For example, Tuck front lever grows on the Pull branch but also needs a Hollow body hold from Core.
- **Dashed lines** are carryover: the skill helps with another but isn't required (for example, back lever work helping planche). You can hide these with the toggle.
- **Click a skill** to log your level and see what it requires and what each level unlocks. Selecting a skill highlights its full route back to Start. Clicking a branch base lists that branch's skills and progress. Clicking Start shows the overview.

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

Branches and skills live in [`js/data.js`](js/data.js). Each skill looks like this:

```js
{ id: 'pppu', name: 'Pseudo planche push-up', branch: 'push',
  tiers: ['1 rep', '5 reps', '10 reps'],
  requires: [['pushup', 3]],      // needs Push-up at its 3rd level (10 reps)
  carry: ['planche_lean'],        // Planche lean helps with this one
  cue: 'Hands by the hips, fingers turned out, lean forward the whole rep.' }
```

- `branch`: which branch it grows on (`legs`, `push`, `balance`, `core` or `pull`).
- `tiers`: levels from easiest to hardest. The first is "can do it" and the last is mastered.
- `requires`: `[skillId, level]` pairs. The level number is 1-based into that skill's `tiers`. The first prerequisite on the same branch is the skill this one grows out of (the thick line). Any others become thin cross-links. With no same-branch prerequisite, the skill grows straight from the branch base.
- `parent` (optional): overrides which skill it grows out of.
- `milestone` (optional): `true` marks a big achievement skill that turns gold once you can do it.
- `carry`: skills that help with this one but aren't required.
- Positions are computed automatically. Height comes from prerequisite depth and spread comes from the tree shape, so you don't position anything by hand. Within a branch, skills appear left to right in the order they're listed.
- Problems such as unknown skill IDs or out-of-range levels are reported as warnings in the browser console.

Don't rename an existing `id` unless you're fine losing saved progress for that skill. Saved progress is keyed by `id`.

## Files

- `index.html`: page shell
- `style.css`: styles, including light and dark themes
- `js/data.js`: skills, levels and links
- `js/app.js`: layout, rendering, progress storage, pan and zoom
