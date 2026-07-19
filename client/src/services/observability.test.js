import { describe, expect, it } from 'vitest';
import { sanitizeTelemetryProperties } from './observability';

describe('privacy-safe product telemetry', () => {
  it('keeps only bounded aggregate fields and strips sensitive data', () => {
    expect(sanitizeTelemetryProperties({
      feature: 'checkout',
      response_type: 'purchase_success',
      status: 200,
      completed: true,
      message: 'never export this chat text',
      wallet_address: 'CXXXXXXXXXXXXXXXX',
      access_token: 'secret',
      deliveryAddress: 'never export this either',
      nested: { ignored: true },
    })).toEqual({
      feature: 'checkout',
      response_type: 'purchase_success',
      status: 200,
      completed: true,
    });
  });
});
