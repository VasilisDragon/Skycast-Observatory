# Deploy plan — `aviation-rebuild` → production

Single-source topology has landed on `aviation-rebuild` (commits `102cbab` → `7d2ccbd`). This plan covers publishing the branch to the live IIS site at `weather.vasilis.club`.

---

## 0. Pre-flight gate — RESOLVED

The working tree changes that previously sat outside HEAD have been committed:

- `c011349` — silence MapLibre image_request signal race in console
  (adds `src/lib/silence-maplibre-race.{ts,test.ts}`, side-effect import in `main.tsx`)
- `797eb05` — WeatherMap effect split + basemap zoom handoff + layer partition;
  MapExplorer liveZoom + memoized layer selections
- `7fea026` — TODO.md: note MapLibre signal race now silenced cosmetically;
  root cause still deferred

The orphan `src/WeatherSite.Api/wwwroot-snapshot.git/` directory (~1.82 GB) has been
deleted — it was leftover scratch from a prior session, not used by anything.

`git status` should be clean before continuing past section 1.

---

## 1. Pre-flight verification

Run from repo root. All must pass.

```bash
# 1a. Working tree is clean (per section 0)
git status --short

# 1b. On the right branch, nothing unexpected ahead of main
git log --oneline main..HEAD

# 1c. Frontend type-check + tests
cd src/WeatherSite.Web && npx tsc --noEmit && npx vitest run && cd ../..

# 1d. Backend build + tests
dotnet build WeatherSite.sln
dotnet test tests/WeatherSite.Api.Tests/WeatherSite.Api.Tests.csproj
# Note: WeatherSite.Api.IntegrationTests has 3 known-failing tests pre-dating
# the Skycast rename. Run for awareness but do not block on them.
dotnet test tests/WeatherSite.Api.IntegrationTests/WeatherSite.Api.IntegrationTests.csproj
```

Exit if any of 1a, 1c, 1d (Api.Tests only) fail.

---

## 2. Stop dev background processes

`dotnet publish` invokes `npm run build`, which writes to `src/WeatherSite.Api/wwwroot`. Vite or a stray dotnet on the same wwwroot will hold file locks. IIS itself does NOT need to stop yet (it serves from a different physical path — the published copy, not the source-tree wwwroot).

```bash
# Verify nothing is on the dev ports
netstat -ano | findstr "LISTENING" | findstr ":5173 :5080"

# If anything is listening, kill it (replace PID):
#   taskkill //PID <pid> //F

# IIS on :8080 stays up.
```

---

## 3. IIS app pool: AlwaysRunning + Preload

Run in elevated PowerShell. The `weathersite` app pool should be `AlwaysRunning` and the application should have `preloadEnabled` set, so the worker process starts with IIS and warms up the .NET app rather than waiting for the first HTTP request.

### 3a. Check current state

```powershell
Import-Module WebAdministration

# App pool start mode
(Get-Item "IIS:\AppPools\weathersite").startMode

# Application preload (root application of the site)
(Get-WebConfiguration -Filter "/system.applicationHost/sites/site[@name='weathersite']/application[@path='/']").preloadEnabled
```

Expected: `AlwaysRunning` and `True`. If either is wrong, run 3b.

### 3b. Configure (idempotent)

```powershell
Import-Module WebAdministration

# 1) App pool: start with IIS
Set-ItemProperty -Path "IIS:\AppPools\weathersite" -Name startMode -Value AlwaysRunning

# 2) Application: preload after pool starts
Set-WebConfigurationProperty `
    -Filter "/system.applicationHost/sites/site[@name='weathersite']/application[@path='/']" `
    -Name preloadEnabled `
    -Value True

# 3) Re-verify
(Get-Item "IIS:\AppPools\weathersite").startMode
(Get-WebConfiguration -Filter "/system.applicationHost/sites/site[@name='weathersite']/application[@path='/']").preloadEnabled
```

### 3c. Application Initialization module check

`preloadEnabled` only fires a warm-up request if the IIS **Application Initialization** role service is installed. Check once:

```powershell
Get-WindowsFeature -Name Web-AppInit
# If Install State is "Available" (not "Installed"):
Install-WindowsFeature -Name Web-AppInit
```

Without this module, `preloadEnabled=True` is silently ignored and the app still cold-starts on first request.

---

## 4. Production path and origin gate

The IIS site should serve a clean publish directory, not a repo `bin\Release\...\publish`
folder. Current production should be normalized to `C:\inetpub\weathersite` (or another
operator-owned production-only path) before the swap below.

Run in elevated PowerShell:

```powershell
Import-Module WebAdministration

# Confirm the app is not pointed at a source/build tree.
(Get-WebSite -Name weathersite).PhysicalPath

