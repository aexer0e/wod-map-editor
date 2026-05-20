// Paint editor: in-app 960x540 background image creator
// Usage: Paint.open(initialBase64OrNull).then(base64 => ...)
const Paint = (() => {
  const PLAINS_COLOR = '#A1C246';
  const TERRAIN_COLORS = [
    { name: 'Plains', hex: '#A1C246' },
    { name: 'Forest', hex: '#388336' },
    { name: 'River', hex: '#279BFF' },
    { name: 'Mud', hex: '#784B23' },
    { name: 'Sand', hex: '#EEE3B0' },
    { name: 'Hill', hex: '#888A87' },
    { name: 'Mountain', hex: '#6D6B6F' },
  ];

  function open(initialBase64) {
    return new Promise(resolve => {
      const overlay = document.createElement('div');
      overlay.className = 'paint-overlay';
      overlay.innerHTML = `
        <div class="paint-shell">
          <header class="paint-top">
            <div>
              <h2>Draw background</h2>
              <p class="muted">960 \u00d7 540 \u2022 click & drag to paint</p>
            </div>
            <div class="paint-top-actions">
              <button class="btn ghost" data-act="cancel">Cancel</button>
              <button class="btn primary" data-act="save">Use this image</button>
            </div>
          </header>
          <div class="paint-body">
            <aside class="paint-tools">
              <div class="paint-section">
                <h4>Tool</h4>
                <div class="paint-tool-grid">
                  <button class="paint-tool active" data-tool="brush">\u270f\ufe0f Brush</button>
                  <button class="paint-tool" data-tool="eraser">\u232b Eraser</button>
                  <button class="paint-tool" data-tool="line">\u2571 Line</button>
                  <button class="paint-tool" data-tool="rect">\u25a2 Rect</button>
                  <button class="paint-tool" data-tool="fill">\u25c6 Fill</button>
                  <button class="paint-tool" data-tool="picker">\ud83d\udd0d Pick</button>
                </div>
              </div>

              <div class="paint-section">
                <h4>Size <span id="sizeVal">8</span>px</h4>
                <input id="sizeRange" type="range" min="1" max="80" value="8" />
              </div>

              <div class="paint-section">
                <h4>Color</h4>
                <div class="swatches" id="swatches"></div>
                <p class="hint">Official WoD terrain colors only</p>
              </div>

              <div class="paint-section">
                <h4>Canvas</h4>
                <div class="canvas-actions">
                  <button class="btn ghost block" data-act="fillAll">Fill all with color</button>
                  <button class="btn ghost block" data-act="clear">Reset to plains</button>
                  <label class="btn ghost block">
                    <input id="paintImport" type="file" accept="image/*" hidden />
                    Start from image\u2026
                  </label>
                </div>
              </div>

              <div class="paint-section">
                <h4>History</h4>
                <div class="hist-row">
                  <button class="btn ghost" data-act="undo">\u21b6 Undo</button>
                  <button class="btn ghost" data-act="redo">\u21b7 Redo</button>
                </div>
              </div>
            </aside>

            <div class="paint-canvas-wrap">
              <div class="paint-frame">
                <canvas id="paintCanvas" width="960" height="540"></canvas>
                <canvas id="paintPreview" width="960" height="540"></canvas>
              </div>
            </div>
          </div>
        </div>`;
      document.body.appendChild(overlay);

      const canvas  = overlay.querySelector('#paintCanvas');
      const preview = overlay.querySelector('#paintPreview');
      const ctx = canvas.getContext('2d');

      // initial fill
      ctx.fillStyle = PLAINS_COLOR;
      ctx.fillRect(0, 0, 960, 540);
      if (initialBase64) {
        const img = new Image();
        img.onload = () => {
          ctx.drawImage(img, 0, 0, 960, 540);
          quantizeCanvas();
          pushHistory();
        };
        img.src = 'data:image/png;base64,' + initialBase64;
      }

      // ---- State ----
      const state = {
        tool: 'brush',
        color: PLAINS_COLOR,
        size: 8,
        drawing: false,
        last: null,
        startPt: null, // for line/rect
        snapshot: null, // imagedata before shape drag
        history: [],
        future: [],
      };

      function pushHistory() {
        try {
          state.history.push(canvas.toDataURL('image/png'));
          if (state.history.length > 30) state.history.shift();
          state.future.length = 0;
        } catch (e) { /* ignore */ }
      }
      function restore(dataUrl) {
        const img = new Image();
        img.onload = () => { ctx.clearRect(0,0,960,540); ctx.drawImage(img,0,0); };
        img.src = dataUrl;
      }
      pushHistory();

      // ---- Swatches ----
      const sw = overlay.querySelector('#swatches');
      TERRAIN_COLORS.forEach(({ name, hex }) => {
        const b = document.createElement('button');
        b.className = 'swatch';
        b.style.background = hex;
        b.title = `${name} ${hex}`;
        b.dataset.hex = hex;
        b.onclick = () => setColor(hex);
        sw.appendChild(b);
      });
      function setColor(c) {
        state.color = nearestTerrainHex(c);
        overlay.querySelectorAll('.swatch').forEach(button => {
          button.classList.toggle('active', button.dataset.hex === state.color);
        });
      }
      setColor(PLAINS_COLOR);

      // ---- Size ----
      const sizeRange = overlay.querySelector('#sizeRange');
      const sizeVal = overlay.querySelector('#sizeVal');
      sizeRange.addEventListener('input', () => {
        state.size = +sizeRange.value;
        sizeVal.textContent = state.size;
      });

      // ---- Tools ----
      overlay.querySelectorAll('.paint-tool').forEach(b => {
        b.onclick = () => {
          state.tool = b.dataset.tool;
          overlay.querySelectorAll('.paint-tool').forEach(x => x.classList.toggle('active', x === b));
        };
      });

      // ---- Top actions ----
      overlay.querySelector('[data-act=cancel]').onclick = () => close(null);
      overlay.querySelector('[data-act=save]').onclick = () => {
        quantizeCanvas();
        const dataUrl = canvas.toDataURL('image/png');
        close(dataUrl.split(',')[1]);
      };
      overlay.querySelector('[data-act=fillAll]').onclick = () => {
        ctx.fillStyle = state.color;
        ctx.fillRect(0, 0, 960, 540);
        pushHistory();
      };
      overlay.querySelector('[data-act=clear]').onclick = () => {
        ctx.fillStyle = PLAINS_COLOR;
        ctx.fillRect(0, 0, 960, 540);
        setColor(PLAINS_COLOR);
        pushHistory();
      };
      overlay.querySelector('[data-act=undo]').onclick = () => {
        if (state.history.length < 2) return;
        state.future.push(state.history.pop());
        restore(state.history[state.history.length - 1]);
      };
      overlay.querySelector('[data-act=redo]').onclick = () => {
        if (!state.future.length) return;
        const url = state.future.pop();
        state.history.push(url);
        restore(url);
      };
      overlay.querySelector('#paintImport').onchange = async (e) => {
        const f = e.target.files[0];
        if (!f) return;
        const url = URL.createObjectURL(f);
        const img = new Image();
        img.onload = () => {
          ctx.fillStyle = PLAINS_COLOR;
          ctx.fillRect(0, 0, 960, 540);
          ctx.drawImage(img, 0, 0, 960, 540);
          quantizeCanvas();
          URL.revokeObjectURL(url);
          pushHistory();
        };
        img.src = url;
        e.target.value = '';
      };

      // ---- Pointer handling ----
      function pt(e) {
        const r = canvas.getBoundingClientRect();
        return {
          x: Math.round((e.clientX - r.left) * (canvas.width  / r.width)),
          y: Math.round((e.clientY - r.top ) * (canvas.height / r.height)),
        };
      }

      preview.addEventListener('pointerdown', e => {
        preview.setPointerCapture(e.pointerId);
        const p = pt(e);
        state.drawing = true;
        state.last = p;
        state.startPt = p;

        if (state.tool === 'brush' || state.tool === 'eraser') {
          drawDot(p, state.tool === 'eraser');
        } else if (state.tool === 'fill') {
          floodFill(p.x, p.y, state.color);
          pushHistory();
          state.drawing = false;
        } else if (state.tool === 'picker') {
          const d = ctx.getImageData(p.x, p.y, 1, 1).data;
          setColor(rgbToHex(d[0], d[1], d[2]));
          state.drawing = false;
        } else {
          // line/rect: snapshot for live preview
          state.snapshot = ctx.getImageData(0, 0, 960, 540);
        }
      });

      preview.addEventListener('pointermove', e => {
        if (!state.drawing) return;
        const p = pt(e);
        if (state.tool === 'brush' || state.tool === 'eraser') {
          drawSegment(state.last, p, state.tool === 'eraser');
          state.last = p;
        } else if (state.tool === 'line') {
          ctx.putImageData(state.snapshot, 0, 0);
          ctx.strokeStyle = state.color;
          ctx.lineWidth = state.size;
          ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.moveTo(state.startPt.x, state.startPt.y);
          ctx.lineTo(p.x, p.y);
          ctx.stroke();
        } else if (state.tool === 'rect') {
          ctx.putImageData(state.snapshot, 0, 0);
          ctx.fillStyle = state.color;
          const x = Math.min(state.startPt.x, p.x);
          const y = Math.min(state.startPt.y, p.y);
          const w = Math.abs(p.x - state.startPt.x);
          const h = Math.abs(p.y - state.startPt.y);
          ctx.fillRect(x, y, w, h);
        }
      });

      function endStroke() {
        if (!state.drawing) return;
        state.drawing = false;
        state.snapshot = null;
        pushHistory();
      }
      preview.addEventListener('pointerup', endStroke);
      preview.addEventListener('pointercancel', endStroke);
      preview.addEventListener('pointerleave', () => { /* keep drawing only on move */ });

      function drawDot(p, erase) {
        ctx.fillStyle = erase ? PLAINS_COLOR : state.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, state.size / 2, 0, Math.PI * 2);
        ctx.fill();
      }
      function drawSegment(a, b, erase) {
        ctx.strokeStyle = erase ? PLAINS_COLOR : state.color;
        ctx.lineWidth = state.size;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }

      function floodFill(sx, sy, hex) {
        const img = ctx.getImageData(0, 0, 960, 540);
        const data = img.data;
        const w = 960, h = 540;
        const idx0 = (sy * w + sx) * 4;
        const target = [data[idx0], data[idx0+1], data[idx0+2], data[idx0+3]];
        const fill = hexToRgb(nearestTerrainHex(hex));
        if (target[0] === fill[0] && target[1] === fill[1] && target[2] === fill[2] && target[3] === 255) return;
        const stack = [[sx, sy]];
        const tol = 1; // strict matching
        while (stack.length) {
          const [x, y] = stack.pop();
          if (x < 0 || y < 0 || x >= w || y >= h) continue;
          const i = (y * w + x) * 4;
          if (
            Math.abs(data[i]   - target[0]) > tol ||
            Math.abs(data[i+1] - target[1]) > tol ||
            Math.abs(data[i+2] - target[2]) > tol ||
            Math.abs(data[i+3] - target[3]) > tol
          ) continue;
          data[i] = fill[0]; data[i+1] = fill[1]; data[i+2] = fill[2]; data[i+3] = 255;
          stack.push([x+1, y], [x-1, y], [x, y+1], [x, y-1]);
        }
        ctx.putImageData(img, 0, 0);
      }

      function quantizeCanvas() {
        const img = ctx.getImageData(0, 0, 960, 540);
        const data = img.data;
        for (let index = 0; index < data.length; index += 4) {
          const snapped = hexToRgb(nearestTerrainHex(rgbToHex(data[index], data[index + 1], data[index + 2])));
          data[index] = snapped[0];
          data[index + 1] = snapped[1];
          data[index + 2] = snapped[2];
          data[index + 3] = 255;
        }
        ctx.putImageData(img, 0, 0);
      }

      function close(result) {
        overlay.remove();
        resolve(result);
      }
      // Esc cancels
      function onKey(e) {
        if (e.key === 'Escape') { close(null); document.removeEventListener('keydown', onKey); }
      }
      document.addEventListener('keydown', onKey);
    });
  }

  function hexToRgb(h) {
    h = toHex(h).replace('#', '');
    return [parseInt(h.slice(0,2),16), parseInt(h.slice(2,4),16), parseInt(h.slice(4,6),16)];
  }
  function rgbToHex(r, g, b) {
    return '#' + [r,g,b].map(v => v.toString(16).padStart(2, '0')).join('');
  }
  function toHex(c) {
    if (c.startsWith('#')) return c.length === 4
      ? '#' + [...c.slice(1)].map(x => x + x).join('')
      : c;
    return c;
  }

  function nearestTerrainHex(hex) {
    const [red, green, blue] = hexToRgb(hex);
    let best = TERRAIN_COLORS[0].hex;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const terrain of TERRAIN_COLORS) {
      const [terrainRed, terrainGreen, terrainBlue] = hexToRgb(terrain.hex);
      const distance = ((red - terrainRed) ** 2) + ((green - terrainGreen) ** 2) + ((blue - terrainBlue) ** 2);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = terrain.hex;
      }
    }
    return best;
  }

  return { open };
})();
