// Server and browser wall clocks are independent. Keep packet timestamps intact.
const samples = new WeakMap<object, { observedAt: number; requestMs: number }>();
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const wallAge = (value: unknown, now: number) => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? Math.max(0, now - Date.parse(value)) : Infinity;
export function observePiSnapshot<T>(packet: T, requestMs = 0, monotonicNow = performance.now()): T {
  if (packet && typeof packet === 'object') samples.set(packet, { observedAt: monotonicNow, requestMs: Math.max(0, requestMs) });
  return packet;
}
export function piFreshness(packet: any, wallNow = Date.now(), monotonicNow = performance.now()) {
  const sample = packet && typeof packet === 'object' ? samples.get(packet) : undefined;
  const localAge = sample ? Math.max(0, monotonicNow - sample.observedAt) + sample.requestMs : 0;
  const hasResponseAges = finite(packet?.transport_age_at_response_ms) && !!packet?.source_age_at_response_ms;
  // Older receivers already validate their source statuses. Trust that snapshot
  // for at most one second, including the full measured request time, then expire.
  const legacySnapshot = !!sample && !hasResponseAges;
  const transportAge = sample ? (hasResponseAges ? packet.transport_age_at_response_ms : 0) + localAge : wallAge(packet?.received_at, wallNow);
  const online = packet?.transport_status === 'connected' && transportAge < (legacySnapshot ? 1000 : 3000);
  const sourceAge = (key: string): number | null => {
    const value = hasResponseAges ? packet.source_age_at_response_ms[key] : packet?.source_age_at_receipt_ms?.[key];
    if (!finite(value)) return null;
    return value + (sample ? localAge : transportAge);
  };
  const cameraReady = online && ['ok', 'no_face'].includes(packet?.camera?.status) && (sourceAge('camera') ?? Infinity) < 2000;
  return { online, transportAge, sourceAge, cameraReady };
}
