//! Text extraction from document formats. Pure functions over bytes: no Tauri, no filesystem.
//!
//! Everything here runs on untrusted input under `panic = "abort"`, where a panic is a crash rather
//! than an error. So: no `unwrap`, no `expect`, no unchecked indexing on document data.

use std::collections::HashMap;
use std::io::{Read, Seek};

use quick_xml::events::{BytesRef, BytesStart, Event};
use quick_xml::Reader;
use serde::Serialize;
use zip::ZipArchive;

pub(crate) struct Page {
    /// The first non-empty `h1`-`h3`, else `<title>`. None when the page has neither.
    pub title: Option<String>,
    pub text: String,
}

const BLOCKS: &[&str] = &[
    "address", "article", "aside", "blockquote", "br", "dd", "div", "dl", "dt", "figcaption", "figure",
    "footer", "h1", "h2", "h3", "h4", "h5", "h6", "header", "hr", "li", "ol", "p", "pre", "section",
    "table", "td", "th", "tr", "ul",
];
const HIDDEN: &[&str] = &["head", "script", "style"];

fn is_title_heading(name: &str) -> bool {
    matches!(name, "h1" | "h2" | "h3")
}

#[derive(Default)]
struct Sink {
    out: String,
    hidden: usize,
    in_title: bool,
    doc_title: String,
    in_heading: bool,
    heading_buf: String,
    heading: Option<String>,
}

impl Sink {
    fn text(&mut self, s: &str) {
        if self.in_title {
            self.doc_title.push_str(s);
        }
        if self.hidden > 0 {
            return;
        }
        if self.in_heading {
            self.heading_buf.push_str(s);
        }
        for c in s.chars() {
            if !c.is_whitespace() {
                self.out.push(c);
            } else if !self.out.is_empty() && !self.out.ends_with([' ', '\n']) {
                self.out.push(' ');
            }
        }
    }

    fn line_break(&mut self) {
        let trimmed = self.out.trim_end_matches(' ').len();
        self.out.truncate(trimmed);
        if !self.out.is_empty() && !self.out.ends_with('\n') {
            self.out.push('\n');
        }
    }

    fn open(&mut self, name: &str) {
        if HIDDEN.contains(&name) {
            self.hidden += 1;
        }
        if name == "title" {
            self.in_title = true;
        }
        if self.heading.is_none() && is_title_heading(name) {
            self.in_heading = true;
            self.heading_buf.clear();
        }
        if BLOCKS.contains(&name) {
            self.line_break();
        }
    }

    fn close(&mut self, name: &str) {
        if HIDDEN.contains(&name) {
            self.hidden = self.hidden.saturating_sub(1);
        }
        if name == "title" {
            self.in_title = false;
        }
        if self.in_heading && is_title_heading(name) {
            self.in_heading = false;
            let heading = collapse(&self.heading_buf);
            if !heading.is_empty() {
                self.heading = Some(heading);
            }
        }
        if BLOCKS.contains(&name) {
            self.line_break();
        }
    }
}

