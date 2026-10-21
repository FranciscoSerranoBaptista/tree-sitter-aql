# tree-sitter-aql

A [tree-sitter](https://tree-sitter.github.io/tree-sitter/) grammar for **AQL** — the
ArangoDB / Aquila Query Language. Provides fast, incremental parsing and syntax
highlighting for editors and tooling.

To the author's knowledge this is the first tree-sitter grammar for AQL.

## Scope

Covers the full AQL surface: `FOR` (collection scan, graph traversal, and path search),
`LET`, `FILTER`, `SORT`, `LIMIT`, `COLLECT` (all six forms), and the write operations
(`INSERT` / `UPDATE` / `REPLACE` / `REMOVE` / `UPSERT`); the complete expression grammar
with correct operator precedence, function calls (including `MODULE::fn` scope), array and
object literals (keyword keys allowed), member / index / array-expansion access, ternary
and elvis, and array-quantifier comparisons (`ALL` / `ANY` / `NONE` / `AT LEAST (n)`);
bind parameters (`@x`, `@@coll`); case-insensitive keywords; and `//` line + `/* */` block
comments.

Highlight queries live in `queries/highlights.scm`. Corpus and highlight tests are in
`test/`.

## Build & test

```sh
npm install
npx tree-sitter generate     # regenerates src/parser.c (committed) — ABI 15
npx tree-sitter test         # corpus + highlight tests
```

Requires the tree-sitter CLI `>= 0.26` (generates ABI 15, matching current editors).

## Use from Rust

The crate at the repository root builds `src/parser.c` with `cc` and
exposes the grammar as a `tree_sitter_language::LanguageFn`:

```toml
[dependencies]
tree-sitter = "0.25"
tree-sitter-aql = { git = "https://github.com/FranciscoSerranoBaptista/tree-sitter-aql" }
```

```rust
let mut parser = tree_sitter::Parser::new();
parser.set_language(&tree_sitter_aql::LANGUAGE.into()).unwrap();
let tree = parser.parse("FOR d IN nodes RETURN d", None).unwrap();
assert!(!tree.root_node().has_error());
```

`tree_sitter_aql::HIGHLIGHTS_QUERY` holds `queries/highlights.scm`,
`NODE_TYPES` holds `src/node-types.json`, and `KEYWORDS` holds every AQL
keyword of the grammar, upper case and sorted. `build.rs` generates
`KEYWORDS` from `src/grammar.json`, so it follows the grammar. `cargo test` checks that the
grammar loads, that a traversal parses, and that the highlight query
compiles. The generated parser is ABI 15, so it needs tree-sitter 0.25 or
later.

## Use in editors

- **Neovim** — add as a custom parser via `nvim-treesitter`.
- **Helix** — reference this repo in `languages.toml` as a grammar source.
- **Zed** — reference this repo in a Zed language extension's `extension.toml`
  `[grammars.aql]` (repository + rev).
- Any tree-sitter consumer (`ast-grep`, `difftastic`, structural search, etc.).

## License

Dual-licensed under either of

- MIT (`LICENSE-MIT`)
- Apache License, Version 2.0 (`LICENSE-APACHE`)

at your option.

## Credits

Grammar authored independently from the Aquila engine's own lexer/parser (not derived from
ArangoDB source). Structural conventions follow the permissively-licensed
[`tree-sitter-sql`](https://github.com/DerekStride/tree-sitter-sql) (the `make_keyword`
case-insensitive pattern) and [`surql-zed`](https://github.com/siteforge-io/surql-zed).
