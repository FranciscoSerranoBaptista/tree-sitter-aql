// ci("for") => /[Ff][Oo][Rr]/  (case-insensitive keyword helper for AQL)
function ci(word) {
  return new RegExp(word.split('').map(c =>
    `[${c.toLowerCase()}${c.toUpperCase()}]`).join(''));
}

// kw("for") wraps ci("for") in an anonymous alias so highlight queries can
// target it as "keyword".  Anonymous aliases (string second argument) do NOT
// appear in the CST S-expression, so corpus tests are unaffected.  Named
// nodes inside already-named wrapper rules (boolean, null, current, quantifier,
// traversal_direction, comparison_operator) are left as plain ci() calls.
function kw(word) {
  return alias(ci(word), 'keyword');
}

// Operator precedence levels (higher = tighter binding).
// Mirrors the Pratt left-binding-powers in crates/aquila-aql/src/parser.rs:67-96.
const PREC = {
  TERNARY: 1,   // ?  ?: (right-assoc, loosest infix)
  OR:       2,   // OR
  AND:      3,   // AND
  NOT:      4,   // prefix NOT
  COMPARE:  5,   // == != < > <= >= LIKE =~ !~ IN  NOT IN  quantifiers
  RANGE:    6,   // ..
  ADD:      8,   // + -
  MUL:      9,   // * / %
  UNARY:   10,   // unary + -
  POSTFIX: 12,   // .field  [expr]  [*]  [**]
};

