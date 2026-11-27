// STRESS test: step the concurrency upward past the expected load to find the breaking point.
// Default steps 50 -> 100 -> 200 -> 300 -> 400, 2 minutes each, then recover. No think time pile-up:
// short sleep so the server is pushed. Thresholds are soft (abortOnFail off) so the whole curve is recorded.
import { sleep } from 'k6';
import { login, userSession, reportSession, healthCheck } from './lib/common.js';

const steps = (__ENV.STEPS || '50,100,200,300,400').split(',').map(Number);
const stepDur = __ENV.STEP_DURATION || '2m';

export const options = {
  scenarios: {
    stress: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        ...steps.flatMap((t) => [{ duration: '30s', target: t }, { duration: stepDur, target: t }]),
        { duration: '1m', target: 0 },
      ],
      gracefulRampDown: '30s',
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.10'],
    http_req_duration: ['p(95)<3000'],
    kayan_http_5xx: ['count<50'],
  },
};

export function setup() {
  healthCheck();
  return { token: login() };
}

export default function (data) {
  userSession(data.token);
  if (Math.random() < 0.3) reportSession(data.token);
  sleep(0.2 + Math.random() * 0.5);
}

export function teardown() {
  // Recovery probe: after the ramp-down the API should answer /health promptly.
  const r = healthCheck();
  console.log(`post-stress /health status=${r.status} duration=${r.timings.duration}ms`);
}