# Keep the app warm.
Set-ItemProperty -Path "IIS:\AppPools\weathersite" -Name startMode -Value AlwaysRunning
Set-WebConfigurationProperty `
    -Filter "/system.applicationHost/sites/site[@name='weathersite']/application[@path='/']" `
    -Name preloadEnabled `
    -Value True

# Origin gate: only the Cloudflare tunnel host should reach this IIS site.
# The app separately ignores CF-Connecting-IP unless this host delivered it.
& "$env:windir\system32\inetsrv\appcmd.exe" unlock config /section:system.webServer/security/ipSecurity
Set-WebConfigurationProperty `
    -PSPath "IIS:\Sites\weathersite" `
    -Filter "system.webServer/security/ipSecurity" `
    -Name allowUnlisted `
    -Value False
& "$env:windir\system32\inetsrv\appcmd.exe" set config "weathersite" `
    -section:system.webServer/security/ipSecurity `
    /+"[ipAddress='192.168.1.102',allowed='True']" `
    /commit:apphost
```

Local self-requests can still bypass this as machine-local traffic; verify from a
non-tunnel LAN host if you need to prove the deny path. If Windows Firewall is later
enabled on the Private profile, also add an inbound TCP 8080 allow rule scoped to
`192.168.1.102`.

---

## 5. Snapshot current production

Belt-and-suspenders rollback. Take the snapshot **before** the publish overwrites anything.

```bash
# Find the IIS site's physical path (one-time lookup)
powershell.exe "(Get-WebSite -Name weathersite).PhysicalPath"

# Expected: C:\inetpub\weathersite
# Set a stamp for filenames
STAMP=$(date +%Y%m%d-%H%M%S)

# Robocopy the live wwwroot to a sibling dated folder.
# /MIR makes the destination an exact mirror; /XJ skips junctions.
powershell.exe "robocopy 'C:\inetpub\weathersite' 'C:\inetpub\weathersite-snapshot-$STAMP' /MIR /XJ /NFL /NDL /NP"
```

Confirm the snapshot is non-empty before continuing:

```bash
powershell.exe "(Get-ChildItem 'C:\inetpub\weathersite-snapshot-$STAMP' -Recurse | Measure-Object).Count"
```

---

## 6. Build the publish bundle (to staging, NOT to IIS)

```bash
# Clean staging directory
rm -rf publish-staging

# Publish in Release.
# This triggers BuildFrontendForPublish: npm ci + npm run build inside src/WeatherSite.Web,
# RestoreBasemapDataIntoWwwroot: copies pmtiles into wwwroot,
# SyncFrontendAssetsIntoPublishDirectory: copies wwwroot/* into <publish>/wwwroot
dotnet publish src/WeatherSite.Api -c Release -o publish-staging
```

Verify the staging bundle has what you expect:

```bash
ls publish-staging/
ls publish-staging/wwwroot/
ls publish-staging/wwwroot/assets/ | head -20
ls publish-staging/wwwroot/tiles/basemaps/  # pmtiles
ls publish-staging/App_Data/                # zcta-centroids.json, airports.json
```

If `wwwroot/index.html` is missing or `wwwroot/assets/` has no JS bundle, the frontend build silently failed — investigate before continuing.

---

## 7. Swap

```bash
# 7a. Stop the app pool (graceful drain)
powershell.exe "Stop-WebAppPool -Name weathersite"

# Wait until it's actually Stopped
powershell.exe "while ((Get-WebAppPoolState -Name weathersite).Value -ne 'Stopped') { Start-Sleep -Milliseconds 500 }"

# 7b. Mirror the staging bundle into the IIS path.
# /MIR removes any file in the destination that isn't in source — that's intentional, gives a clean state.
powershell.exe "robocopy 'publish-staging' 'C:\inetpub\weathersite' /MIR /XJ /NFL /NDL /NP"

# The app pool needs write access for DPAPI-protected data-protection keys.
powershell.exe "icacls 'C:\inetpub\weathersite\App_Data' /grant 'IIS AppPool\WeatherSite:(OI)(CI)(M)'"

# 7c. Stamp Production into ANCM web.config, point IIS at the clean path, then start.
powershell.exe "$path='C:\inetpub\weathersite\web.config'; [xml]$xml=Get-Content $path; $asp=$xml.configuration.location.'system.webServer'.aspNetCore; if ($null -eq $asp.environmentVariables) { $asp.AppendChild($xml.CreateElement('environmentVariables')) | Out-Null }; $envs=$asp.environmentVariables; $existing=$envs.environmentVariable | Where-Object { $_.name -eq 'ASPNETCORE_ENVIRONMENT' }; if ($null -eq $existing) { $existing=$xml.CreateElement('environmentVariable'); $existing.SetAttribute('name','ASPNETCORE_ENVIRONMENT'); $envs.AppendChild($existing) | Out-Null }; $existing.SetAttribute('value','Production'); $xml.Save($path)"
powershell.exe "Set-ItemProperty 'IIS:\Sites\weathersite' -Name physicalPath -Value 'C:\inetpub\weathersite'"
powershell.exe "Start-WebAppPool -Name weathersite"

# Preload (3a) should warm it up automatically; give it a few seconds
sleep 5
```

---

## 8. Smoke test

Hit the live URL through Cloudflare. Each of these should return 200 + non-trivial content.

```bash
# Root SPA shell
curl -sS -o /dev/null -w "%{http_code} %{size_download}b\n" https://weather.vasilis.club/