module.exports = grammar({
  name: 'aql',

  extras: $ => [/\s/, $.comment],

  // NOTE: `word` is intentionally absent.  The original grammar set
  // `word: $ => $.identifier` to enable tree-sitter's keyword-extraction
  // feature, but AQL keywords are implemented via the kw() alias helper
  // (alias(ci('word'), 'keyword')) which produces regex-based anonymous
  // tokens — not the string-literal tokens that keyword extraction requires.
  // Keyword extraction therefore provided no benefit.  Removing it allows us
  // to introduce function_identifier and property_identifier as additional
  // lexical rules that share the same pattern as identifier without triggering
  // the "Non-terminal symbol 'identifier' cannot be used as the word token"
  // error from tree-sitter generate (which rejects a word token that is
  // ambiguous with sibling lexical rules).

  // The six GLR pairs from the original grammar were all reported as
  // "unnecessary" by tree-sitter generate (the LR automaton resolves them
  // deterministically).  They have been removed.
  //
  // One genuine conflict remains: `ANY` is a valid token for both
  // `traversal_direction` (FOR traversal) and `quantifier` (array quantifier).
  // When the lookahead after `ANY` is `NOT` (start of the NOT IN
  // comparison_operator), LALR(1) cannot decide without GLR exploration.
  conflicts: $ => [
    [$.traversal_direction, $.quantifier],
  ],

  rules: {

    // ── Top-level ─────────────────────────────────────────────────────────────

    query: $ => repeat1($._statement),

    _statement: $ => choice(
      $.return_clause,
      $.for_clause,
      $.let_clause,
      $.filter_clause,
      $.sort_clause,
      $.limit_clause,
      $.collect_clause,
      $.insert_statement,
      $.update_statement,
      $.replace_statement,
      $.remove_statement,
      $.upsert_statement,
    ),

    // ── RETURN ────────────────────────────────────────────────────────────────

    return_clause: $ => seq(
      kw('return'),
      optional(kw('distinct')),
      $._expression
    ),

    // ── FOR ───────────────────────────────────────────────────────────────────

    // Shared entry point; the three body variants follow after `IN`.
    for_clause: $ => seq(
      kw('for'),
      $.identifier,                             // v
      optional(seq(',', $.identifier)),          // [, e]
      optional(seq(',', $.identifier)),          // [, p]
      kw('in'),
      choice(
        $.for_path_spec,       // SHORTEST_PATH | K_SHORTEST_PATHS | …
        $.for_traversal_spec,  // depth_range dir start GRAPH|edgeColl…
        $.for_scan_spec,       // collection_ref | expr  [AT] [OPTIONS]
      ),
    ),

    // Traversal direction keyword (shared by path and traversal specs).
    // Left as plain ci() calls — this node is already named, so
    // (traversal_direction) @keyword captures the whole node in highlights.scm.
    traversal_direction: $ => choice(
      ci('outbound'),
      ci('inbound'),
      ci('any'),
    ),

    // FOR v[,e] IN SHORTEST_PATH | K_SHORTEST_PATHS | K_PATHS | ALL_SHORTEST_PATHS
    //   <start> TO <end> OUTBOUND|INBOUND|ANY (GRAPH <name> | <edgeColl>[,…])
    //   [OPTIONS <expr>]
    for_path_spec: $ => seq(
      choice(
        kw('shortest_path'),
        kw('k_shortest_paths'),
        kw('k_paths'),
        kw('all_shortest_paths'),
      ),
      $._expression,          // start vertex
      kw('to'),
      $._expression,          // end vertex
      $.traversal_direction,
      choice(
        seq(kw('graph'), $._expression),   // named graph
        $.edge_collection_list,             // ad-hoc edge collections
      ),
      optional(seq(kw('options'), $._expression)),
    ),

    // FOR v[,e[,p]] IN <depth_range> OUTBOUND|INBOUND|ANY <start>
    //   (GRAPH <name> | <edgeColl>[,…]) [PRUNE <expr>] [AT <expr>] [OPTIONS <expr>]
    for_traversal_spec: $ => seq(
      $._expression,          // depth range (e.g. 1..3)
      $.traversal_direction,
      $._expression,          // start vertex
      choice(
        seq(kw('graph'), $._expression),   // named graph
        $.edge_collection_list,             // ad-hoc edge collections
      ),
      optional(seq(kw('prune'), $._expression)),
      optional(seq(kw('at'), $._expression)),    // temporal AT clause
      optional(seq(kw('options'), $._expression)),
    ),

    // One or more bare identifier names used as edge collection references
    edge_collection_list: $ => seq(
      $.identifier,
      repeat(seq(',', $.identifier)),
    ),

    // FOR var IN <collection_ref_or_expr> [AT <expr>] [OPTIONS <expr>]
    // Also covers array enumeration: FOR var IN <array_expr>
    for_scan_spec: $ => seq(
      $._expression,
      optional(seq(kw('at'), $._expression)),
      optional(seq(kw('options'), $._expression)),
    ),

    // ── LET ───────────────────────────────────────────────────────────────────

    let_clause: $ => seq(
      kw('let'),
      $.identifier,
      '=',
      $._expression,
    ),

    // ── FILTER ────────────────────────────────────────────────────────────────

    filter_clause: $ => seq(
      kw('filter'),
      $._expression,
    ),

    // ── SORT ──────────────────────────────────────────────────────────────────

    sort_clause: $ => seq(
      kw('sort'),
      $.sort_item,
      repeat(seq(',', $.sort_item)),
    ),

    sort_item: $ => seq(
      $._expression,
      optional(choice(kw('asc'), kw('desc'))),
    ),

    // ── LIMIT ─────────────────────────────────────────────────────────────────

    limit_clause: $ => seq(
      kw('limit'),
      $._expression,
      optional(seq(',', $._expression)),
    ),

    // ── COLLECT ───────────────────────────────────────────────────────────────
    //
    // Six forms (spec §3.2):
    //  1. COLLECT WITH COUNT INTO var
    //  2. COLLECT AGGREGATE var=expr, …
    //  3. COLLECT key=expr, … [no postfix]
    //  4. COLLECT key=expr, … INTO var [KEEP var, …]
    //  5. COLLECT key=expr, … WITH COUNT INTO var
    //  6. COLLECT key=expr, … AGGREGATE var=expr, …

    collect_clause: $ => seq(
      kw('collect'),
      choice(
        // Form 1: pure count, no grouping keys
        seq(kw('with'), kw('count'), kw('into'), $.identifier),

        // Form 2: aggregation without grouping keys
        seq(kw('aggregate'), $.collect_assignment_list),

        // Forms 3-6: one or more grouping key assignments, then optional postfix
        seq(
          $.collect_assignment_list,
          optional(choice(
            // Form 4: INTO var [KEEP var, …]
            seq(
              kw('into'), $.identifier,
              optional(seq(
                kw('keep'),
                $.identifier,
                repeat(seq(',', $.identifier)),
              )),
            ),
            // Form 5: WITH COUNT INTO var
            seq(kw('with'), kw('count'), kw('into'), $.identifier),
            // Form 6: AGGREGATE var=expr, …
            seq(kw('aggregate'), $.collect_assignment_list),
          )),
        ),
      ),
    ),

    collect_assignment_list: $ => seq(
      $.collect_assignment,
      repeat(seq(',', $.collect_assignment)),
    ),

    // var = expr  (used for grouping keys and aggregate slots)
    collect_assignment: $ => seq(
      $.identifier,
      '=',
      $._expression,
    ),

    // ── Write statements ──────────────────────────────────────────────────────

    // INSERT <expr> INTO|IN <coll> [OPTIONS <expr>]
    insert_statement: $ => seq(
      kw('insert'),
      $._expression,
      choice(kw('into'), kw('in')),
      $._expression,
      optional(seq(kw('options'), $._expression)),
    ),

    // UPDATE <expr> WITH <expr> IN|INTO <coll> [OPTIONS <expr>]
    update_statement: $ => seq(
      kw('update'),
      $._expression,
      kw('with'),
      $._expression,
      choice(kw('in'), kw('into')),
      $._expression,
      optional(seq(kw('options'), $._expression)),
    ),

    // REPLACE <expr> WITH <expr> IN|INTO <coll> [OPTIONS <expr>]
    replace_statement: $ => seq(
      kw('replace'),
      $._expression,
      kw('with'),
      $._expression,
      choice(kw('in'), kw('into')),
      $._expression,
      optional(seq(kw('options'), $._expression)),
    ),

    // REMOVE <expr> IN|INTO <coll> [OPTIONS <expr>]
    remove_statement: $ => seq(
      kw('remove'),
      $._expression,
      choice(kw('in'), kw('into')),
      $._expression,
      optional(seq(kw('options'), $._expression)),
    ),

    // UPSERT <search> INSERT <insert> (UPDATE|REPLACE) <update> IN <coll> [OPTIONS <expr>]
    upsert_statement: $ => seq(
      kw('upsert'),
      $._expression,   // search expression
      kw('insert'),
      $._expression,   // insert body
      choice(kw('update'), kw('replace')),
      $._expression,   // update / replace body
      kw('in'),
      $._expression,   // collection
      optional(seq(kw('options'), $._expression)),
    ),

    // ── Expression ladder ─────────────────────────────────────────────────────
    // Ordered from looser to tighter for readability; tree-sitter resolves
    // actual precedence from the prec.*/prec wrappers on each alternative.

    _expression: $ => choice(
      // Atoms / primaries
      $._literal,
      $.identifier,
      $.bind_parameter,
      $.bind_collection,
      $.current,
      $.array,
      $.object,
      $.grouped_expression,
      $.subquery,
      $.function_call,

      // Postfix (tightest binary ops)
      $.field_access,
      $.index_access,
      $.expansion,

      // Unary prefix
      $.unary_expression,

      // Binary
      $.binary_expression,
      $.not_in_expression,

      // Quantifier forms (special infix, same prec as comparisons)
      $.quantifier_comparison,
      $.at_least_comparison,

      // Ternary / Elvis (loosest)
      $.ternary_expression,
      $.elvis_expression,
    ),

    // ── Ternary / Elvis ───────────────────────────────────────────────────────

    // cond ? then : else  (right-associative, loosest precedence)
    ternary_expression: $ => prec.right(PREC.TERNARY, seq(
      $._expression,
      '?',
      $._expression,
      ':',
      $._expression,
    )),

    // cond ?: else  ("Elvis" — condition re-used as then-branch)
    elvis_expression: $ => prec.right(PREC.TERNARY, seq(
      $._expression,
      '?',
      ':',
      $._expression,
    )),

    // ── Binary operators ──────────────────────────────────────────────────────

    binary_expression: $ => choice(
      // Boolean word operators — kw() so they get "keyword" type for highlighting
      prec.left(PREC.OR,    seq($._expression, kw('or'),   $._expression)),
      prec.left(PREC.AND,   seq($._expression, kw('and'),  $._expression)),

      // Comparison (left-associative for grammar purposes; semantic chaining is
      // rejected by the engine at bind/execute time, matching ArangoDB behaviour)
      prec.left(PREC.COMPARE, seq($._expression, '==',       $._expression)),
      prec.left(PREC.COMPARE, seq($._expression, '!=',       $._expression)),
      prec.left(PREC.COMPARE, seq($._expression, '<',        $._expression)),
      prec.left(PREC.COMPARE, seq($._expression, '>',        $._expression)),
      prec.left(PREC.COMPARE, seq($._expression, '<=',       $._expression)),
      prec.left(PREC.COMPARE, seq($._expression, '>=',       $._expression)),
      prec.left(PREC.COMPARE, seq($._expression, kw('like'), $._expression)),
      prec.left(PREC.COMPARE, seq($._expression, '=~',       $._expression)),
      prec.left(PREC.COMPARE, seq($._expression, '!~',       $._expression)),
      prec.left(PREC.COMPARE, seq($._expression, kw('in'),   $._expression)),

      // Range
      prec.left(PREC.RANGE, seq($._expression, '..', $._expression)),

      // Arithmetic
      prec.left(PREC.ADD,  seq($._expression, '+', $._expression)),
      prec.left(PREC.ADD,  seq($._expression, '-', $._expression)),
      prec.left(PREC.MUL,  seq($._expression, '*', $._expression)),
      prec.left(PREC.MUL,  seq($._expression, '/', $._expression)),
      prec.left(PREC.MUL,  seq($._expression, '%', $._expression)),
    ),

    // NOT IN — two tokens; same precedence as other comparisons.
    // AQL spec hazard: NOT then IN, never a single NOT_IN token.
    // Both tokens are aliased to "keyword" so highlight queries can target
    // each one individually.
    not_in_expression: $ => prec.left(PREC.COMPARE, seq(
      $._expression,
      kw('not'),
      kw('in'),
      $._expression,
    )),

    // ── Unary prefix ─────────────────────────────────────────────────────────

    unary_expression: $ => choice(
      prec.right(PREC.NOT,   seq(kw('not'), $._expression)),
      prec.right(PREC.UNARY, seq('+',       $._expression)),
      prec.right(PREC.UNARY, seq('-',       $._expression)),
    ),

    // ── Array-quantifier comparisons ─────────────────────────────────────────

    // lhs ALL|ANY|NONE <cmp> rhs
    quantifier_comparison: $ => prec.left(PREC.COMPARE, seq(
      $._expression,
      $.quantifier,
      $.comparison_operator,
      $._expression,
    )),

    // lhs AT LEAST ( n ) <cmp> rhs
    at_least_comparison: $ => prec.left(PREC.COMPARE, seq(
      $._expression,
      kw('at'),
      kw('least'),
      '(',
      $._expression,
      ')',
      $.comparison_operator,
      $._expression,
    )),

    // Quantifier keywords.  Left as plain ci() — this node is already named,
    // so (quantifier) @keyword captures the whole node.
    quantifier: $ => choice(ci('all'), ci('any'), ci('none')),

    // Comparison operators legal after a quantifier.
    // Named (no leading underscore) so the operator node appears in the CST —
    // callers can recover which operator was used (e.g. '>' vs 'NOT IN').
    // Left as plain ci() — (comparison_operator) @keyword.operator captures
    // the whole node (including the two-token NOT IN case).
    comparison_operator: $ => choice(
      '==', '!=', '<', '>', '<=', '>=', '=~', '!~',
      ci('in'), ci('like'),
      seq(ci('not'), ci('in')),   // NOT IN — two tokens, one logical operator
    ),

    // ── Function calls ───────────────────────────────────────────────────────

    // identifier ( args... )          — plain call
    // identifier :: identifier ( )    — module-qualified call (e.g. GEO::DISTANCE)
    function_call: $ => seq(
      $.function_identifier,
      optional(seq('::', $.function_identifier)),
      '(',
      optional(seq($._expression, repeat(seq(',', $._expression)))),
      ')',
    ),

    // ── Grouped / subquery ───────────────────────────────────────────────────

    // ( expr )
    grouped_expression: $ => seq('(', $._expression, ')'),

    // ( statement+ ) — e.g. (RETURN 1) or (FOR x IN c RETURN x)
    subquery: $ => seq('(', repeat1($._statement), ')'),

    // ── Postfix access ───────────────────────────────────────────────────────

    // expr . field
    field_access: $ => prec.left(PREC.POSTFIX, seq(
      $._expression,
      '.',
      // Any identifier-alphabet token is valid as a field name, including
      // keywords; tree-sitter's context-sensitive lexer resolves this: in the
      // field-name position only $.property_identifier is a valid token, so
      // keywords lex as property identifiers, not as kw() tokens.
      // Using a distinct property_identifier type (same regex, different CST
      // node) lets (property_identifier) @property in highlights.scm win over
      // the (identifier) @variable fallback without fighting tree-sitter's
      // "innermost-node wins" capture priority rule.
      $.property_identifier,
    )),

    // expr [ expr ]
    index_access: $ => prec.left(PREC.POSTFIX, seq(
      $._expression,
      '[',
      $._expression,
      ']',
    )),

    // Expansion forms (postfix, same precedence as field/index):
    //   expr[*]           — '[*]' is the single Expansion token (3 chars)
    //   expr[**]          — '[' + '**' + ']'  (multi-star; no inline clauses)
    //   expr[***]         — '[' + '***' + ']'
    //   expr[* FILTER e LIMIT n RETURN p]  — inline expansion with clauses
    //
    // In the AQL logos lexer, '[*]' is tokenised as the single Expansion token;
    // '[**]' / '[***]' are LBracket + Times* + RBracket (maximal-munch means
    // '[**]' doesn't start with '[*]' because the 3rd char is '*' not ']').
    // tree-sitter's lexer does the same: '[*]' is the 3-char terminal.
    expansion: $ => prec.left(PREC.POSTFIX, choice(
      // [*] single token
      seq($._expression, '[*]'),

      // [** ...] or [*** ...] with optional inline clauses
      // (repeat1('*') inside '[' … ']' never conflicts with index_access
      // because '*' is not a valid expression-start token)
      seq(
        $._expression,
        '[',
        '*',
        repeat1('*'),                                    // at least ** total
        optional(seq(kw('filter'), $._expression)),
        optional(seq(kw('limit'),  $._expression)),
        optional(seq(kw('return'), $._expression)),
        ']',
      ),

      // [* FILTER … LIMIT … RETURN …] inline expansion
      // (single star but followed by at least one inline clause)
      seq(
        $._expression,
        '[',
        '*',
        choice(
          seq(kw('filter'), $._expression,
              optional(seq(kw('limit'),  $._expression)),
              optional(seq(kw('return'), $._expression))),
          seq(kw('limit'),  $._expression,
              optional(seq(kw('return'), $._expression))),
          seq(kw('return'), $._expression),
        ),
        ']',
      ),
    )),

    // ── Array / Object literals ───────────────────────────────────────────────

    array: $ => seq(
      '[',
      optional(seq($._expression, repeat(seq(',', $._expression)))),
      ']',
    ),

    object: $ => seq(
      '{',
      optional(seq($._object_entry, repeat(seq(',', $._object_entry)))),
      '}',
    ),

    // Either a key:value pair or a shorthand { ident } (value = ident).
    _object_entry: $ => choice(
      $.object_pair,
      $.identifier,
    ),

    // key : value
    // Keys may be any identifier-alphabet token (incl. keywords such as `for`,
    // `graph`).  In _object_key position, tree-sitter's context-sensitive lexer
    // only exposes $.identifier and $.string as valid tokens, so keywords are
    // automatically lexed as identifiers.
    object_pair: $ => seq(
      $._object_key,
      ':',
      $._expression,
    ),

    _object_key: $ => choice($.property_identifier, $.string),

    // ── Special atoms ─────────────────────────────────────────────────────────

    // CURRENT pseudo-variable — only meaningful inside inline expansions, but
    // allowed everywhere at the grammar level (semantic check is the engine's job).
    // Left as plain ci() — (current) @variable captures the whole node.
    current: $ => ci('current'),

    // ── Existing lexical rules (unchanged from ZT1) ──────────────────────────

    _literal: $ => choice(
      $.null,
      $.boolean,
      $.integer,
      $.float,
      $.string,
    ),

    // Left as plain ci() — (null) @constant.builtin captures the whole node.
    null: $ => ci('null'),

    // Left as plain ci() — (boolean) @boolean captures the whole node.
    boolean: $ => choice(ci('true'), ci('false')),

    // float must come before integer so the longer match wins
    float: $ => token(choice(
      /[0-9]+\.[0-9]+([eE][+-]?[0-9]+)?/,
      /[0-9]+[eE][+-]?[0-9]+/,
    )),

    integer: $ => /[0-9]+/,

    string: $ => choice(
      seq('"', repeat(choice(/[^"\\]+/, /\\./)), '"'),
      seq("'", repeat(choice(/[^'\\]+/, /\\./)), "'"),
    ),

    // @@coll must precede @param so the longer prefix is preferred
    bind_collection: $ => /@@[a-zA-Z_][a-zA-Z0-9_]*/,

    bind_parameter: $ => /@[a-zA-Z_][a-zA-Z0-9_]*/,

    identifier: $ => /[a-zA-Z_][a-zA-Z0-9_]*/,

    // Distinct lexical types for function names and property names.
    // These have the same regex as `identifier` but produce a different CST
    // node type, allowing highlight queries to target them specifically without
    // competing with the general `(identifier) @variable` fallback.
    //
    // tree-sitter's parser-state-guided lexer ensures these are only produced
    // in the positions where the grammar expects them, so keyword-like strings
    // (e.g. UPPER, LEFT) are still correctly tokenised as function/property
    // names rather than as kw() tokens.
    function_identifier: $ => /[a-zA-Z_][a-zA-Z0-9_]*/,
    property_identifier: $ => /[a-zA-Z_][a-zA-Z0-9_]*/,

    comment: $ => token(choice(
      seq('//', /[^\n]*/),
      seq('/*', /[^*]*\*+([^/*][^*]*\*+)*/, '/'),
    )),
  },
});
