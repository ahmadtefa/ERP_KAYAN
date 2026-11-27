// LOAD test: 100 concurrent virtual users (sessions), ramp 1m, hold 5m, ramp down 30s.
// Token is obtained once in setup() (login is limited to 10/min per IP).
import { sleep } from 'k6';
import { login, userSession, reportSession, syntheticCustomer, healthCheck, standardThresholds, WRITES } from './lib/common.js';

export const options = {
  scenarios: {
    sessions: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: __ENV.RAMP || '1m', target: Number(__ENV.VUS || 100) },
        { duration: __ENV.HOLD || '5m', target: Number(__ENV.VUS || 100) },
        { duration: '30s', target: 0 },
      ],
      gracefulRampDown: '30s',
    },
  },
  thresholds: standardThresholds(Number(__ENV.P95_MS || 1500)),
};

export function setup() {
  healthCheck();
  return { token: login() };
}

export default function (data) {
  userSession(data.token);
  // ~1 in 5 iterations also reads a heavier report
  if (Math.random() < 0.2) reportSession(data.token);
  if (WRITES && Math.random() < 0.1) syntheticCustomer(data.token, __VU, __ITER);
  sleep(1 + Math.random() * 2); // think time
}
