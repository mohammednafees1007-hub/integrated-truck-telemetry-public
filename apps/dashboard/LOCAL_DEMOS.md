# Two local project demonstrations

## Real hardware dashboard

http://localhost:3000/truck-tracking/

Uses the existing password-protected Node receiver, Pi bridge, actual sensor readings and phone GPS. Local port 3000 always selects real mode even if an old `?mode=demo` bookmark is used. Missing/stale sources remain unavailable. No synthetic fixture is uploaded to the receiver. The current private phone QR is in `.private/PHONE_PAIRING.html`; do not share it publicly. A new temporary tunnel can require phone re-pairing.

## Synthetic explanatory dashboard

http://localhost:3001/truck-tracking/

Independent loopback-only static server, no password, machine keys, Pi connection or receiving APIs. The frontend is built with `VITE_LOCAL_MODE=synthetic` and stays synthetic regardless of query parameters. It preserves the original navigation/design and uses a fictional sample fleet, browser-only fixtures, a custom SVG driver illustration and animated sample orientation.

Every tab has an explanation, data-flow description, suggested interaction and implementation boundary. The guide has Previous/Next navigation and Normal drive, Drowsy driver, Critical alert, No face and Link lost scenarios. Critical/link-loss choices create labelled example notifications. The driver image is an illustration, not a photograph or inference result. PERCLOS is unavailable; example fuel/speed are fictional. No camera permission or ONNX model execution is required.

Scenario buttons control the monitoring example, orientation source availability and first sample vehicle's state. The other sample fleet records and historical fuel charts remain illustrative; this is not a complete physical vehicle simulator. Map tiles still need internet access; tutorial explanations, sample values and illustrations are local. Synthetic-session record edits are browser memory/demo storage and do not modify live records; reloading resets the in-memory tour.

## Recorded and repeatable presentation

The **Recorded demo player** on port 3001 contains a prepared **2 minute 10 second** presentation covering all nine tabs, including normal driving, drowsiness, critical fatigue, no face, lost link and recovery. Use **Play demo**, **Pause**, **Replay from start**, the timeline slider and **Loop replay**. During playback the long manual guide collapses so the actual dashboard remains in view. Manual navigation/scenario selection exits automatic playback.

Expand **Record save or import a session** to create a custom interactive recording:

1. Choose **Record my demo**.
2. Navigate dashboard tabs and select synthetic scenarios in the order you want to present them.
3. Choose **Save recording**. The sequence is saved in this browser under a synthetic-only storage key.
4. Choose **Load my recording**, then Play or Replay. It survives a page reload. Download the JSON session as a portable backup, or import a previously downloaded session.

The recording stores only a validated tab/scenario timeline, captions and duration, up to 30 minutes/2000 events. It does not record real sensors, camera images, GPS, form edits or arbitrary mouse clicks. Motion follows the same elapsed-time synthetic clock on every replay and freezes while paused. The first sample vehicle and replay alert examples are reconstructed from the selected timeline position. Other historical sample fleet/fuel data remains illustrative.

Expand **Watch the saved walkthrough video** to play the independently saved silent screen recording with on-screen explanations. It has video controls and loops; it can also be downloaded from `http://localhost:3001/truck-tracking/recordings/project-walkthrough.webm`. The file is stored at `output/demo-recordings/project-walkthrough.webm`, outside both build folders, and is served only by the synthetic server. Rebuilding the frontend does not remove it. The video is a synthetic presentation, not a recording of physical vehicle tests.

Optional re-recording tool: `scripts/record-synthetic-tour.cjs` uses Playwright's video recorder, a supported Edge binary and Playwright's FFmpeg encoder. It visits only the synthetic localhost, records the prepared full sequence and saves a WebM. Set `PLAYWRIGHT_MODULE` if Playwright is supplied by the workspace runtime rather than project dependencies. This tool does not access the real dashboard or change the Pi.

## Recorded real face demonstration

The second take of the user's explicitly cued Pi-camera demonstration is saved separately as `output/demo-recordings/fatigue-camera-demo.webm`. It joins six short captured segments: normal face, blinking, brief eye closure, yawn, left/right head turns and return to normal. The resulting clip is 50 seconds at 5 FPS, with a detected face in 249 of 250 captured frames. This describes face visibility, not classification accuracy.

Open `http://localhost:3001/truck-tracking/?recording=fatigue`, then **Play face recording**. Native video controls, **Replay face recording** and looping are available. The clip is prominently labelled **RECORDED PI CAMERA — NOT LIVE**. The rest of the port 3001 dashboard remains synthetic. The recorded model score/state was sampled near each captured JPEG; they are separate requests, not guaranteed frame-synchronous model annotations. Action labels are cues, not proof that the intended action was recognized. This clip does not feed the live receiver or substitute for new Pi inference.

Footage, per-frame capture manifest and the earlier take stay locally under the ignored output/private folders. Do not upload the face footage or private capture directory to GitHub, cPanel or an external service without a separate request. `scripts/record-fatigue-camera.py` supports short explicitly cued captures; its `--take` argument keeps repeated takes separate. No camera recording runs after the capture commands finish; the normal project camera service remains running.

The synthetic start/stop helpers compare process creation times numerically and refuse untracked port conflicts. This also avoids a PowerShell JSON date-conversion mismatch that could leave an older listener running after a restart.

## Start and stop

Desktop `Truck-Tracking.bat` guides setup and opens both versions. It starts the synthetic server first, then attempts the real local services. If the Pi is unreachable, the tutorial remains usable and the live dashboard honestly shows disconnected data. The active setup is local-only.

`Truck-Tracking.bat stop` stops the synthetic server and invokes the existing real-system stop workflow (project Pi services, laptop server/tunnel). It does not power off the Pi or laptop. GPS sharing is stopped manually on the phone. No cPanel files or hosted production configuration are modified by these local servers.

Individual helpers: `scripts/start-synthetic.ps1`, `scripts/stop-synthetic.ps1`, `scripts/guided-start.ps1` and `scripts/stop-system.ps1`. Helpers track process ID and start time to avoid stopping a reused unrelated process.

## Build from source

From this dashboard directory after restoring dependencies, use PowerShell:

```powershell
$env:APP_BASE_PATH='/truck-tracking'
$env:VITE_LOCAL_MODE='synthetic'
node node_modules/vite/bin/vite.js build --outDir output/synthetic-dist
Remove-Item Env:VITE_LOCAL_MODE
node .tools/package/bin/npm-cli.js run build
```

The final standard build includes `dist/server.cjs`; running Vite alone clears it, so finish with the complete build command. Keep synthetic and real builds in separate output directories. Synthetic server routes reject `/api/` and `/pi-gps/` requests instead of forwarding them anywhere.
