#!/usr/bin/env bash
# AnyAmp! veröffentlichen:  ./scripts/release.sh 0.0.4 notes.md
#
# Setzt die Version, baut signiert (Tauri-Updater), legt Zip (manuelle Installation),
# Update-Paket und latest.json an, committet, taggt, pusht und erstellt das GitHub-Release.
# Der private Signaturschlüssel liegt außerhalb des Repos: ~/.tauri/anyamp-updater.key
set -euo pipefail

VERSION=${1:?Version angeben, z. B. 0.0.4}
NOTES_FILE=${2:?Datei mit Release-Notizen (Markdown) angeben}
REPO=Online-Netcom/AnyAmp
KEY=${TAURI_SIGNING_PRIVATE_KEY_PATH:-$HOME/.tauri/anyamp-updater.key}
ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT"

[[ $VERSION =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "Version muss x.y.z sein"; exit 1; }
[[ -f $NOTES_FILE ]] || { echo "Notizen fehlen: $NOTES_FILE"; exit 1; }
[[ -f $KEY ]] || { echo "Signaturschlüssel fehlt: $KEY"; exit 1; }
[[ -z $(git status --porcelain) ]] || { echo "Arbeitsverzeichnis nicht sauber – erst committen"; exit 1; }
[[ $(git branch --show-current) == main ]] || { echo "Bitte auf main veröffentlichen"; exit 1; }
export PATH="$HOME/.cargo/bin:$PATH"

echo "→ Version $VERSION setzen"
node -e '
  const fs = require("fs"), v = process.argv[1];
  for (const f of ["package.json", "src-tauri/tauri.conf.json"]) {
    const j = JSON.parse(fs.readFileSync(f, "utf8")); j.version = v;
    fs.writeFileSync(f, JSON.stringify(j, null, 2) + "\n");
  }' "$VERSION"
# nur die erste „version = …“-Zeile (das Paket selbst, nicht Abhängigkeiten)
perl -0pi -e "s/^version = \".*?\"/version = \"$VERSION\"/m" src-tauri/Cargo.toml
npm install --package-lock-only --silent

echo "→ Signiert bauen"
TAURI_SIGNING_PRIVATE_KEY=$(cat "$KEY") TAURI_SIGNING_PRIVATE_KEY_PASSWORD="" \
  npm run tauri build -- --bundles app

BUNDLE="src-tauri/target/release/bundle/macos"
APP="$BUNDLE/AnyAmp!.app"
[[ $(defaults read "$ROOT/$APP/Contents/Info.plist" CFBundleShortVersionString) == "$VERSION" ]] ||
  { echo "Gebaute Version passt nicht"; exit 1; }

echo "→ Pakete"
rm -rf dist && mkdir -p dist
ditto -c -k --keepParent "$APP" "dist/AnyAmp-$VERSION-macos-arm64.zip"
UPDATE="AnyAmp_${VERSION}_aarch64.app.tar.gz"
cp "$APP.tar.gz" "dist/$UPDATE"
node -e '
  const fs = require("fs"), [v, sig, file, repo, notes] = process.argv.slice(1);
  fs.writeFileSync("dist/latest.json", JSON.stringify({
    version: v,
    notes: fs.readFileSync(notes, "utf8"),
    pub_date: new Date().toISOString(),
    platforms: { "darwin-aarch64": {
      signature: fs.readFileSync(sig, "utf8").trim(),
      url: `https://github.com/${repo}/releases/download/v${v}/${file}`,
    } },
  }, null, 2));' "$VERSION" "$APP.tar.gz.sig" "$UPDATE" "$REPO" "$NOTES_FILE"

echo "→ Commit, Tag, Push"
git add package.json package-lock.json src-tauri/tauri.conf.json src-tauri/Cargo.toml src-tauri/Cargo.lock
git commit -q -m "Version $VERSION"
git tag -a "v$VERSION" -m "AnyAmp! $VERSION"
git push -q
git push -q origin "v$VERSION"

echo "→ GitHub-Release"
gh release create "v$VERSION" --repo "$REPO" --title "AnyAmp! $VERSION" --notes-file "$NOTES_FILE" \
  "dist/AnyAmp-$VERSION-macos-arm64.zip" "dist/$UPDATE" dist/latest.json

echo "✓ AnyAmp! $VERSION veröffentlicht – installierte Versionen ab 0.0.4 bieten das Update an."
