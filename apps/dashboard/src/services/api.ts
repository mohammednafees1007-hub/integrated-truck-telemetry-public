export const PRESENTATION_DEMO = import.meta.env.VITE_LOCAL_MODE === 'synthetic';
// Local port 3000 is exclusively real readings, including when a stale demo URL is bookmarked.
export const PI_LIVE = !PRESENTATION_DEMO && (window.location.port === '3000' || new URLSearchParams(window.location.search).get('mode') !== 'demo');
export const apiUrl = (value: string) => `${import.meta.env.BASE_URL.replace(/\/$/, '')}/${value.replace(/^\//, '')}`;
export const fmt = (value: unknown, places = 1) => typeof value === 'number' && Number.isFinite(value) ? value.toFixed(places) : '—';
