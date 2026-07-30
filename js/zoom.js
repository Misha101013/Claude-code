// Owns every pointer that lands on the photo area, and decides whether
// it's a drawing gesture or a zoom gesture.
//
// One pointer is forwarded to the caller (paint a stroke, tap to seek).
// Two pointers become a pinch-zoom/pan and the in-flight single gesture
// is cancelled, so pinching never leaves a stray brush mark behind.
//
// Zoom is applied as a CSS transform on a stage element wrapping the
// canvases. That's deliberate: callers keep mapping events to canvas
// pixels via getBoundingClientRect, which already reflects the
// transform, so no call site needs to know zoom exists.

function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

export class ZoomController {
  constructor({ wrapEl, stageEl, minZoom = 1, maxZoom = 6, onDown, onMove, onUp, onCancel }) {
    this.wrapEl = wrapEl;
    this.stageEl = stageEl;
    this.minZoom = minZoom;
    this.maxZoom = maxZoom;
    this.onDown = onDown;
    this.onMove = onMove;
    this.onUp = onUp;
    this.onCancel = onCancel;
    this.onZoomChange = null;

    this.zoom = 1;
    this.panX = 0;
    this.panY = 0;
    this.enabled = true;

    this.pointers = new Map();
    this.singleId = null;
    this.pinch = null;

    this._bind();
  }

  _bind() {
    const wrap = this.wrapEl;
    wrap.addEventListener('pointerdown', (evt) => {
      if (!this.enabled) return;
      // The floating chrome (status pill, zoom buttons, "place here")
      // lives inside the same wrapper as the photo, so a press on those
      // bubbles up here too. Only pointers that actually landed on the
      // photo stage are gestures — otherwise tapping a button would also
      // move the character or burn one of the seeker's guesses.
      if (!this.stageEl.contains(evt.target)) return;
      evt.preventDefault();
      this.pointers.set(evt.pointerId, { x: evt.clientX, y: evt.clientY });

      if (this.pointers.size === 1) {
        this.singleId = evt.pointerId;
        this.onDown && this.onDown(evt);
      } else if (this.pointers.size === 2) {
        if (this.singleId !== null) {
          this.onCancel && this.onCancel();
          this.singleId = null;
        }
        this._startPinch();
      }
    });

    window.addEventListener('pointermove', (evt) => {
      if (!this.pointers.has(evt.pointerId)) return;
      this.pointers.set(evt.pointerId, { x: evt.clientX, y: evt.clientY });
      if (this.pinch && this.pointers.size >= 2) {
        evt.preventDefault();
        this._updatePinch();
      } else if (this.singleId === evt.pointerId) {
        this.onMove && this.onMove(evt);
      }
    }, { passive: false });

    const release = (evt) => {
      if (!this.pointers.has(evt.pointerId)) return;
      this.pointers.delete(evt.pointerId);
      if (this.singleId === evt.pointerId) {
        this.singleId = null;
        this.onUp && this.onUp(evt);
      }
      if (this.pointers.size < 2) this.pinch = null;
      // Deliberately do NOT promote a leftover finger back into a
      // drawing gesture: lifting one finger out of a pinch shouldn't
      // start painting under the other one.
    };
    window.addEventListener('pointerup', release);
    window.addEventListener('pointercancel', release);

    wrap.addEventListener('wheel', (evt) => {
      if (!this.enabled) return;
      evt.preventDefault();
      const factor = evt.deltaY < 0 ? 1.12 : 1 / 1.12;
      this.zoomAround(evt.clientX, evt.clientY, factor);
    }, { passive: false });
  }

  _wrapCentre() {
    const r = this.wrapEl.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height };
  }

  _startPinch() {
    const pts = [...this.pointers.values()].slice(0, 2);
    this.pinch = {
      dist: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1,
      cx: (pts[0].x + pts[1].x) / 2,
      cy: (pts[0].y + pts[1].y) / 2,
      zoom: this.zoom,
      panX: this.panX,
      panY: this.panY,
    };
  }

  _updatePinch() {
    const pts = [...this.pointers.values()].slice(0, 2);
    const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1;
    const cx = (pts[0].x + pts[1].x) / 2;
    const cy = (pts[0].y + pts[1].y) / 2;
    const start = this.pinch;
    const centre = this._wrapCentre();

    const zoom = clamp(start.zoom * (dist / start.dist), this.minZoom, this.maxZoom);
    // Keep whatever content sat under the pinch centre pinned there:
    // screen = pan + zoom * content  =>  content = (screen0 - pan0) / zoom0
    const contentX = (start.cx - centre.x - start.panX) / start.zoom;
    const contentY = (start.cy - centre.y - start.panY) / start.zoom;
    this.zoom = zoom;
    this.panX = (cx - centre.x) - zoom * contentX;
    this.panY = (cy - centre.y) - zoom * contentY;
    this._apply();
  }

  zoomAround(clientX, clientY, factor) {
    const centre = this._wrapCentre();
    const zoom = clamp(this.zoom * factor, this.minZoom, this.maxZoom);
    const contentX = (clientX - centre.x - this.panX) / this.zoom;
    const contentY = (clientY - centre.y - this.panY) / this.zoom;
    this.zoom = zoom;
    this.panX = (clientX - centre.x) - zoom * contentX;
    this.panY = (clientY - centre.y) - zoom * contentY;
    this._apply();
  }

  zoomBy(factor) {
    const centre = this._wrapCentre();
    this.zoomAround(centre.x, centre.y, factor);
  }

  reset() {
    this.zoom = 1;
    this.panX = 0;
    this.panY = 0;
    this._apply();
  }

  _apply() {
    const centre = this._wrapCentre();
    // Don't let the photo be flung off-screen: at 1x there's nothing to
    // pan, and past that the slack grows with the zoomed overflow.
    const maxPanX = Math.max(0, ((this.zoom - 1) * centre.w) / 2);
    const maxPanY = Math.max(0, ((this.zoom - 1) * centre.h) / 2);
    this.panX = clamp(this.panX, -maxPanX, maxPanX);
    this.panY = clamp(this.panY, -maxPanY, maxPanY);
    this.stageEl.style.transform =
      `translate(${this.panX}px, ${this.panY}px) scale(${this.zoom})`;
    this.onZoomChange && this.onZoomChange(this.zoom);
  }
}
