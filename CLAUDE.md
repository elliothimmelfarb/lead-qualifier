# lead-qualifier

Reference architecture for AI lead qualification. Fictional domain: **Summit
Trails**, an adventure-tour operator qualifying inbound trip inquiries.

The organising idea: **the agent converses, deterministic code decides.**

## Commands

| Command | What it does |
| --- | --- |
| `npm install` | Install deps. Node 22+. |
| `npm run provision` | Validate `agents/qualifier.agent.yaml` and write the lock. Run after any agent edit. |
| `npm run provision:check` | Validate only; non-zero exit if the lock is stale. CI runs this. |
| `npm run typecheck` | `tsc --noEmit`, strict. |
| `npm test` | Unit tests (`test/`) + persona integration suite (`sim/`). |
| `npm run demo` | Play one persona and print the annotated transcript. |
| `npm run demo -- --list` | List personas and expected verdicts. |
| `npm run demo -- <persona>` | Play a specific persona. |
| `npm run demo -- --live <persona>` | Same, against the real model (needs `ANTHROPIC_API_KEY`). |

Everything except `--live` runs with zero credentials.

## Architecture map

```
agents/
  qualifier.agent.yaml     agent as a versioned artifact (model, temp, version)
  prompts/qualifier.system.md   the system prompt, reviewable as prose
  qualifier.lock.json      written by provision; the app checks it at startup
scripts/provision.ts       validate + lock
src/
  domain/
    types.ts               LeadFields, Verdict, GuardDecision - vocabulary only
    qualification.ts       THE GUARD. Pure. No clock, no I/O. Read this first.
  agent/
    spec.ts                zod schema + loader; refuses unvalidated versions
    model.ts               QualifierModel interface + reply schema
    anthropicModel.ts      real model call (claude-sonnet-5)
    mockModel.ts           deterministic scripted stand-in
    session.ts             session-per-lead turn loop; wires model -> guard -> store
  store/
    index.ts               Store interface + InMemoryStore (default)
    redis.ts               commented Redis sketch, proving the seam
  demo.ts                  console demo
sim/
  personas/index.ts        8 personas as data, with expected verdicts
  runner.ts                plays a persona against the real session + guard
  personas.test.ts         asserts the guard's verdict per persona
test/                      unit tests: guard, session, spec, store
```

## Rules of the road

- **Business rules live in `src/domain/qualification.ts`, never in the prompt.**
  A number in a prompt is a suggestion; a number in code is a rule.
- **The guard is pure.** It takes `today` as an argument. Do not introduce
  `Date.now()`, I/O, or SDK types into `domain/`.
- **The model can narrow, never widen.** A proposal may decline a lead the rules
  would allow. No proposal can qualify a lead the rules reject.
- **Overrides go back into the transcript** (`overrideNote`), so the model's next
  turn is grounded in what the code decided.
- **Edit the agent, then run `npm run provision`** and commit the lock. Bump
  `version` in the YAML for any semantic change.
- **New behaviour gets a persona.** Personas are data; adding one is a few lines
  in `sim/personas/index.ts` plus its expected verdict.
