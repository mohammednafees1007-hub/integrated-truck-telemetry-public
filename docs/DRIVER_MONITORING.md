# Driver-monitoring pipeline

The Pi camera adapter invokes existing ONNX inference: `version-slim-320.onnx` detects a face, `PFLD_GhostOne_112_1_opt_sim.onnx` estimates 98 landmarks, and `mouth_model.onnx` assists ambiguous mouth-ratio decisions. The upstream `eye_model.onnx` is loaded but is not called by the active eye-decision path. Obtain weights from upstream after reviewing their provenance and terms; none are distributed here.

Landmark geometry provides eye aspect ratio (EAR), mouth aspect ratio (MAR) and approximate head pose. Frame-based counters and smoothing convert these cues into a rule-based severity, not a calibrated probability. There is no measured PERCLOS or validated general fatigue accuracy. No detected face must be reported unavailable rather than safe. The exact upstream formulas and thresholds are in `third_party/fatigue-engine/` and the adapter in `devices/pi/prototype/camera_service/`.

The Pi publishes inference JSON and JPEG independently. A fresh preview is not evidence of valid inference. This is a learning prototype, not a driver-safety device.
