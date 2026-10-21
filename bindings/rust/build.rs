use std::{env, fs, path::Path};

fn main() {
    let src_dir = Path::new("src");

    let mut c_config = cc::Build::new();
    c_config.std("c11").include(src_dir);

    #[cfg(target_env = "msvc")]
    c_config.flag("-utf-8");

    let parser_path = src_dir.join("parser.c");
    c_config.file(&parser_path);
    println!("cargo:rerun-if-changed={}", parser_path.to_str().unwrap());

    c_config.compile("tree-sitter-aql");

    write_keywords(&src_dir.join("grammar.json"));
}

/// Emit `$OUT_DIR/keywords.rs` with every case-insensitive word token of the
/// grammar, upper-cased and sorted.
///
/// `grammar.js` builds each keyword with `ci(word)`, which becomes a PATTERN
/// of `[xX]` pairs in `src/grammar.json` (`_` becomes `[__]`). Any pattern
/// made only of such pairs is a keyword; every other pattern (identifiers,
/// numbers, strings) contains a range, a quantifier, or an escape and is
/// skipped. A hand scan keeps the build free of a JSON dependency.
fn write_keywords(grammar_json: &Path) {
    println!("cargo:rerun-if-changed={}", grammar_json.display());
    let json = fs::read_to_string(grammar_json).expect("read src/grammar.json");

    let mut words: Vec<String> = Vec::new();
    let marker = "\"value\": \"";
    let mut rest = json.as_str();
    while let Some(at) = rest.find(marker) {
        rest = &rest[at + marker.len()..];
        let Some(end) = rest.find('"') else { break };
        if let Some(word) = keyword_of(&rest[..end]) {
            words.push(word);
        }
        rest = &rest[end..];
    }
    words.sort();
    words.dedup();
    assert!(!words.is_empty(), "no keyword found in src/grammar.json");

    let mut out = String::from(
        "/// Every AQL keyword in the grammar, upper case, sorted.\npub const KEYWORDS: &[&str] = &[\n",
    );
    for w in &words {
        out.push_str(&format!("    \"{w}\",\n"));
    }
    out.push_str("];\n");
    let dest = Path::new(&env::var("OUT_DIR").expect("OUT_DIR")).join("keywords.rs");
    fs::write(dest, out).expect("write keywords.rs");
}

/// `[Ff][Oo][Rr]` → `FOR`; `[Kk][__][Pp]` → `K_P`; anything else → `None`.
fn keyword_of(pattern: &str) -> Option<String> {
    let bytes = pattern.as_bytes();
    if bytes.is_empty() || !bytes.len().is_multiple_of(4) {
        return None;
    }
    let mut word = String::new();
    for chunk in bytes.chunks(4) {
        let (open, a, b, close) = (chunk[0], chunk[1], chunk[2], chunk[3]);
        if open != b'[' || close != b']' {
            return None;
        }
        let pair_ok = (a == b'_' && b == b'_')
            || (a.is_ascii_alphabetic() && a.eq_ignore_ascii_case(&b) && a != b);
        if !pair_ok {
            return None;
        }
        word.push(a.to_ascii_uppercase() as char);
    }
    Some(word)
}
