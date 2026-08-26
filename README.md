# lead-qualifier

A reference architecture for AI lead qualification built on one principle: **the agent proposes; code decides.**

The language model runs the conversation — it's good at that. But whether a lead is qualified is a business decision, so it belongs to a pure, deterministic, exhaustively tested function that can overrule the model every time. When it does, the override is fed back into the conversation as a system note, so the agent's next turn is grounded in the real decision rather than its own optimism.

The demo domain is Summit Trails, a fictional adventure-tour operator qualifying trip inquiries on budget, group size, and dates. The domain is a stand-in; the architecture is the point.

```bash
git clone https://github.com/elliothimmelfarb/lead-qualifier && cd lead-qualifier
npm install
npm test          # 75 tests: guard, session, spec, store, personas
npm run demo      # watch a full qualification conversation, no API key needed
```

Everything runs with zero credentials — a deterministic mock model stands in when `ANTHROPIC_API_KEY` is absent. Set the key and the same code runs against Claude.

## The architecture

**The agent is a versioned artifact, not a prompt in a string.** [`agents/qualifier.agent.yaml`](agents/qualifier.agent.yaml) declares the model, temperature, and system prompt; `npm run provision` validates it against a schema and writes a digest lock. Edit the prompt without re-provisioning and CI fails — the app refuses to run an unapproved agent version. Prompts get the same discipline as dependencies.

**One session per lead.** [`src/agent/session.ts`](src/agent/session.ts) owns the turn loop: the model extracts fields and proposes a verdict, the guard rules, and the transcript accumulates in a store. The store is an interface with an in-memory default (a Redis sketch is included, commented, so the zero-credential clone stays honest).

**The guard is pure and asymmetric.** [`src/domain/qualification.ts`](src/domain/qualification.ts) takes a proposal and returns a decision — no clock, no I/O, no model. Hard rules (budget floor, group size, lead-time window) outrank everything; missing fields mean *incomplete*, not *rejected*; unknown values are skipped rather than failed. The asymmetry is the safety property: the model may narrow (decline a lead the rules would allow) but can never widen (qualify a lead the rules reject).

**Personas are the integration suite.** [`sim/personas/`](sim/personas) holds eight scripted leads — the eager qualified one, the budget that's $50 short, the group of twenty, the hostile one, the tire-kicker planning two years out, the edge case sitting exactly on the budget floor. The sim runner plays each against the qualifier and asserts the guard's final verdict, override behavior included. Three personas exist specifically to force the model to propose "yes" so the tests can watch code say "no."

## Why it's built this way

Production conversational agents fail in a particular way: the model is charming, confident, and occasionally wrong about the one thing that costs money. Putting the consequential decision in deterministic code means the failure mode becomes a bad conversation instead of a bad booking — and a pure function's edge cases can be tested exhaustively in a way a prompt's never can.

The pattern generalizes to anything shaped like *conversation in, consequential decision out*: loan pre-screening, appointment triage, application intake, support escalation.

## Layout

| Path | What it is |
|---|---|
| `agents/` | The versioned agent artifact: YAML spec, system prompt, digest lock |
| `src/domain/` | The guard — pure decision logic, 37 tests |
| `src/agent/` | Session loop, model interface, Anthropic + mock implementations |
| `src/store/` | Store interface, in-memory default, Redis sketch |
| `sim/` | Eight personas and the runner that plays them |
| `scripts/provision.ts` | Validate + lock the agent spec (`--check` in CI) |

---

<sub>MIT · Built by Elliot Himmelfarb with <a href="https://claude.com/claude-code">Claude Code</a>. A clean-room demonstration of patterns from production work — no client code or data.</sub>