fn collapse(s: &str) -> String {
    s.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn local_name(raw: &[u8]) -> String {
    String::from_utf8_lossy(raw).to_ascii_lowercase()
}

/// XHTML to plain text, the way a reader would see it: `<head>`, `<script>` and `<style>` dropped,
/// block elements on their own lines, whitespace collapsed as HTML renders it. Tags match on their
/// local name, so `<html:p>` is a paragraph.
///
/// Malformed XML is an `Err`. An unknown entity is not: it stays in the text as written, because one
/// `&foo;` must not cost a student the whole chapter.
pub(crate) fn xhtml_to_text(xml: &str) -> Result<Page, String> {
    let mut reader = Reader::from_str(xml.trim_start_matches('\u{FEFF}'));
    let mut sink = Sink::default();
    loop {
        let event = reader
            .read_event()
            .map_err(|e| format!("invalid XML at byte {}: {e}", reader.error_position()))?;
        match event {
            Event::Start(e) => sink.open(&local_name(e.local_name().as_ref())),
            Event::End(e) => sink.close(&local_name(e.local_name().as_ref())),
            Event::Empty(e) => {
                let name = local_name(e.local_name().as_ref());
                if BLOCKS.contains(&name.as_str()) {
                    sink.line_break();
                }
            }
            Event::Text(t) => sink.text(&String::from_utf8_lossy(&t)),
            Event::CData(t) => sink.text(&String::from_utf8_lossy(&t)),
            Event::GeneralRef(r) => sink.text(&resolve_ref(&r)),
            Event::Eof => break,
            _ => {}
        }
    }
    let text = sink.out.lines().map(str::trim).filter(|l| !l.is_empty()).collect::<Vec<_>>().join("\n");
    let doc_title = collapse(&sink.doc_title);
    let title = sink.heading.or((!doc_title.is_empty()).then_some(doc_title));
    Ok(Page { title, text })
}

fn resolve_ref(r: &BytesRef) -> String {
    let name = String::from_utf8_lossy(r);
    entity(&name).unwrap_or_else(|| format!("&{name};"))
}

/// Replace `&name;` references in an attribute value. Unknown ones are kept as written.
pub(crate) fn decode_entities(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut rest = s;
    while let Some(amp) = rest.find('&') {
        out.push_str(rest.get(..amp).unwrap_or_default());
        let after = rest.get(amp + 1..).unwrap_or_default();
        let resolved = after
            .find(';')
            .filter(|&semi| semi <= 32)
            .and_then(|semi| Some((semi, entity(after.get(..semi)?)?)));
        match resolved {
            Some((semi, text)) => {
                out.push_str(&text);
                rest = after.get(semi + 1..).unwrap_or_default();
            }
            None => {
                out.push('&');
                rest = after;
            }
        }
    }
    out.push_str(rest);
    out
}

/// A character reference, one of XML's five, or a small table of the HTML entities ebooks use.
/// EPUB XHTML may only rely on the XML five; the rest turn up anyway.
fn entity(name: &str) -> Option<String> {
    if let Some(num) = name.strip_prefix('#') {
        let code = match num.strip_prefix(['x', 'X']) {
            Some(hex) => u32::from_str_radix(hex, 16).ok()?,
            None => num.parse().ok()?,
        };
        return char::from_u32(code).filter(|&c| c != '\0').map(String::from);
    }
    let s = match name {
        "amp" => "&",
        "lt" => "<",
        "gt" => ">",
        "quot" => "\"",
        "apos" => "'",
        "nbsp" | "ensp" | "emsp" | "thinsp" => " ",
        "shy" => "",
        "mdash" => "\u{2014}",
        "ndash" => "\u{2013}",
        "lsquo" => "\u{2018}",
        "rsquo" => "\u{2019}",
        "sbquo" => "\u{201A}",
        "ldquo" => "\u{201C}",
        "rdquo" => "\u{201D}",
        "bdquo" => "\u{201E}",
        "laquo" => "\u{00AB}",
        "raquo" => "\u{00BB}",
        "hellip" => "\u{2026}",
        "bull" => "\u{2022}",
        "middot" => "\u{00B7}",
        "prime" => "\u{2032}",
        "Prime" => "\u{2033}",
        "dagger" => "\u{2020}",
        "Dagger" => "\u{2021}",
        "sect" => "\u{00A7}",
        "para" => "\u{00B6}",
        "deg" => "\u{00B0}",
        "times" => "\u{00D7}",
        "divide" => "\u{00F7}",
        "copy" => "\u{00A9}",
        "reg" => "\u{00AE}",
        "trade" => "\u{2122}",
        "pound" => "\u{00A3}",
        "euro" => "\u{20AC}",
        "cent" => "\u{00A2}",
        "yen" => "\u{00A5}",
        _ => return None,
    };
    Some(s.to_string())
}

/// Hard ceilings on what an EPUB may inflate to. The compressed file is capped separately, by
/// `corpus.rs`, but a zip can inflate a thousandfold, so the compressed cap alone proves nothing.
pub(crate) struct Limits {
    pub max_entries: usize,
    pub max_entry_bytes: u64,
    pub max_total_bytes: u64,
}

impl Default for Limits {
    fn default() -> Self {
        Limits { max_entries: 10_000, max_entry_bytes: 16 * 1024 * 1024, max_total_bytes: 64 * 1024 * 1024 }
    }
}

#[derive(Serialize, Debug, PartialEq)]
pub struct Section {
    pub title: String,
    /// The chapter's path inside the archive, resolved against the OPF.
    pub href: String,
    pub text: String,
}

struct Book<'a, R> {
    zip: ZipArchive<R>,
    limits: &'a Limits,
    inflated: u64,
}

