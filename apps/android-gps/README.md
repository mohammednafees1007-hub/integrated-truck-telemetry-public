# Android phone GPS sender

Native Java Android source: `MainActivity.java` handles pairing and permissions, `Settings.java` stores the HTTPS endpoint and scoped key, and `GpsService.java` delivers measured fixes through a foreground service with notification Stop.

Minimum Android API 26; target SDK 35. APK binaries and signing materials are omitted from this public source export. The ARM64 Pi builder `build_apk.py` expects locally installed Android/OpenJDK tools under `tools/`. Restore the declared tools from their official distributors before building. Never commit generated `signing/`, passwords, pairing links or location stores.

Grant precise location and notifications, pair with your own receiver, and press Start outdoors. Pairing alone does not start sharing. Upload receipt and matching Pi acknowledgement are separate states. Source timestamps and accuracy are measurements, not invented fixes.
