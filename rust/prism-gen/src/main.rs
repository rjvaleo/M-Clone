//! `cargo run -p prism-gen` from `rust/`: rewrite idMLab's prism catalogue.

fn main() {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("..").join(prism_gen::TARGET);
    std::fs::write(&path, prism_gen::render()).expect("write the prism catalogue");
    println!("wrote {}", path.display());
    let tuning = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("..").join(prism_gen::TUNING_TARGET);
    std::fs::write(&tuning, prism_gen::render_tuning()).expect("write the tuning table");
    println!("wrote {}", tuning.display());
}
