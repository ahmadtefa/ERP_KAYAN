// SPIKE test: sudden jump from a small baseline to 100 (default; set SPIKE_VUS) sessions and back, twice,
// with recovery windows between spikes so you can see how quickly latency returns to baseline.
import { sleep } from 'k6';
import { login, userSession, reportSession, healthCheck, standardThresholds } from './lib/common.js';

const BASE = Number(__ENV.BASELINE_VUS || 10);
const SPIKE = Number(__ENV.SPIKE_VUS || 100);

export const options = {
  scenarios: {
    spike: {
      executor: 'ramping-vus',
      startVUs: BASE,
      stages: [
        { duration: '1m', target: BASE },     // baseline
        { duration: '10s', target: SPIKE },   // spike up
        { duration: '2m', target: SPIKE },    // hold spike
        { duration: '10s', target: BASE },    // drop
        { duration: '2m', target: BASE },     // recovery
        { duration: '10s', target: SPIKE },   // second spike
        { duration: '1m', target: SPIKE },
        { duration: '10s', target: BASE },
        { duration: '1m', target: BASE },
        { duration: '20s', target: 0 },
      ],
      gracefulRampDown: '20s',
    },
  },
  thresholds: standardThresholds(Number(__ENV.P95_MS || 2500)),
};

export function setup() {
  healthCheck();
  return { token: login() };
}

export default function (data) {
  userSession(data.token);
  if (Math.random() < 0.15) reportSession(data.token);
  sleep(0.5 + Math.random() * 1.5);
}
