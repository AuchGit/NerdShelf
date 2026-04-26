# Android Setup — One-time CI Configuration

The release workflow can build a signed Android APK and wire it into the
auto-updater. This requires a release keystore and four GitHub secrets.
You only need to do this once.

## 1. Generate a release keystore (locally)

```bash
keytool -genkey -v \
  -keystore release.keystore \
  -alias nerdshelf \
  -keyalg RSA -keysize 2048 \
  -validity 10000
```

You will be prompted for:
- A keystore password (remember it — required for every release)
- A key password (use the **same** as keystore password to keep it simple)
- Name / org / location (only used inside the cert; pick whatever)

You now have `release.keystore`. **Back this file up somewhere safe.** Losing
it means you can never publish an update — Android refuses to install an APK
signed with a different cert under the same package id.

## 2. Encode the keystore for GitHub

```bash
# Linux / macOS / Git Bash
base64 -w0 release.keystore > release.keystore.b64

# PowerShell
[Convert]::ToBase64String([IO.File]::ReadAllBytes("release.keystore")) | Out-File -NoNewline release.keystore.b64
```

Open `release.keystore.b64` and copy its contents.

## 3. Add four GitHub Secrets

Repo → Settings → Secrets and variables → Actions → New repository secret.

| Name | Value |
| ---- | ----- |
| `ANDROID_KEYSTORE_BASE64` | contents of `release.keystore.b64` |
| `ANDROID_KEYSTORE_PASSWORD` | the keystore password from step 1 |
| `ANDROID_KEY_ALIAS` | `nerdshelf` (or whatever alias you used) |
| `ANDROID_KEY_PASSWORD` | the key password from step 1 |

The release workflow already has the desktop-side secrets:
`TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`,
`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`. Don't touch those.

## 4. Ship a release

```bash
git tag v0.1.13
git push origin v0.1.13
```

The workflow does:
1. Builds the Windows installer + `latest.json` (existing job).
2. Builds 4 per-ABI Android APKs (`aarch64`, `armv7`, `i686`, `x86_64`),
   signs them with both the Android keystore (so Android will install them)
   and the Tauri updater key (so the in-app updater will accept them).
3. Patches `latest.json` to add `android-<arch>` entries pointing at the APKs.

## 5. How auto-update works on Android

When the app starts on an Android device, `UpdateChecker.jsx` calls
`@tauri-apps/plugin-updater`. The plugin:
1. Fetches `latest.json` from the GitHub release endpoint configured in
   `src-tauri/tauri.conf.json`.
2. Compares the current `versionCode` with the published version.
3. If newer: shows the existing in-app banner.
4. On "Installieren": downloads the matching `android-<arch>.apk`, verifies
   its Tauri signature, then hands it to Android's package installer.
5. Android shows its standard install prompt — the user taps **"Update"**.

### One-time user step on the device

The first time the user installs an update from the in-app banner, Android
will ask for permission to "Install unknown apps from NerdShelf". They tap
**"Settings"** in the prompt → enable the toggle → return. From then on,
updates install in one tap.

### Local development (no CI)

For local Android testing without CI, drop a `keystore.properties` next to
the release keystore at `src-tauri/gen/android/app/`:

```
storeFile=release.keystore
storePassword=<your-keystore-password>
keyAlias=nerdshelf
keyPassword=<your-key-password>
```

Both `keystore.properties` and `*.keystore` are gitignored. Then:

```bash
npm run tauri android build -- --apk
```

If `keystore.properties` is missing, the build falls back to the Android
debug keystore (still installable for testing — but never push such a build
to users; updater verification will fail across machines).
