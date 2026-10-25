import {describe,it,expect} from 'vitest';
import {distanceMeters,missingGPSGap} from './RunningMap';
describe('GPS reconnection safety',()=>{
 const a={lat:-26.075,lon:-65.976,at:Date.parse('2026-10-25T21:15:00Z')};
 it('estimates only a plausible straight-line minimum',()=>{
  const b={lat:-26.077,lon:-65.973,at:a.at+180000};
  const gap=missingGPSGap(a,b);
  expect(gap.seconds).toBe(180);
  expect(gap.meters).toBeGreaterThan(200);
  expect(gap.meters).toBeLessThan(500);
  expect(gap.plausible).toBe(true);
 });
 it('rejects a teleport across a town',()=>{
  const b={lat:-26.5,lon:-65.4,at:a.at+180000};
  expect(missingGPSGap(a,b).plausible).toBe(false);
 });
 it('ignores an invalid backward timestamp',()=>{
  const b={...a,at:a.at-1000};
  expect(missingGPSGap(a,b).plausible).toBe(false);
 });
 it('zero distance for identical points',()=>expect(distanceMeters(a,a)).toBe(0));
});