# An aviation surface (the new prod-canonical path)
curl -sS -o /dev/null -w "%{http_code} %{size_download}b\n" https://weather.vasilis.club/aviation/KJFK

# Weather API
curl -sS -o /dev/null -w "%{http_code} %{size_download}b\n" "https://weather.vasilis.club/api/weather/bundle?zip=60601"

# Aviation API
curl -sS -o /dev/null -w "%{http_code} %{size_download}b\n" https://weather.vasilis.club/api/aviation/airports/KJFK/metar

# Map config
curl -sS -o /dev/null -w "%{http_code} %{size_download}b\n" "https://weather.vasilis.club/api/maps/config?zip=60601"

# A pmtile
curl -sS -o /dev/null -w "%{http_code} %{size_download}b\n" -I https://weather.vasilis.club/tiles/basemaps/world.pmtiles
```

Security/header checks:

```bash
# No production timing disclosure.
curl -sS -D - -o /dev/null https://weather.vasilis.club/api/weather/bundle?zip=60601 | grep -i "server-timing" && exit 1

# CSP should stay same-origin for app/API connections.
curl -sS -D - -o /dev/null https://weather.vasilis.club/ | grep -i "content-security-policy"

# Stray and server-side artifacts should not be public.
curl -sS -o /dev/null -w "%{http_code}\n" https://weather.vasilis.club/test-write.txt
curl -sS -o /dev/null -w "%{http_code}\n" https://weather.vasilis.club/WeatherSite.Api.pdb
curl -sS -o /dev/null -w "%{http_code}\n" https://weather.vasilis.club/App_Data/DataProtectionKeys/probe.xml

# Input validation should stop at the app, not fan out upstream.
curl -sS -o /dev/null -w "%{http_code}\n" "https://weather.vasilis.club/api/maps/tiles/opengeo/local-radar-klot/19/0/0.png"
curl -sS -o /dev/null -w "%{http_code}\n" "https://weather.vasilis.club/api/aviation/pireps?lat=91&lon=0"
```

Then eyeball the live site in a browser. Walk:
- `/` — ZIP entry, save, dashboard renders, current conditions populated.
- `/?aviation=KJFK#explorer` — aviation overlay opens on the existing map.
- `/aviation/KJFK` — full aviation surface with METAR/TAF/PIREPs.
- Toggle between the two via the cross-surface link.

---

## 9. Rollback (only if smoke test fails)

```bash
# Same shape as section 6, source = the snapshot taken in section 4
powershell.exe "Stop-WebAppPool -Name weathersite"
powershell.exe "while ((Get-WebAppPoolState -Name weathersite).Value -ne 'Stopped') { Start-Sleep -Milliseconds 500 }"
powershell.exe "robocopy 'C:\inetpub\weathersite-snapshot-<STAMP>' 'C:\inetpub\weathersite' /MIR /XJ /NFL /NDL /NP"
powershell.exe "Start-WebAppPool -Name weathersite"
```

Then debug from the staging bundle, not from live.

---

## 10. Post-deploy

- **Tail logs** for ~10 minutes to catch first-request errors that smoke missed:
  ```bash
  powershell.exe "Get-Content 'C:\inetpub\weathersite\logs\stdout_*.log' -Tail 100 -Wait"
  ```
  (Adjust path to wherever ASP.NET Core logging is configured to write.)

- **Delete `publish-staging/`** once confident — it's regenerable.
- **Keep at least one snapshot folder** (`weathersite-snapshot-<STAMP>`) for rollback safety; rotate older ones manually.
- **Merge `aviation-rebuild` → `main`** at your discretion — deploy succeeded from this branch, but `main` should reflect prod.

---

## Appendix: command-summary cheatsheet

If everything is green and you trust the plan, the deploy reduces to:

```bash
# Pre-flight (assumes section 0 + 3 already done previously)
git status --short && \
cd src/WeatherSite.Web && npx tsc --noEmit && npx vitest run && cd ../.. && \
dotnet build WeatherSite.sln

# Publish + swap
STAMP=$(date +%Y%m%d-%H%M%S)
rm -rf publish-staging
dotnet publish src/WeatherSite.Api -c Release -o publish-staging
powershell.exe "robocopy 'C:\inetpub\weathersite' 'C:\inetpub\weathersite-snapshot-$STAMP' /MIR /XJ /NFL /NDL /NP"
powershell.exe "Stop-WebAppPool -Name weathersite; while ((Get-WebAppPoolState -Name weathersite).Value -ne 'Stopped') { Start-Sleep -Milliseconds 500 }"
powershell.exe "robocopy 'publish-staging' 'C:\inetpub\weathersite' /MIR /XJ /NFL /NDL /NP"
powershell.exe "Start-WebAppPool -Name weathersite"

# Smoke
curl -sS -o /dev/null -w "%{http_code}\n" https://weather.vasilis.club/
curl -sS -o /dev/null -w "%{http_code}\n" https://weather.vasilis.club/aviation/KJFK
```
