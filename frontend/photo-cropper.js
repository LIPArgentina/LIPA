(function(){
  const OUTPUT_SIZE = 512;

  function createElement(tag, className, text){
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text) el.textContent = text;
    return el;
  }

  function clamp(value, min, max){
    return Math.max(min, Math.min(max, value));
  }

  function readFileAsDataUrl(file){
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(reader.error || new Error('No se pudo leer la imagen'));
      reader.readAsDataURL(file);
    });
  }

  function loadImage(src){
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('No se pudo abrir la imagen'));
      img.src = src;
    });
  }

  function canvasToBlob(canvas){
    return new Promise((resolve) => {
      canvas.toBlob((blob) => resolve(blob), 'image/jpeg', 0.92);
    });
  }

  function buildDialog(){
    const dialog = createElement('dialog', 'photo-cropper-modal');
    const panel = createElement('div', 'photo-cropper-panel');
    const header = createElement('div', 'photo-cropper-header');
    const title = createElement('h3', 'photo-cropper-title', 'Ajustar foto');
    const closeBtn = createElement('button', 'photo-cropper-button', 'Cerrar');
    closeBtn.type = 'button';

    const body = createElement('div', 'photo-cropper-body');
    const stage = createElement('div', 'photo-cropper-stage');
    const img = createElement('img', 'photo-cropper-image');
    img.alt = 'Foto seleccionada';
    const mask = createElement('div', 'photo-cropper-mask');
    const frame = createElement('div', 'photo-cropper-frame');
    const grid = createElement('div', 'photo-cropper-grid');
    frame.appendChild(grid);
    stage.append(img, mask, frame);
    body.appendChild(stage);

    const footer = createElement('div', 'photo-cropper-footer');
    const controls = createElement('div', 'photo-cropper-controls');
    const zoomLabel = createElement('label', '', 'Zoom');
    const zoom = document.createElement('input');
    zoom.type = 'range';
    zoom.min = '1';
    zoom.max = '4';
    zoom.step = '0.01';
    zoom.value = '1';
    const resetBtn = createElement('button', 'photo-cropper-button', 'Centrar');
    resetBtn.type = 'button';
    controls.append(zoomLabel, zoom, resetBtn);

    const actions = createElement('div', 'photo-cropper-actions');
    const cancelBtn = createElement('button', 'photo-cropper-button', 'Cancelar');
    cancelBtn.type = 'button';
    const applyBtn = createElement('button', 'photo-cropper-button primary', 'Usar foto');
    applyBtn.type = 'button';
    actions.append(cancelBtn, applyBtn);

    header.append(title, closeBtn);
    footer.append(controls, actions);
    panel.append(header, body, footer);
    dialog.appendChild(panel);
    document.body.appendChild(dialog);
    return { dialog, stage, img, frame, zoom, resetBtn, closeBtn, cancelBtn, applyBtn };
  }

  async function pick(file, options = {}){
    if (!file) return null;
    const src = await readFileAsDataUrl(file);
    const sourceImage = await loadImage(src);
    const ui = buildDialog();
    const state = {
      scale: 1,
      minScale: 1,
      x: 0,
      y: 0,
      dragging: false,
      dragStartX: 0,
      dragStartY: 0,
      baseX: 0,
      baseY: 0
    };

    ui.img.src = src;

    function frameRect(){
      const stage = ui.stage.getBoundingClientRect();
      const frame = ui.frame.getBoundingClientRect();
      return {
        stage,
        left: frame.left - stage.left,
        top: frame.top - stage.top,
        size: frame.width
      };
    }

    function computeMinScale(){
      const rect = frameRect();
      return Math.max(rect.size / sourceImage.naturalWidth, rect.size / sourceImage.naturalHeight);
    }

    function constrain(){
      const rect = frameRect();
      const imgW = sourceImage.naturalWidth * state.scale;
      const imgH = sourceImage.naturalHeight * state.scale;
      const centerX = rect.stage.width / 2;
      const centerY = rect.stage.height / 2;
      const frameLeft = rect.left;
      const frameRight = rect.left + rect.size;
      const frameTop = rect.top;
      const frameBottom = rect.top + rect.size;
      const minX = frameRight - centerX - imgW / 2;
      const maxX = frameLeft - centerX + imgW / 2;
      const minY = frameBottom - centerY - imgH / 2;
      const maxY = frameTop - centerY + imgH / 2;
      state.x = clamp(state.x, Math.min(minX, maxX), Math.max(minX, maxX));
      state.y = clamp(state.y, Math.min(minY, maxY), Math.max(minY, maxY));
    }

    function render(){
      constrain();
      ui.img.style.width = `${sourceImage.naturalWidth}px`;
      ui.img.style.height = `${sourceImage.naturalHeight}px`;
      ui.img.style.transform = `translate(calc(-50% + ${state.x}px), calc(-50% + ${state.y}px)) scale(${state.scale})`;
    }

    function reset(){
      state.minScale = computeMinScale();
      state.scale = state.minScale;
      ui.zoom.min = String(state.minScale);
      ui.zoom.max = String(Math.max(state.minScale * 4, state.minScale + 1));
      ui.zoom.value = String(state.scale);
      state.x = 0;
      state.y = 0;
      render();
    }

    function cleanup(){
      ui.dialog.close();
      ui.dialog.remove();
    }

    const result = new Promise((resolve) => {
      function cancel(){
        cleanup();
        resolve(null);
      }

      ui.closeBtn.addEventListener('click', cancel);
      ui.cancelBtn.addEventListener('click', cancel);
      ui.dialog.addEventListener('cancel', (ev) => {
        ev.preventDefault();
        cancel();
      });

      ui.resetBtn.addEventListener('click', reset);
      ui.zoom.addEventListener('input', () => {
        state.scale = Number(ui.zoom.value) || state.minScale;
        render();
      });

      ui.stage.addEventListener('pointerdown', (ev) => {
        state.dragging = true;
        state.dragStartX = ev.clientX;
        state.dragStartY = ev.clientY;
        state.baseX = state.x;
        state.baseY = state.y;
        ui.stage.setPointerCapture(ev.pointerId);
      });

      ui.stage.addEventListener('pointermove', (ev) => {
        if (!state.dragging) return;
        state.x = state.baseX + (ev.clientX - state.dragStartX);
        state.y = state.baseY + (ev.clientY - state.dragStartY);
        render();
      });

      ui.stage.addEventListener('pointerup', () => {
        state.dragging = false;
      });

      ui.applyBtn.addEventListener('click', async () => {
        const rect = frameRect();
        const canvas = document.createElement('canvas');
        canvas.width = OUTPUT_SIZE;
        canvas.height = OUTPUT_SIZE;
        const ctx = canvas.getContext('2d');
        const centerX = rect.stage.width / 2;
        const centerY = rect.stage.height / 2;
        const imgLeft = centerX + state.x - (sourceImage.naturalWidth * state.scale) / 2;
        const imgTop = centerY + state.y - (sourceImage.naturalHeight * state.scale) / 2;
        const sourceX = (rect.left - imgLeft) / state.scale;
        const sourceY = (rect.top - imgTop) / state.scale;
        const sourceSize = rect.size / state.scale;
        ctx.drawImage(sourceImage, sourceX, sourceY, sourceSize, sourceSize, 0, 0, OUTPUT_SIZE, OUTPUT_SIZE);
        const blob = await canvasToBlob(canvas);
        cleanup();
        if (!blob) return resolve(null);
        const originalName = String(options.outputName || file.name || 'foto.jpg').replace(/\.[^.]+$/, '');
        resolve(new File([blob], `${originalName}_recortada.jpg`, { type: 'image/jpeg' }));
      });
    });

    ui.dialog.showModal();
    requestAnimationFrame(reset);
    window.addEventListener('resize', reset, { once: true });
    return result;
  }

  window.LipaPhotoCropper = { pick };
})();
