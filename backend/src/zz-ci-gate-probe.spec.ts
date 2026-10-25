// TEMPORARY. This file exists only to prove that the unit-test gate fails the
// job when a test fails. It is removed again in the next commit.
describe('CI gate probe', () => {
  it('fails on purpose', () => {
    expect('the gate is watched').toBe('the gate must fail the job');
  });
});
