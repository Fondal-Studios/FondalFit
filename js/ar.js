// Medición con WebXR (Chrome en Android con ARCore). Marcás las esquinas del piso en orden.

export async function arSupported() {
  try { return !!navigator.xr && await navigator.xr.isSessionSupported('immersive-ar'); }
  catch { return false; }
}

/**
 * Inicia sesión AR. Devuelve una promesa con los puntos [{x,z,y}] al terminar.
 * overlay: elemento HTML (controles) que se muestra sobre la cámara.
 * onPoint(n): callback cada vez que se agrega un punto.
 */
export async function scanFloorCorners(overlay, onPoint, onReady) {
  const canvas = document.createElement('canvas');
  const gl = canvas.getContext('webgl', { xrCompatible: true });
  const session = await navigator.xr.requestSession('immersive-ar', {
    requiredFeatures: ['hit-test'],
    optionalFeatures: ['dom-overlay'],
    domOverlay: { root: overlay },
  });
  session.updateRenderState({ baseLayer: new XRWebGLLayer(session, gl) });
  const local = await session.requestReferenceSpace('local');
  const viewer = await session.requestReferenceSpace('viewer');
  const source = await session.requestHitTestSource({ space: viewer });
  const points = [];
  let last = null;

  session.addEventListener('select', () => {
    if (!last) return;
    const p = last.transform.position;
    points.push({ x: p.x, y: p.y, z: p.z });
    onPoint(points.length);
  });

  session.requestAnimationFrame(function frame(_, f) {
    const hits = f.getHitTestResults(source);
    last = hits.length ? hits[0].getPose(local) : null;
    onReady?.(!!last);
    gl.bindFramebuffer(gl.FRAMEBUFFER, session.renderState.baseLayer.framebuffer);
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    session.requestAnimationFrame(frame);
  });

  return {
    points,
    undo: () => points.pop(),
    finish: () => session.end(),
    ended: new Promise(res => session.addEventListener('end', () => res(points.slice()))),
  };
}
