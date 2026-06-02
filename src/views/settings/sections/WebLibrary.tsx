import { useEffect, useState } from "react";
import {
  getTavilyApiKey, setTavilyApiKey,
  getLibraryEnabled, setLibraryEnabled,
  getLibraryUrl, setLibraryUrl,
} from "../../../lib/store";
import { Section, SettingRow, SecretField, Toggle, Disclosure, INPUT_CLS, useSettings } from "../primitives";

export default function WebLibrary() {
  const { markSaved } = useSettings();
  const [tavilyKey, setTavilyKey] = useState("");
  const [libraryEnabled, setLibraryEnabledState] = useState(true);
  const [libraryUrl, setLibraryUrlState] = useState("");

  useEffect(() => {
    (async () => {
      setTavilyKey((await getTavilyApiKey()) || "");
      setLibraryEnabledState(await getLibraryEnabled());
      setLibraryUrlState((await getLibraryUrl()) || "");
    })();
  }, []);

  return (
    <>
      <Section
        title="Web Search"
        description="Optional. A Tavily key lets the tutor ground curriculum research in current web data. Free tier: 1,000 searches/month at tavily.com."
        keywords="web search tavily internet research grounding key online"
      >
        <SettingRow label="Tavily API key">
          <SecretField
            value={tavilyKey}
            placeholder="Tavily API key (tvly-…)"
            onSave={async (k) => { await setTavilyApiKey(k); setTavilyKey(k); markSaved(); }}
            footnote={tavilyKey ? "Web search enabled — courses will be grounded in current data." : "Leave empty to keep the tutor fully offline."}
          />
        </SettingRow>
      </Section>

      <Section
        title="OpenEdu Library"
        description="A curated reference library (periodic table, formulas, definitions…) bundled with the app — fully offline, no key or network needed. The tutor can consult it mid-lesson and you can browse it in a course's Resources tab."
        keywords="library reference offline curated periodic table formulas definitions resources lookup bundled"
      >
        <SettingRow label="Let the tutor consult the OpenEdu Library" help="Turn off to hide the library from the tutor and the Resources tab.">
          <Toggle
            checked={libraryEnabled}
            onChange={async (next) => { setLibraryEnabledState(next); await setLibraryEnabled(next); markSaved(); }}
            labelOn="Enabled — works offline, cited as a source in chat"
            labelOff="Disabled — hidden from the tutor"
          />
        </SettingRow>

        <Disclosure summary="Advanced — custom library source">
          <SettingRow
            label="Library base URL override"
            help="Point at a remote static host to fetch a larger/updated corpus (must be allow-listed in capabilities). Leave empty to use the bundled offline copy."
            keywords="library url override remote host corpus advanced"
          >
            <input
              type="text"
              value={libraryUrl}
              onChange={(e) => setLibraryUrlState(e.target.value)}
              onBlur={async () => { await setLibraryUrl(libraryUrl.trim()); markSaved(); }}
              placeholder="https://library.openedu.app/"
              className={INPUT_CLS}
              spellCheck={false}
            />
          </SettingRow>
        </Disclosure>
      </Section>
    </>
  );
}
