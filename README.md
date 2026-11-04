![Droid Stream](assets/brand/logo.png)

# Droid Stream

Android app for streaming and casting media, built by **Tordroid** (Tordroid Universal Labs).

Based on Vega by [vega-org](https://github.com/vega-org/vega-app).

- Website: https://tordroid.com
- Support: https://t.me/Tordroid_admin
- Releases: https://github.com/1tordroid/Droid-Stream/releases

Droid Stream installs beside the original Vega app. Its Android application id is `com.tordroid.droidstream` (Play builds use `com.tordroid.droidstream.play`).

### Features
- Stream and download.
- Cast support: Google Cast/DLNA, plus Vega Cast so existing Vega receivers still pair.
- Watch list.
- External player and downloader support.
- Sync with the Vega desktop app.
- The same provider plugins Vega runs.
- In-app updates from this repository's GitHub Releases.

## Plugins

Droid Stream runs the provider extensions Vega runs. The rebrand does not change the module shape, the sandbox, or the identifiers those plugins already use.

On a fresh install the default source is the official catalog. In **Settings → Extensions**, add `vega-org` (or paste `https://github.com/vega-org/vega-providers`). That resolves to:

`https://raw.githubusercontent.com/vega-org/vega-providers/refs/heads/main`

Short names keep Vega's repository name, so the same author still works on GitHub, Codeberg (`author@cb`), Bitbucket (`author@bb`), and GitLab (`author@gl`). A full repo URL or any other `http`/`https` link to a `manifest.json` adds a custom source. Private GitHub sources and custom manifest URLs can take an access token. Other people can also send a source with the intent action `vega.intent.action.ADD_SOURCE` (a `url` extra, and an optional `token` extra).

The app downloads `manifest.json` from the source, then each provider's files:

| File | Required | Export |
| --- | --- | --- |
| `posts.js` | yes | `getPosts`, `getSearchPosts` |
| `meta.js` | yes | `getMeta` |
| `stream.js` | yes | `getStream` |
| `catalog.js` | yes | `catalog`, `genres` |
| `episodes.js` | no | `getEpisodes` |
| `settings.js` | no | `getSettingsSchema` |

Files live in `dist/{value}/` unless the manifest entry sets a relative `path`. Each function receives `providerContext` (`axios`, `cheerio`, `Crypto`, `commonHeaders`, `getBaseUrl`, `openWebView`, `getCookies`, `kvStore`). A module may start with the Vega version header, which is still checked as-is:

```js
// @vega-provider myProvider
// @vega-version 1.0.0
```

These stay compatible with existing plugins and are not renamed:

- Provider storage keys (`providerSources`, `installedProviders`, `providerModules`, and the `provider_kv` / `provider_cookies` stores).
- Deep links `com.vega://`, `vegaapp://`, and `vega-cast://`, in addition to `droidstream://`.
- The add-source intent action `vega.intent.action.ADD_SOURCE`.
- Backup files still use `"app": "vega"` so a Vega provider backup restores here.
- Sync with Vega desktop still uses the `.vega-sync` folder and `vega-phone.json`.
- Vega Cast still speaks the `vega-cast:` protocol and the public cast service.

## Updates

On launch, and from **Settings → About → Check for updates**, the app reads the latest stable release of `1tordroid/Droid-Stream` and compares its `vX.Y.Z` tag with the installed version. A newer release opens a dialog with the changelog. **Download and install** saves the APK and starts Android's package installer, asking for permission to install unknown apps when that is turned off. **Skip this version** hides that tag on later automatic checks. Checking again from Settings still shows it.

The release APK is chosen by filename: `mobile` on a phone, `tv` on Android TV, then `universal`, then any `.apk`. The tag workflow publishes one file named `DroidStream-universal-vX.Y.Z.apk`, which both builds accept. Play builds do not include the installer permission, so they hide this updater.

Pushing a tag such as `v5.3.3` runs `.github/workflows/release.yml`, which builds a signed release APK and publishes it on that GitHub Release. The tag must be higher than the version in `app.config.js` (`version` / `versionCode`).

### Release signing

The release workflow fails closed until these repository secrets exist. It will not publish an APK signed with the debug key.

| Secret | Purpose |
| --- | --- |
| `KEYSTORE_BASE64` | Base64 of the upload keystore (`base64 -w 0 your.keystore`) |
| `KEYSTORE_PASSWORD` | Keystore password |
| `KEY_ALIAS` | Key alias |
| `KEY_PASSWORD` | Key password |
| `TMDB_API_KEY` | Optional. Bundled TMDB key. Users can set their own in Settings. |
| `PROXY_API_URL` | Optional. Metadata proxy URL baked into the build. |

Nightly and action builds read the same keystore secrets from the `nightly` GitHub environment. Keep using one upload key so updates install over previous Droid Stream releases.

## Build

0. Set up a React Native environment. [Guide](https://reactnative.dev/docs/set-up-your-environment)

1. Clone

```bash
git clone https://github.com/1tordroid/Droid-Stream.git
cd Droid-Stream
```

2. Install

```bash
npm install
```

3. Prebuild and run

```bash
npx expo prebuild -p android --clean
npm run android
```

`extra.eas.projectId` in `app.config.js` is still the upstream Expo project. Replace it with a Tordroid project before using EAS.

Regenerate launcher, splash, and notification art from `assets/brand/tordroid-logo.jpg` with:

```bash
python3 scripts/generate-brand-assets.py
```

---

> [!IMPORTANT]
> Droid Stream does not host, store, or provide any media content. It is not affiliated with or connected to any external providers or extensions. All content accessed through the app is managed and sourced directly by the user via third-party tools or integrations. Droid Stream has no control over it.

Droid Stream is a noncommercial fork of Vega. Vega is licensed under the PolyForm Noncommercial License 1.0.0. See `LICENSE` and `NOTICE`. Personal and other noncommercial use is free. This project does not add ads, payments, or other commercial features. Do not remove the `Required Notice:` lines.
