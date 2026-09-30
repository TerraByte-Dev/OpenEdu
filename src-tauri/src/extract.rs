//! Text extraction from document formats. Pure functions over bytes: no Tauri, no filesystem.
//!
//! Everything here runs on untrusted input under `panic = "abort"`, where a panic is a crash rather
//! than an error. So: no `unwrap`, no `expect`, no unchecked indexing on document data.

use quick_xml::events::{BytesRef, Event};
use quick_xml::Reader;

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
        if self.heading.is_none() && self.hidden == 0 && is_title_heading(name) {
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

#[cfg(test)]
mod tests {
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
}
