import assert from 'node:assert/strict';
import { polygonArea, perimeter, rectPolygon, snapOrthogonal } from '../js/geometry.js';
import { analyzeRoom, estimateCost } from '../js/advisor.js';

assert.equal(polygonArea(rectPolygon(4, 3)), 12);
assert.equal(perimeter(rectPolygon(4, 3)), 14);
// L-shape: 4x4 menos 2x2 = 12
assert.equal(polygonArea([{x:0,z:0},{x:4,z:0},{x:4,z:2},{x:2,z:2},{x:2,z:4},{x:0,z:4}]), 12);
// Un rectángulo medido con ruido y rotado debe recuperar ~área ortogonal
const a = 0.5, rot = p => ({ x: p.x*Math.cos(a)-p.z*Math.sin(a), z: p.x*Math.sin(a)+p.z*Math.cos(a) });
const noisy = [{x:0,z:0},{x:4,z:0.1},{x:3.95,z:3},{x:0.05,z:3.05}].map(rot);
const area = polygonArea(snapOrthogonal(noisy));
assert.ok(Math.abs(area - 12) < 0.3, 'área ajustada ' + area);
assert.ok(analyzeRoom({ type:'dormitorio', area:6, minSide:2, height:2.6, hasWindow:true }).length >= 1);
assert.equal(estimateCost({ pintura_m2: 10 }, { pintura_m2: 100 }).total, 1000);
console.log('OK');
