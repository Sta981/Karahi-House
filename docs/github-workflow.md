# GitHub updates

Repository: https://github.com/Sta981/Karahi-House

Render deployment is on hold. This repository backs up the current source and ongoing improvements; pushing does not deploy a server.

The development repository retains its local history, frozen evaluation files and hidden configuration. **Do not push its branches directly.** `npm run github:push` creates ordinary incremental commits in a separate publication repository under ignored `.data/github-publication`, then pushes that repository's `main` branch. Its first commit is a clean current snapshot, so old private history never leaves the laptop. Nothing is force-pushed.

After completing and validating a change:

1. Commit the intended files in the development repository. Avoid `git add .`.
2. Run `npm run github:check` to check the tracked source allowlist and scan credentials without displaying values.
3. Run `npm run github:push`. It requires a clean source repository, scans the staged export again and verifies the remote commit after pushing.

The push command is run when work is completed in a session; no unattended daily task is installed. A day with no changes needs no commit.

Published: application/engine/voice source, package lock, approved menu and separate aliases, development fixtures, scripts, documentation, blank real-mic results sheet and fixed synthetic template clips.

Excluded: every dotfile/dot-directory (including `.env.example`, `.gitignore`, `.gitattributes`), all `.env.local`/`.data` data, original held-out/burned inputs, graders, evaluation output/archive folders, recordings, completed CSVs and the old Git history. The visible `env.example` contains empty placeholders only. It is not a credential file. Fixed synthetic PCM clips are application assets, not caller recordings.

For a fresh clone, copy `env.example` to private `.env.local`. Since dotfiles are intentionally absent from GitHub, add local-only exclusions before using Git locally: put `.*`, `node_modules/`, `*.tsbuildinfo` and `next-env.d.ts` on separate lines in `.git/info/exclude`. This covers every `.next*` cache too. Next regenerates `next-env.d.ts` with routing types for the current cache; it is not committed. This exclusion file stays local. Never stage private runtime data; use the filtered publication command for updates.

Portable checks: `npm run menu:check`, `npm run test:live`, `npm run test:voice`, `npm run typecheck`, `npm run build`. Historical/full evaluation commands require the original private development history and fixtures; they are not promised to run in the filtered snapshot. Hidden-test expectations and grading rules are not changed by this workflow.
