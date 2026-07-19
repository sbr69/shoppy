let sentryEnabled = false;
let analyticsEnabled = false;
let sentryApi = null;
let posthogApi = null;
let pendingIdentity = null;
const pendingEvents = [];

function boundedRate(value, fallback) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : fallback;
}

const blockedProperty = /message|content|email|phone|address|token|secret|wallet|key/i;

/** Keep product telemetry aggregate-only: no conversation or financial data. */
export function sanitizeTelemetryProperties(properties = {}) {
  return Object.fromEntries(Object.entries(properties)
    .filter(([key, value]) => !blockedProperty.test(key)
      && ['string', 'number', 'boolean'].includes(typeof value))
    .slice(0, 16)
    .map(([key, value]) => [String(key).slice(0, 64), typeof value === 'string' ? value.slice(0, 100) : value]));
}

export async function initializeClientObservability() {
  const sentryDsn = import.meta.env.VITE_SENTRY_DSN;
  if (sentryDsn && !sentryEnabled) {
    sentryApi = await import('@sentry/react');
    sentryApi.init({
      dsn: sentryDsn,
      environment: import.meta.env.MODE,
      tracesSampleRate: boundedRate(import.meta.env.VITE_SENTRY_TRACES_SAMPLE_RATE, 0.1),
      sendDefaultPii: false,
      integrations: [sentryApi.browserTracingIntegration()],
      beforeSend(event) {
        if (event.request) {
          delete event.request.data;
          delete event.request.cookies;
          delete event.request.headers;
          delete event.request.url;
        }
        return event;
      },
    });
    sentryEnabled = true;
  }

  const posthogKey = import.meta.env.VITE_POSTHOG_KEY;
  if (posthogKey && !analyticsEnabled) {
    posthogApi = (await import('posthog-js')).default;
    posthogApi.init(posthogKey, {
      api_host: import.meta.env.VITE_POSTHOG_HOST || 'https://us.i.posthog.com',
      autocapture: false,
      capture_pageview: true,
      capture_pageleave: true,
      capture_performance: false,
      disable_session_recording: true,
      person_profiles: 'identified_only',
    });
    analyticsEnabled = true;
    if (pendingIdentity) posthogApi.identify(pendingIdentity);
    pendingEvents.splice(0).forEach(({ event, properties }) => posthogApi.capture(event, properties));
  }
}

export function identifyProductUser(userId) {
  if (!userId) return;
  pendingIdentity = String(userId);
  if (analyticsEnabled) posthogApi.identify(pendingIdentity);
}

export function resetProductUser() {
  pendingIdentity = null;
  pendingEvents.length = 0;
  if (analyticsEnabled) posthogApi.reset();
}

export function trackProductEvent(event, properties = {}) {
  const cleanEvent = String(event).slice(0, 80);
  const cleanProperties = sanitizeTelemetryProperties(properties);
  if (analyticsEnabled) posthogApi.capture(cleanEvent, cleanProperties);
  else if (import.meta.env.VITE_POSTHOG_KEY) pendingEvents.push({ event: cleanEvent, properties: cleanProperties });
}

export function captureClientException(error, context = {}) {
  if (!sentryEnabled) return;
  sentryApi.withScope((scope) => {
    Object.entries(sanitizeTelemetryProperties(context)).forEach(([key, value]) => scope.setTag(key, String(value)));
    sentryApi.captureException(error);
  });
}
