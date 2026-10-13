# Graph Report - RouteForge  (2026-10-13)

## Corpus Check
- 7 files · ~5,374 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 2 file(s) not represented in the graph (top: (none) 2)

## Summary
- 39 nodes · 69 edges · 9 communities (4 shown, 5 thin omitted)
- Extraction: 93% EXTRACTED · 7% INFERRED · 0% AMBIGUOUS · INFERRED: 5 edges (avg confidence: 0.87)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `d2121d31`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- post_commit
- mem.py
- build
- NOW — RouteForge current truth
- graph
- AGENTS.md
- context
- CLAUDE.md
- GROK.md

## God Nodes (most connected - your core abstractions)
1. `sh()` - 8 edges
2. `post_commit()` - 8 edges
3. `slice_()` - 6 edges
4. `build()` - 6 edges
5. `context()` - 6 edges
6. `stop()` - 6 edges
7. `read()` - 5 edges
8. `install_hook()` - 5 edges
9. `gbin()` - 4 edges
10. `changed()` - 4 edges

## Surprising Connections (you probably didn't know these)
- `2026-10-13 — auto-memory protocol adopted` --references--> `graph()`  [INFERRED]
  ai/DECISIONS.md → ai/memory/mem.py

## Import Cycles
- None detected.

## Communities (9 total, 5 thin omitted)

### Community 0 - "post_commit"
Cohesion: 0.43
Nodes (6): changed(), gbin(), post_commit(), route(), sh(), slice_()

### Community 2 - "build"
Cohesion: 0.50
Nodes (5): build(), last_decisions(), read(), start(), summary()

### Community 3 - "NOW — RouteForge current truth"
Cohesion: 0.40
Nodes (4): Goal, In flight, Known facts / constraints, NOW — RouteForge current truth

### Community 4 - "graph"
Cohesion: 0.50
Nodes (3): 2026-10-13 — auto-memory protocol adopted, DECISIONS — RouteForge (append-only), graph()

## Knowledge Gaps
- **5 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `graph()` connect `graph` to `post_commit`, `mem.py`?**
  _High betweenness centrality (0.094) - this node is a cross-community bridge._