impl<R: Read + Seek> Book<'_, R> {
    /// Read one entry, never trusting its declared size: `take(limit + 1)` is what stops a bomb.
    fn read(&mut self, name: &str) -> Result<String, String> {
        let entry = self.zip.by_name(name).map_err(|e| format!("cannot open {name}: {e}"))?;
        let mut buf = Vec::new();
        entry
            .take(self.limits.max_entry_bytes.saturating_add(1))
            .read_to_end(&mut buf)
            .map_err(|e| format!("cannot inflate {name}: {e}"))?;
        let len = buf.len() as u64;
        if len > self.limits.max_entry_bytes {
            return Err(format!("{name} inflates past the {} byte entry limit", self.limits.max_entry_bytes));
        }
        self.inflated = self.inflated.saturating_add(len);
        if self.inflated > self.limits.max_total_bytes {
            return Err(format!("book inflates past the {} byte total limit", self.limits.max_total_bytes));
        }
        Ok(String::from_utf8_lossy(&buf).into_owned())
    }
}

fn attr(e: &BytesStart, key: &[u8]) -> Option<String> {
    e.attributes()
        .flatten()
        .find(|a| a.key.local_name().as_ref() == key)
        .map(|a| decode_entities(&String::from_utf8_lossy(&a.value)))
}

/// Every start or empty element with this local name, in document order.
fn elements(xml: &str, name: &[u8], what: &str) -> Result<Vec<BytesStart<'static>>, String> {
    let mut reader = Reader::from_str(xml.trim_start_matches('\u{FEFF}'));
    let mut found = Vec::new();
    loop {
        match reader.read_event() {
            Ok(Event::Start(e) | Event::Empty(e)) if e.local_name().as_ref() == name => found.push(e.into_owned()),
            Ok(Event::Eof) => return Ok(found),
            Ok(_) => {}
            Err(e) => return Err(format!("{what} is not valid XML: {e}")),
        }
    }
}

fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while let Some(&b) = bytes.get(i) {
        let hex = bytes.get(i + 1..i + 3).and_then(|h| std::str::from_utf8(h).ok());
        match hex.filter(|_| b == b'%').and_then(|h| u8::from_str_radix(h, 16).ok()) {
            Some(decoded) => {
                out.push(decoded);
                i += 3;
            }
            None => {
                out.push(b);
                i += 1;
            }
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// Resolve a manifest href against the OPF's folder. None for an absolute path or one whose `..`
/// climbs out of the archive: both are treated as missing. Nothing is ever written to disk, so
/// there is no zip-slip to defend against here, only a wrong read.
fn resolve_href(opf_dir: &str, href: &str) -> Option<String> {
    let href = percent_decode(href.split('#').next().unwrap_or_default());
    if href.starts_with(['/', '\\']) || href.contains(':') {
        return None;
    }
    let mut parts: Vec<&str> = Vec::new();
    for seg in opf_dir.split('/').chain(href.split('/')) {
        match seg {
            "" | "." => {}
            ".." => {
                parts.pop()?;
            }
            _ => parts.push(seg),
        }
    }
    Some(parts.join("/"))
}

/// An EPUB (2 or 3) as text sections in spine order: `container.xml` → OPF → manifest + spine →
/// each linear spine item through `xhtml_to_text`. Sections are what a small model can take one at
/// a time; a whole book is not. Pages with no text (a cover image) are left out.
///
/// Every failure is an `Err` string: not a zip, a missing or malformed `container.xml` or OPF, a
/// spine item that is absent or escapes the archive, invalid XHTML, or a limit in `Limits`.
pub(crate) fn extract_epub<R: Read + Seek>(r: R, limits: &Limits) -> Result<Vec<Section>, String> {
    let zip = ZipArchive::new(r).map_err(|e| format!("not an EPUB (zip): {e}"))?;
    if zip.len() > limits.max_entries {
        return Err(format!("archive has {} entries, over the {} entry limit", zip.len(), limits.max_entries));
    }
    let mut book = Book { zip, limits, inflated: 0 };

    let container = book.read("META-INF/container.xml")?;
    let opf_path = elements(&container, b"rootfile", "container.xml")?
        .iter()
        .find_map(|e| attr(e, b"full-path"))
        .ok_or("container.xml names no rootfile")?;
    let opf = book.read(&opf_path)?;
    let opf_dir = opf_path.rsplit_once('/').map(|(dir, _)| dir).unwrap_or_default();

    let manifest: HashMap<String, String> = elements(&opf, b"item", &opf_path)?
        .iter()
        .filter_map(|e| Some((attr(e, b"id")?, attr(e, b"href")?)))
        .collect();
    let spine: Vec<String> = elements(&opf, b"itemref", &opf_path)?
        .iter()
        .filter(|e| attr(e, b"linear").as_deref() != Some("no"))
        .map(|e| attr(e, b"idref").ok_or_else(|| format!("{opf_path}: itemref without idref")))
        .collect::<Result<_, _>>()?;

    let mut sections = Vec::new();
    for idref in spine {
        let href = manifest.get(&idref).ok_or_else(|| format!("spine item {idref} is not in the manifest"))?;
        let path = resolve_href(opf_dir, href).ok_or_else(|| format!("spine item {href} points outside the book"))?;
        let page = xhtml_to_text(&book.read(&path)?).map_err(|e| format!("{path}: {e}"))?;
        if page.text.is_empty() {
            continue;
        }
        sections.push(Section { title: page.title.unwrap_or_else(|| path.clone()), href: path, text: page.text });
    }
    Ok(sections)
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    fn text(xml: &str) -> String {
        xhtml_to_text(xml).unwrap().text
    }

    fn title(xml: &str) -> Option<String> {
        xhtml_to_text(xml).unwrap().title
    }

    #[test]
    fn blocks_become_lines_and_inline_runs_join() {
        let xml = "<html><body><p>One <em>two</em>\n   three</p><p>Four<br/>five</p><ul><li>a</li><li>b</li></ul></body></html>";
        assert_eq!(text(xml), "One two three\nFour\nfive\na\nb");
    }

    #[test]
    fn head_script_and_style_are_dropped() {
        let xml = "<html><head><title>T</title><style>p { color: red }</style></head>\
                   <body><script>alert(1)</script><p>Kept</p><style>.x{}</style></body></html>";
        assert_eq!(text(xml), "Kept");
    }

    #[test]
    fn xml_numeric_and_named_entities_decode() {
        let xml = "<p>a &amp; b &lt;c&gt; &#233;&#xE9; &mdash;&rsquo;&ldquo;&rdquo;&hellip;x&nbsp;y</p>";
        assert_eq!(text(xml), "a & b <c> éé \u{2014}\u{2019}\u{201C}\u{201D}\u{2026}x y");
    }

    #[test]
    fn an_unknown_entity_is_kept_as_written_not_an_error() {
        assert_eq!(text("<p>Tom &foo; Jerry &#xZZ; &#0; end</p>"), "Tom &foo; Jerry &#xZZ; &#0; end");
    }

    #[test]
    fn cdata_is_text() {
        assert_eq!(text("<p><![CDATA[a < b]]></p>"), "a < b");
    }

    #[test]
    fn namespaced_tags_match_on_their_local_name() {
        let xml = r#"<h:html xmlns:h="http://www.w3.org/1999/xhtml"><h:body><h:p>a</h:p><h:script>x</h:script><h:p>b</h:p></h:body></h:html>"#;
        assert_eq!(text(xml), "a\nb");
    }

    #[test]
    fn a_leading_bom_and_doctype_are_ignored() {
        let xml = "\u{FEFF}<?xml version=\"1.0\"?><!DOCTYPE html><html><body><p>a</p></body></html>";
        assert_eq!(text(xml), "a");
    }

    #[test]
    fn title_prefers_the_first_non_empty_heading() {
        let xml = "<html><head><title>Doc</title></head><body><h1><img src='x'/></h1>\
                   <h2>Chapter <span>I</span></h2><h3>Later</h3></body></html>";
        assert_eq!(title(xml).as_deref(), Some("Chapter I"));
    }

    #[test]
    fn title_falls_back_to_the_title_element_then_none() {
        assert_eq!(title("<html><head><title> The   Doc </title></head><body><h4>no</h4></body></html>").as_deref(), Some("The Doc"));
        assert_eq!(title("<html><body><p>x</p></body></html>"), None);
    }

    #[test]
    fn a_heading_inside_script_is_not_a_title() {
        assert_eq!(title("<html><body><script><h1>no</h1></script><h2>yes</h2></body></html>").as_deref(), Some("yes"));
    }

    #[test]
    fn malformed_xml_is_an_error() {
        let err = xhtml_to_text("<html><body><p>open</div></body></html>").err().unwrap();
        assert!(err.starts_with("invalid XML"), "{err}");
        assert!(xhtml_to_text("<p>a & b</p>").is_err());
    }

    #[test]
    fn attribute_entities_decode_and_unknown_ones_survive() {
        assert_eq!(decode_entities("a&amp;b"), "a&b");
        assert_eq!(decode_entities("&#x2F;x&#47;"), "/x/");
        assert_eq!(decode_entities("&foo; & &amp"), "&foo; & &amp");
        assert_eq!(decode_entities("caf&eacute;"), "caf&eacute;");
        assert_eq!(decode_entities(""), "");
    }

    // EPUB. Every book is built in memory; no binary fixtures.

    use std::io::{Cursor, Write};
    use zip::write::SimpleFileOptions;
    use zip::{CompressionMethod, ZipWriter};

    pub(crate) fn zip_of(entries: &[(&str, &[u8])]) -> Vec<u8> {
        let mut w = ZipWriter::new(Cursor::new(Vec::new()));
        let opts = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
        for (name, bytes) in entries {
            w.start_file(*name, opts).unwrap();
            w.write_all(bytes).unwrap();
        }
        w.finish().unwrap().into_inner()
    }

    const CONTAINER: &str = r#"<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>"#;

    fn opf(items: &[(&str, &str)], spine: &str) -> String {
        let manifest: String = items
            .iter()
            .map(|(id, href)| format!(r#"<item id="{id}" href="{href}" media-type="application/xhtml+xml"/>"#))
            .collect();
        format!(
            r#"<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0">
<metadata/><manifest>{manifest}</manifest><spine>{spine}</spine></package>"#
        )
    }

    fn page(heading: &str, body: &str) -> String {
        format!(r#"<html xmlns="http://www.w3.org/1999/xhtml"><head><title>t</title></head><body><h1>{heading}</h1>{body}</body></html>"#)
    }

    /// A book whose OPF sits in OEBPS/, with these (path under OEBPS, content) chapters.
    pub(crate) fn epub(opf: &str, docs: &[(&str, &str)]) -> Vec<u8> {
        let paths: Vec<String> = docs.iter().map(|(p, _)| format!("OEBPS/{p}")).collect();
        let mut entries: Vec<(&str, &[u8])> = vec![
            ("mimetype", b"application/epub+zip"),
            ("META-INF/container.xml", CONTAINER.as_bytes()),
            ("OEBPS/content.opf", opf.as_bytes()),
        ];
        entries.extend(paths.iter().zip(docs).map(|(p, (_, c))| (p.as_str(), c.as_bytes())));
        zip_of(&entries)
    }

    fn extract(bytes: Vec<u8>) -> Result<Vec<Section>, String> {
        extract_epub(Cursor::new(bytes), &Limits::default())
    }

    fn titles(sections: &[Section]) -> Vec<&str> {
        sections.iter().map(|s| s.title.as_str()).collect()
    }

    pub(crate) fn three_chapter_book() -> Vec<u8> {
        let o = opf(
            &[("c1", "c1.xhtml"), ("c2", "c2.xhtml"), ("c3", "c3.xhtml")],
            r#"<itemref idref="c3"/><itemref idref="c1"/><itemref idref="c2"/>"#,
        );
        epub(
            &o,
            &[
                ("c1.xhtml", &page("One", "<p>a</p>")),
                ("c2.xhtml", &page("Two", "<p>b</p>")),
                ("c3.xhtml", &page("Three", "<p>c</p>")),
            ],
        )
    }

    #[test]
    fn sections_follow_the_spine_not_the_manifest() {
        let s = extract(three_chapter_book()).unwrap();
        assert_eq!(titles(&s), vec!["Three", "One", "Two"]);
        assert_eq!(s[0], Section { title: "Three".into(), href: "OEBPS/c3.xhtml".into(), text: "Three\nc".into() });
    }

    #[test]
    fn linear_no_items_are_skipped() {
        let o = opf(&[("a", "a.xhtml"), ("b", "b.xhtml")], r#"<itemref idref="a" linear="no"/><itemref idref="b" linear="yes"/>"#);
        let s = extract(epub(&o, &[("a.xhtml", &page("A", "")), ("b.xhtml", &page("B", ""))])).unwrap();
        assert_eq!(titles(&s), vec!["B"]);
    }

    // Shaped like a Project Gutenberg EPUB 2: OPF 2.0, an NCX in the manifest, the XHTML 1.1
    // doctype, a style block, and the named entities Gutenberg's HTML uses.
    #[test]
    fn an_epub2_book_reads_as_clean_text() {
        let o = r#"<?xml version='1.0' encoding='utf-8'?>
<package xmlns="http://www.idpf.org/2007/opf" version="2.0" unique-identifier="id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf">
    <dc:title>Pride and Prejudice</dc:title><dc:language>en</dc:language>
  </metadata>
  <manifest>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
    <item id="item5" href="Text/ch1.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine toc="ncx"><itemref idref="item5" linear="yes"/></spine>
</package>"#;
        let ch = r#"<?xml version='1.0' encoding='utf-8'?>
<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.1//EN" "http://www.w3.org/TR/xhtml11/DTD/xhtml11.dtd">
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>The Project Gutenberg eBook</title>
<style type="text/css">p { text-indent: 1em }</style></head>
<body><div class="chapter"><h2><a id="c1"></a>Chapter I.</h2>
<p>It is a truth universally acknowledged, that a single man in possession
of a good fortune, must be in want of a wife.</p>
<p>&ldquo;My dear Mr.&nbsp;Bennet,&rdquo; said his lady to him one day, &ldquo;have you heard
that Netherfield Park is let at last?&rdquo;&mdash;</p><script>var x = 1;</script></div></body></html>"#;
        let s = extract(epub(o, &[("Text/ch1.xhtml", ch)])).unwrap();
        assert_eq!(s.len(), 1);
        assert_eq!(s[0].title, "Chapter I.");
        assert_eq!(s[0].href, "OEBPS/Text/ch1.xhtml");
        let want = [
            "Chapter I.",
            "It is a truth universally acknowledged, that a single man in possession of a good fortune, must be in want of a wife.",
            "\u{201C}My dear Mr. Bennet,\u{201D} said his lady to him one day, \u{201C}have you heard that Netherfield Park is let at last?\u{201D}\u{2014}",
        ];
        assert_eq!(s[0].text, want.join("\n"));
        assert!(!s[0].text.contains('<') && !s[0].text.contains("var x") && !s[0].text.contains("text-indent"));
    }

    // Shaped like an EPUB 3 from Standard Ebooks: OPF 3.0, a nav document in the manifest but not
    // the spine, epub:type attributes, a cover page with no text, and a percent-encoded href.
    #[test]
    fn an_epub3_book_reads_as_clean_text() {
        let o = r#"<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid" prefix="se: https://standardebooks.org/vocab/1.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Walden</dc:title></metadata>
  <manifest>
    <item id="toc.xhtml" href="toc.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="cover.xhtml" href="text/cover.xhtml" media-type="application/xhtml+xml"/>
    <item id="economy.xhtml" href="text/economy.xhtml" media-type="application/xhtml+xml"/>
    <item id="where-i-lived.xhtml" href="text/where%20i%20lived.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine><itemref idref="cover.xhtml"/><itemref idref="economy.xhtml"/><itemref idref="where-i-lived.xhtml"/></spine>
</package>"#;
        let ch = |h: &str, p: &str| {
            format!(
                r#"<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><title>{h}</title><link href="../css/core.css" rel="stylesheet" type="text/css"/></head>
<body epub:type="bodymatter z3998:fiction"><section id="x" epub:type="chapter"><h2 epub:type="title">{h}</h2><p>{p}</p></section></body></html>"#
            )
        };
        let cover = r#"<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Cover</title></head><body><img src="../images/cover.svg" alt=""/></body></html>"#;
        let s = extract(epub(
            o,
            &[
                ("toc.xhtml", &ch("Table of Contents", "nav")),
                ("text/cover.xhtml", cover),
                ("text/economy.xhtml", &ch("Economy", "When I wrote the following pages&#8212;or rather the bulk of them&#8212;I lived alone.")),
                ("text/where i lived.xhtml", &ch("Where I Lived", "At a certain season of our life&#8230;")),
            ],
        ))
        .unwrap();
        assert_eq!(titles(&s), vec!["Economy", "Where I Lived"]);
        assert_eq!(s[0].text, "Economy\nWhen I wrote the following pages\u{2014}or rather the bulk of them\u{2014}I lived alone.");
        assert_eq!(s[1].href, "OEBPS/text/where i lived.xhtml");
    }

    #[test]
    fn a_page_without_a_heading_or_title_is_titled_by_its_href() {
        let o = opf(&[("a", "a.xhtml")], r#"<itemref idref="a"/>"#);
        let s = extract(epub(&o, &[("a.xhtml", "<html><body><p>x</p></body></html>")])).unwrap();
        assert_eq!(titles(&s), vec!["OEBPS/a.xhtml"]);
    }

    #[test]
    fn hrefs_resolve_against_the_opf_folder_and_percent_decode() {
        assert_eq!(resolve_href("OEBPS", "../Text/ch%201.xhtml#top").as_deref(), Some("Text/ch 1.xhtml"));
        assert_eq!(resolve_href("", "./a/./b.xhtml").as_deref(), Some("a/b.xhtml"));
        assert_eq!(resolve_href("OEBPS", "100%.xhtml").as_deref(), Some("OEBPS/100%.xhtml"));
        assert_eq!(resolve_href("OEBPS", "%E2%80%94.xhtml").as_deref(), Some("OEBPS/\u{2014}.xhtml"));
    }

    #[test]
    fn hrefs_that_escape_the_archive_resolve_to_nothing() {
        assert_eq!(resolve_href("OEBPS", "../../evil.xhtml"), None);
        assert_eq!(resolve_href("", "../x.xhtml"), None);
        assert_eq!(resolve_href("OEBPS", "/OEBPS/c1.xhtml"), None);
        assert_eq!(resolve_href("OEBPS", "%2Fetc%2Fpasswd"), None);
        assert_eq!(resolve_href("OEBPS", "C:/Windows/win.ini"), None);
        assert_eq!(resolve_href("OEBPS", "http://example.com/c1.xhtml"), None);
    }

    #[test]
    fn an_escaping_spine_href_is_an_error() {
        let o = opf(&[("x", "../../x.xhtml")], r#"<itemref idref="x"/>"#);
        assert_eq!(extract(epub(&o, &[])).unwrap_err(), "spine item ../../x.xhtml points outside the book");
    }

    #[test]
    fn a_bad_named_entity_does_not_fail_the_book() {
        let o = opf(&[("a", "a.xhtml"), ("b", "b.xhtml")], r#"<itemref idref="a"/><itemref idref="b"/>"#);
        let s = extract(epub(&o, &[("a.xhtml", &page("A", "<p>Tom &bogus; Jerry</p>")), ("b.xhtml", &page("B", "<p>ok</p>"))])).unwrap();
        assert_eq!(titles(&s), vec!["A", "B"]);
        assert_eq!(s[0].text, "A\nTom &bogus; Jerry");
    }

    #[test]
    fn malformed_books_are_errors_not_panics() {
        let err = |bytes: Vec<u8>| extract(bytes).unwrap_err();
        let one = |id: &str| opf(&[(id, "a.xhtml")], r#"<itemref idref="a"/>"#);
        let starts = |e: String, prefix: &str| assert!(e.starts_with(prefix), "{e}");

        starts(err(b"PK\x03\x04 but not really a zip".to_vec()), "not an EPUB (zip)");
        starts(err(Vec::new()), "not an EPUB (zip)");
        starts(err(zip_of(&[("mimetype", b"application/epub+zip")])), "cannot open META-INF/container.xml");
        assert_eq!(err(zip_of(&[("META-INF/container.xml", b"<container><rootfiles/></container>")])), "container.xml names no rootfile");
        starts(err(zip_of(&[("META-INF/container.xml", b"<container><rootfile></container>")])), "container.xml is not valid XML");
        starts(err(zip_of(&[("META-INF/container.xml", CONTAINER.as_bytes())])), "cannot open OEBPS/content.opf");
        starts(err(epub("<package><manifest></package>", &[])), "OEBPS/content.opf is not valid XML");
        starts(err(epub(&one("a"), &[])), "cannot open OEBPS/a.xhtml");
        assert_eq!(err(epub(&one("zzz"), &[("a.xhtml", "<p/>")])), "spine item a is not in the manifest");
        starts(err(epub(&one("a"), &[("a.xhtml", "<html><body><p>open</div></body></html>")])), "OEBPS/a.xhtml: invalid XML");
        assert_eq!(err(epub("<package><spine><itemref/></spine></package>", &[])), "OEBPS/content.opf: itemref without idref");
    }

    fn tight(max_entries: usize, max_entry_bytes: u64, max_total_bytes: u64) -> Limits {
        Limits { max_entries, max_entry_bytes, max_total_bytes }
    }

    #[test]
    fn a_zip_bomb_is_refused_at_the_entry_limit() {
        let o = opf(&[("a", "a.xhtml")], r#"<itemref idref="a"/>"#);
        let bomb = format!("<p>{}</p>", "a".repeat(4 * 1024 * 1024));
        let bytes = epub(&o, &[("a.xhtml", &bomb)]);
        assert!(bytes.len() < 64 * 1024, "{} bytes is not a bomb", bytes.len());
        let err = extract_epub(Cursor::new(bytes), &tight(100, 1024 * 1024, u64::MAX)).unwrap_err();
        assert_eq!(err, "OEBPS/a.xhtml inflates past the 1048576 byte entry limit");
    }

    // The real limit, not a scaled-down one: 17 MiB inflating from a few KiB.
    #[test]
    fn a_zip_bomb_is_refused_at_the_default_limits() {
        let o = opf(&[("a", "a.xhtml")], r#"<itemref idref="a"/>"#);
        let bytes = epub(&o, &[("a.xhtml", &"a".repeat(17 * 1024 * 1024))]);
        assert!(bytes.len() < 256 * 1024, "{} bytes is not a bomb", bytes.len());
        assert_eq!(extract(bytes).unwrap_err(), "OEBPS/a.xhtml inflates past the 16777216 byte entry limit");
    }

    #[test]
    fn the_total_limit_spans_entries() {
        let o = opf(&[("a", "a.xhtml"), ("b", "b.xhtml")], r#"<itemref idref="a"/><itemref idref="b"/>"#);
        let ch = format!("<p>{}</p>", "a".repeat(40_000));
        let bytes = epub(&o, &[("a.xhtml", &ch), ("b.xhtml", &ch)]);
        assert_eq!(extract_epub(Cursor::new(bytes.clone()), &tight(100, 50_000, 1_000_000)).unwrap().len(), 2);
        let err = extract_epub(Cursor::new(bytes), &tight(100, 50_000, 60_000)).unwrap_err();
        assert_eq!(err, "book inflates past the 60000 byte total limit");
    }

    #[test]
    fn too_many_entries_is_refused_before_anything_is_read() {
        let err = extract_epub(Cursor::new(three_chapter_book()), &tight(5, u64::MAX, u64::MAX)).unwrap_err();
        assert_eq!(err, "archive has 6 entries, over the 5 entry limit");
        assert_eq!(extract_epub(Cursor::new(three_chapter_book()), &tight(6, u64::MAX, u64::MAX)).unwrap().len(), 3);
    }

    #[test]
    fn default_limits_are_the_issue_defaults() {
        let l = Limits::default();
        assert_eq!((l.max_entries, l.max_entry_bytes, l.max_total_bytes), (10_000, 16 << 20, 64 << 20));
    }
}
