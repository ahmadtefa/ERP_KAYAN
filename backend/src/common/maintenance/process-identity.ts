import { randomUUID } from 'node:crypto';

// A fresh identity for each process incarnation, even when the OS reuses a PID.
export const API_APPLICATION_NAME = `kayan-api-${randomUUID()}`;
