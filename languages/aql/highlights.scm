; AQL tree-sitter highlight queries — Zed capture names.
;
; Grammar tweak note
; ------------------
; Two grammar changes were made to achieve correct highlighting:
;
; 1. AQL keywords (FOR, RETURN, IN, AND, OR, …) use a ci() regex helper, which
;    produces anonymous regex-pattern tokens not targetable by string literals.
;    Each inline ci() call was wrapped with alias(ci('word'), 'keyword'), giving
;    all keywords the anonymous type "keyword" — matched below as @keyword.
;    The word: property was removed (it conflicts with sibling lexical rules of
;    the same regex pattern and only helps with string-literal tokens, not regex).
;
; 2. Function names and property names need distinct node types so their
;    @function / @property captures are not overridden by the general
;    (identifier) @variable fallback.  tree-sitter applies "innermost node wins"
;    when multiple patterns capture the same span: a leaf-level (identifier)
;    match always beats a parent-context match like (function_call . (identifier)).
;    Solution: function_identifier and property_identifier are separate lexical
;    rules with the same regex as identifier but distinct CST types.  The parser
;    state ensures they are only produced in function-name and property-name
;    positions respectively.

; ── Keywords ─────────────────────────────────────────────────────────────────
; All clause keywords (FOR LET FILTER SORT LIMIT RETURN COLLECT INSERT
; UPDATE REPLACE REMOVE UPSERT INTO WITH OPTIONS DISTINCT GRAPH PRUNE AT
; TO ASC DESC COUNT AGGREGATE KEEP SHORTEST_PATH …) and word operators
; (AND OR NOT IN LIKE) share the anonymous "keyword" type.
"keyword" @keyword

; ── Comparison / quantifier operators ────────────────────────────────────────
; comparison_operator covers == != < > <= >= =~ !~ IN LIKE NOT IN
; (named node — entire span highlighted as @keyword.operator).
(comparison_operator) @keyword.operator

; traversal_direction: OUTBOUND INBOUND ANY (named node — entire span)
(traversal_direction) @keyword

; quantifier: ALL ANY NONE (named node — entire span)
(quantifier) @keyword

; ── Symbolic operators ───────────────────────────────────────────────────────
"==" @operator
"!=" @operator
"<"  @operator
">"  @operator
"<=" @operator
">=" @operator
"=~" @operator
"!~" @operator
".." @operator  ; range
"?"  @operator  ; ternary / elvis

; Arithmetic
"+" @operator
"-" @operator
"*" @operator
"/" @operator
"%" @operator

; Module-qualifier (structural separator, not arithmetic)
"::" @operator

; ── Literals ─────────────────────────────────────────────────────────────────
(string)  @string
(integer) @number
(float)   @number
(boolean) @boolean
(null)    @constant.builtin

; ── Comments ─────────────────────────────────────────────────────────────────
(comment) @comment

; ── Bind parameters ──────────────────────────────────────────────────────────
; @param and @@coll — both get @variable.parameter
(bind_parameter)  @variable.parameter
(bind_collection) @variable.parameter

; ── Function names ───────────────────────────────────────────────────────────
; function_identifier is a distinct lexical type used ONLY for the function-name
; and module-prefix positions in function_call.  Because it is a different CST
; node type from identifier, (function_identifier) @function wins over the
; general (identifier) @variable without any priority fight.
; Hazard safe: keyword-like names (LEFT, RIGHT, UPPER, …) in function position
; lex as function_identifier, not as the anonymous "keyword" type.
(function_identifier) @function

; ── Object / property keys ───────────────────────────────────────────────────
; property_identifier is a distinct lexical type used in:
;   - field_access field-name position  (d.at → "at" is property_identifier)
;   - object_pair key position          ({ for: 1 } → "for" is property_identifier)
; Because it is a different CST type from identifier, @property always wins.
; Hazard safe: keyword-like field names (at, for, in, …) lex as
; property_identifier in those positions, never as the "keyword" type.
(property_identifier) @property

; String keys in object pairs  (e.g.  { "key": x })
(object_pair . (string) @string)

; ── CURRENT pseudo-variable ──────────────────────────────────────────────────
(current) @variable.special

; ── General identifiers (fallback) ───────────────────────────────────────────
; Applied after all more-specific rules; identifiers that didn't match
; a function name, property, bind-param, etc. are plain variables.
(identifier) @variable

; ── Punctuation ──────────────────────────────────────────────────────────────
"(" @punctuation.bracket
")" @punctuation.bracket
"[" @punctuation.bracket
"]" @punctuation.bracket
"{" @punctuation.bracket
"}" @punctuation.bracket
"[*]" @punctuation.bracket

"," @punctuation.delimiter
"." @punctuation.delimiter
":" @punctuation.delimiter
"=" @punctuation.delimiter
