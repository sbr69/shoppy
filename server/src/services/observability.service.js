import * as Sentry from '@sentry/node';
import config from '../config/env.js';

let initialized = false;

/**
 * Error reporting is deliberately opt-in. Never attach request bodies,
 * headers, cookies, wallet addresses, OAuth tokens, or chat content.
 */
export function initializeObservability() {
  if (initialized || !config.sentryDsn) return false;

  Sentry.init({
    dsn: config.sentryDsn,
    environment: config.nodeEnv,
    tracesSampleRate: config.sentryTracesSampleRate,
    sendDefaultPii: false,
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
  initialized = true;
  return true;
}

export function captureServerException(error, { method, path, status, userId } = {}) {
  if (!initialized) return;
  Sentry.withScope((scope) => {
    if (method) scope.setTag('http.method', String(method).slice(0, 12));
    if (path) scope.setTag('http.path', String(path).slice(0, 160));
    if (status) scope.setTag('http.status_code', String(status));
    // The internal UUID is pseudonymous and permits grouping repeated server
    // failures without exporting names, emails, keys, or wallet addresses.
    if (userId) scope.setUser({ id: String(userId) });
    Sentry.captureException(error);
  });
}
