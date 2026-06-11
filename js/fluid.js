/* ============================================================
   WebGL 实时流体模拟背景
   基于经典 Stable Fluids (Jos Stam) / GPU Gems 方案的精简实现:
   advection → splat → vorticity → divergence → pressure → project
============================================================ */
(function () {
  'use strict';

  var canvas = document.getElementById('fluid');
  if (!canvas) return;

  var config = {
    SIM_RESOLUTION: 128,
    DYE_RESOLUTION: 720,
    DENSITY_DISSIPATION: 1.1,
    VELOCITY_DISSIPATION: 0.35,
    PRESSURE: 0.8,
    PRESSURE_ITERATIONS: 20,
    CURL: 22,
    SPLAT_RADIUS: 0.22,
    SPLAT_FORCE: 6000,
    AUTO_SPLAT_INTERVAL: 2.6, // 秒,无操作时自动“注墨”
  };

  // ---------- WebGL 上下文 ----------
  function getWebGLContext(canvas) {
    var params = { alpha: true, depth: false, stencil: false, antialias: false, preserveDrawingBuffer: false };
    var gl = canvas.getContext('webgl2', params);
    var isWebGL2 = !!gl;
    if (!isWebGL2) {
      gl = canvas.getContext('webgl', params) || canvas.getContext('experimental-webgl', params);
    }
    if (!gl) return null;

    var halfFloat;
    var supportLinearFiltering;
    if (isWebGL2) {
      gl.getExtension('EXT_color_buffer_float');
      supportLinearFiltering = gl.getExtension('OES_texture_float_linear');
    } else {
      halfFloat = gl.getExtension('OES_texture_half_float');
      supportLinearFiltering = gl.getExtension('OES_texture_half_float_linear');
    }
    gl.clearColor(0, 0, 0, 1);

    var halfFloatTexType = isWebGL2 ? gl.HALF_FLOAT : (halfFloat && halfFloat.HALF_FLOAT_OES);
    var formatRGBA, formatRG, formatR;
    if (isWebGL2) {
      formatRGBA = getSupportedFormat(gl, gl.RGBA16F, gl.RGBA, halfFloatTexType);
      formatRG = getSupportedFormat(gl, gl.RG16F, gl.RG, halfFloatTexType);
      formatR = getSupportedFormat(gl, gl.R16F, gl.RED, halfFloatTexType);
    } else {
      formatRGBA = getSupportedFormat(gl, gl.RGBA, gl.RGBA, halfFloatTexType);
      formatRG = formatRGBA;
      formatR = formatRGBA;
    }
    if (!formatRGBA) return null;

    return {
      gl: gl,
      ext: {
        formatRGBA: formatRGBA,
        formatRG: formatRG,
        formatR: formatR,
        halfFloatTexType: halfFloatTexType,
        supportLinearFiltering: supportLinearFiltering,
      },
    };
  }

  function getSupportedFormat(gl, internalFormat, format, type) {
    if (!supportRenderTextureFormat(gl, internalFormat, format, type)) {
      switch (internalFormat) {
        case gl.R16F: return getSupportedFormat(gl, gl.RG16F, gl.RG, type);
        case gl.RG16F: return getSupportedFormat(gl, gl.RGBA16F, gl.RGBA, type);
        default: return null;
      }
    }
    return { internalFormat: internalFormat, format: format };
  }

  function supportRenderTextureFormat(gl, internalFormat, format, type) {
    var texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, 4, 4, 0, format, type, null);
    var fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    var ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    gl.deleteFramebuffer(fbo);
    gl.deleteTexture(texture);
    return ok;
  }

  var context = getWebGLContext(canvas);
  if (!context) {
    // WebGL 不可用时退级为静态渐变背景
    canvas.style.background = 'radial-gradient(1200px 800px at 70% 20%, #14223c, #06080f)';
    return;
  }
  var gl = context.gl;
  var ext = context.ext;

  if (!ext.supportLinearFiltering) {
    config.DYE_RESOLUTION = 360;
  }

  // ---------- Shader 工具 ----------
  function compileShader(type, source) {
    var shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    return shader;
  }

  function createProgram(vs, fs) {
    var program = gl.createProgram();
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    var uniforms = {};
    var count = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
    for (var i = 0; i < count; i++) {
      var name = gl.getActiveUniform(program, i).name;
      uniforms[name] = gl.getUniformLocation(program, name);
    }
    return { program: program, uniforms: uniforms };
  }

  var baseVertexShader = compileShader(gl.VERTEX_SHADER, [
    'precision highp float;',
    'attribute vec2 aPosition;',
    'varying vec2 vUv;',
    'varying vec2 vL; varying vec2 vR; varying vec2 vT; varying vec2 vB;',
    'uniform vec2 texelSize;',
    'void main () {',
    '  vUv = aPosition * 0.5 + 0.5;',
    '  vL = vUv - vec2(texelSize.x, 0.0);',
    '  vR = vUv + vec2(texelSize.x, 0.0);',
    '  vT = vUv + vec2(0.0, texelSize.y);',
    '  vB = vUv - vec2(0.0, texelSize.y);',
    '  gl_Position = vec4(aPosition, 0.0, 1.0);',
    '}',
  ].join('\n'));

  var copyShader = compileShader(gl.FRAGMENT_SHADER, [
    'precision mediump float; precision mediump sampler2D;',
    'varying highp vec2 vUv;',
    'uniform sampler2D uTexture;',
    'void main () { gl_FragColor = texture2D(uTexture, vUv); }',
  ].join('\n'));

  var clearShader = compileShader(gl.FRAGMENT_SHADER, [
    'precision mediump float; precision mediump sampler2D;',
    'varying highp vec2 vUv;',
    'uniform sampler2D uTexture;',
    'uniform float value;',
    'void main () { gl_FragColor = value * texture2D(uTexture, vUv); }',
  ].join('\n'));

  var displayShader = compileShader(gl.FRAGMENT_SHADER, [
    'precision highp float; precision highp sampler2D;',
    'varying vec2 vUv;',
    'uniform sampler2D uTexture;',
    'void main () {',
    '  vec3 c = texture2D(uTexture, vUv).rgb;',
    // 轻微的色调映射,让暗部更干净、亮部带霓虹感
    '  float a = max(c.r, max(c.g, c.b));',
    '  gl_FragColor = vec4(c, 1.0);',
    '}',
  ].join('\n'));

  var splatShader = compileShader(gl.FRAGMENT_SHADER, [
    'precision highp float; precision highp sampler2D;',
    'varying vec2 vUv;',
    'uniform sampler2D uTarget;',
    'uniform float aspectRatio;',
    'uniform vec3 color;',
    'uniform vec2 point;',
    'uniform float radius;',
    'void main () {',
    '  vec2 p = vUv - point.xy;',
    '  p.x *= aspectRatio;',
    '  vec3 splat = exp(-dot(p, p) / radius) * color;',
    '  vec3 base = texture2D(uTarget, vUv).xyz;',
    '  gl_FragColor = vec4(base + splat, 1.0);',
    '}',
  ].join('\n'));

  var advectionShader = compileShader(gl.FRAGMENT_SHADER, [
    'precision highp float; precision highp sampler2D;',
    'varying vec2 vUv;',
    'uniform sampler2D uVelocity;',
    'uniform sampler2D uSource;',
    'uniform vec2 texelSize;',
    'uniform vec2 dyeTexelSize;',
    'uniform float dt;',
    'uniform float dissipation;',
    'vec4 bilerp (sampler2D sam, vec2 uv, vec2 tsize) {',
    '  vec2 st = uv / tsize - 0.5;',
    '  vec2 iuv = floor(st);',
    '  vec2 fuv = fract(st);',
    '  vec4 a = texture2D(sam, (iuv + vec2(0.5, 0.5)) * tsize);',
    '  vec4 b = texture2D(sam, (iuv + vec2(1.5, 0.5)) * tsize);',
    '  vec4 c = texture2D(sam, (iuv + vec2(0.5, 1.5)) * tsize);',
    '  vec4 d = texture2D(sam, (iuv + vec2(1.5, 1.5)) * tsize);',
    '  return mix(mix(a, b, fuv.x), mix(c, d, fuv.x), fuv.y);',
    '}',
    'void main () {',
    '#ifdef MANUAL_FILTERING',
    '  vec2 coord = vUv - dt * bilerp(uVelocity, vUv, texelSize).xy * texelSize;',
    '  vec4 result = bilerp(uSource, coord, dyeTexelSize);',
    '#else',
    '  vec2 coord = vUv - dt * texture2D(uVelocity, vUv).xy * texelSize;',
    '  vec4 result = texture2D(uSource, coord);',
    '#endif',
    '  float decay = 1.0 + dissipation * dt;',
    '  gl_FragColor = result / decay;',
    '}',
  ].join('\n'));

  var advectionShaderManual = compileShader(gl.FRAGMENT_SHADER, '#define MANUAL_FILTERING 1\n' + [
    'precision highp float; precision highp sampler2D;',
    'varying vec2 vUv;',
    'uniform sampler2D uVelocity;',
    'uniform sampler2D uSource;',
    'uniform vec2 texelSize;',
    'uniform vec2 dyeTexelSize;',
    'uniform float dt;',
    'uniform float dissipation;',
    'vec4 bilerp (sampler2D sam, vec2 uv, vec2 tsize) {',
    '  vec2 st = uv / tsize - 0.5;',
    '  vec2 iuv = floor(st);',
    '  vec2 fuv = fract(st);',
    '  vec4 a = texture2D(sam, (iuv + vec2(0.5, 0.5)) * tsize);',
    '  vec4 b = texture2D(sam, (iuv + vec2(1.5, 0.5)) * tsize);',
    '  vec4 c = texture2D(sam, (iuv + vec2(0.5, 1.5)) * tsize);',
    '  vec4 d = texture2D(sam, (iuv + vec2(1.5, 1.5)) * tsize);',
    '  return mix(mix(a, b, fuv.x), mix(c, d, fuv.x), fuv.y);',
    '}',
    'void main () {',
    '  vec2 coord = vUv - dt * bilerp(uVelocity, vUv, texelSize).xy * texelSize;',
    '  vec4 result = bilerp(uSource, coord, dyeTexelSize);',
    '  float decay = 1.0 + dissipation * dt;',
    '  gl_FragColor = result / decay;',
    '}',
  ].join('\n'));

  var divergenceShader = compileShader(gl.FRAGMENT_SHADER, [
    'precision mediump float; precision mediump sampler2D;',
    'varying highp vec2 vUv;',
    'varying highp vec2 vL; varying highp vec2 vR; varying highp vec2 vT; varying highp vec2 vB;',
    'uniform sampler2D uVelocity;',
    'void main () {',
    '  float L = texture2D(uVelocity, vL).x;',
    '  float R = texture2D(uVelocity, vR).x;',
    '  float T = texture2D(uVelocity, vT).y;',
    '  float B = texture2D(uVelocity, vB).y;',
    '  vec2 C = texture2D(uVelocity, vUv).xy;',
    '  if (vL.x < 0.0) { L = -C.x; }',
    '  if (vR.x > 1.0) { R = -C.x; }',
    '  if (vT.y > 1.0) { T = -C.y; }',
    '  if (vB.y < 0.0) { B = -C.y; }',
    '  float div = 0.5 * (R - L + T - B);',
    '  gl_FragColor = vec4(div, 0.0, 0.0, 1.0);',
    '}',
  ].join('\n'));

  var curlShader = compileShader(gl.FRAGMENT_SHADER, [
    'precision mediump float; precision mediump sampler2D;',
    'varying highp vec2 vUv;',
    'varying highp vec2 vL; varying highp vec2 vR; varying highp vec2 vT; varying highp vec2 vB;',
    'uniform sampler2D uVelocity;',
    'void main () {',
    '  float L = texture2D(uVelocity, vL).y;',
    '  float R = texture2D(uVelocity, vR).y;',
    '  float T = texture2D(uVelocity, vT).x;',
    '  float B = texture2D(uVelocity, vB).x;',
    '  float vorticity = R - L - T + B;',
    '  gl_FragColor = vec4(0.5 * vorticity, 0.0, 0.0, 1.0);',
    '}',
  ].join('\n'));

  var vorticityShader = compileShader(gl.FRAGMENT_SHADER, [
    'precision highp float; precision highp sampler2D;',
    'varying vec2 vUv;',
    'varying vec2 vL; varying vec2 vR; varying vec2 vT; varying vec2 vB;',
    'uniform sampler2D uVelocity;',
    'uniform sampler2D uCurl;',
    'uniform float curl;',
    'uniform float dt;',
    'void main () {',
    '  float L = texture2D(uCurl, vL).x;',
    '  float R = texture2D(uCurl, vR).x;',
    '  float T = texture2D(uCurl, vT).x;',
    '  float B = texture2D(uCurl, vB).x;',
    '  float C = texture2D(uCurl, vUv).x;',
    '  vec2 force = 0.5 * vec2(abs(T) - abs(B), abs(R) - abs(L));',
    '  force /= length(force) + 0.0001;',
    '  force *= curl * C;',
    '  force.y *= -1.0;',
    '  vec2 velocity = texture2D(uVelocity, vUv).xy;',
    '  velocity += force * dt;',
    '  velocity = min(max(velocity, -1000.0), 1000.0);',
    '  gl_FragColor = vec4(velocity, 0.0, 1.0);',
    '}',
  ].join('\n'));

  var pressureShader = compileShader(gl.FRAGMENT_SHADER, [
    'precision mediump float; precision mediump sampler2D;',
    'varying highp vec2 vUv;',
    'varying highp vec2 vL; varying highp vec2 vR; varying highp vec2 vT; varying highp vec2 vB;',
    'uniform sampler2D uPressure;',
    'uniform sampler2D uDivergence;',
    'void main () {',
    '  float L = texture2D(uPressure, vL).x;',
    '  float R = texture2D(uPressure, vR).x;',
    '  float T = texture2D(uPressure, vT).x;',
    '  float B = texture2D(uPressure, vB).x;',
    '  float divergence = texture2D(uDivergence, vUv).x;',
    '  float pressure = (L + R + B + T - divergence) * 0.25;',
    '  gl_FragColor = vec4(pressure, 0.0, 0.0, 1.0);',
    '}',
  ].join('\n'));

  var gradientSubtractShader = compileShader(gl.FRAGMENT_SHADER, [
    'precision mediump float; precision mediump sampler2D;',
    'varying highp vec2 vUv;',
    'varying highp vec2 vL; varying highp vec2 vR; varying highp vec2 vT; varying highp vec2 vB;',
    'uniform sampler2D uPressure;',
    'uniform sampler2D uVelocity;',
    'void main () {',
    '  float L = texture2D(uPressure, vL).x;',
    '  float R = texture2D(uPressure, vR).x;',
    '  float T = texture2D(uPressure, vT).x;',
    '  float B = texture2D(uPressure, vB).x;',
    '  vec2 velocity = texture2D(uVelocity, vUv).xy;',
    '  velocity.xy -= vec2(R - L, T - B);',
    '  gl_FragColor = vec4(velocity, 0.0, 1.0);',
    '}',
  ].join('\n'));

  var copyProgram = createProgram(baseVertexShader, copyShader);
  var clearProgram = createProgram(baseVertexShader, clearShader);
  var displayProgram = createProgram(baseVertexShader, displayShader);
  var splatProgram = createProgram(baseVertexShader, splatShader);
  var advectionProgram = createProgram(baseVertexShader, ext.supportLinearFiltering ? advectionShader : advectionShaderManual);
  var divergenceProgram = createProgram(baseVertexShader, divergenceShader);
  var curlProgram = createProgram(baseVertexShader, curlShader);
  var vorticityProgram = createProgram(baseVertexShader, vorticityShader);
  var pressureProgram = createProgram(baseVertexShader, pressureShader);
  var gradienSubtractProgram = createProgram(baseVertexShader, gradientSubtractShader);

  // ---------- 全屏三角形 ----------
  var blit = (function () {
    var buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, -1, 1, 1, 1, 1, -1]), gl.STATIC_DRAW);
    var elemBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, elemBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array([0, 1, 2, 0, 2, 3]), gl.STATIC_DRAW);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(0);
    return function (target) {
      if (target == null) {
        gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      } else {
        gl.viewport(0, 0, target.width, target.height);
        gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
      }
      gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
    };
  })();

  // ---------- FBO ----------
  function createFBO(w, h, internalFormat, format, type, filter) {
    var texture = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, w, h, 0, format, type, null);
    var fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    gl.viewport(0, 0, w, h);
    gl.clear(gl.COLOR_BUFFER_BIT);
    return {
      texture: texture, fbo: fbo, width: w, height: h,
      texelSizeX: 1 / w, texelSizeY: 1 / h,
      attach: function (id) {
        gl.activeTexture(gl.TEXTURE0 + id);
        gl.bindTexture(gl.TEXTURE_2D, texture);
        return id;
      },
    };
  }

  function createDoubleFBO(w, h, internalFormat, format, type, filter) {
    var fbo1 = createFBO(w, h, internalFormat, format, type, filter);
    var fbo2 = createFBO(w, h, internalFormat, format, type, filter);
    return {
      width: w, height: h,
      texelSizeX: fbo1.texelSizeX, texelSizeY: fbo1.texelSizeY,
      get read() { return fbo1; },
      set read(v) { fbo1 = v; },
      get write() { return fbo2; },
      set write(v) { fbo2 = v; },
      swap: function () { var t = fbo1; fbo1 = fbo2; fbo2 = t; },
    };
  }

  function getResolution(resolution) {
    var aspectRatio = gl.drawingBufferWidth / gl.drawingBufferHeight;
    if (aspectRatio < 1) aspectRatio = 1 / aspectRatio;
    var min = Math.round(resolution);
    var max = Math.round(resolution * aspectRatio);
    if (gl.drawingBufferWidth > gl.drawingBufferHeight) return { width: max, height: min };
    return { width: min, height: max };
  }

  var dye, velocity, divergence, curl, pressure;

  function initFramebuffers() {
    var simRes = getResolution(config.SIM_RESOLUTION);
    var dyeRes = getResolution(config.DYE_RESOLUTION);
    var texType = ext.halfFloatTexType;
    var rgba = ext.formatRGBA;
    var rg = ext.formatRG;
    var r = ext.formatR;
    var filtering = ext.supportLinearFiltering ? gl.LINEAR : gl.NEAREST;
    gl.disable(gl.BLEND);

    dye = createDoubleFBO(dyeRes.width, dyeRes.height, rgba.internalFormat, rgba.format, texType, filtering);
    velocity = createDoubleFBO(simRes.width, simRes.height, rg.internalFormat, rg.format, texType, filtering);
    divergence = createFBO(simRes.width, simRes.height, r.internalFormat, r.format, texType, gl.NEAREST);
    curl = createFBO(simRes.width, simRes.height, r.internalFormat, r.format, texType, gl.NEAREST);
    pressure = createDoubleFBO(simRes.width, simRes.height, r.internalFormat, r.format, texType, gl.NEAREST);
  }

  // ---------- 指针 ----------
  function pointerPrototype() {
    return {
      id: -1, texcoordX: 0, texcoordY: 0,
      prevTexcoordX: 0, prevTexcoordY: 0,
      deltaX: 0, deltaY: 0,
      down: false, moved: false,
      color: [0.1, 0.3, 1.0],
    };
  }
  var pointers = [pointerPrototype()];

  // 主题色:青 → 紫 → 品红 之间随机
  function generateColor() {
    var palette = [
      [0.05, 0.55, 0.6],   // cyan
      [0.18, 0.1, 0.65],   // violet-blue
      [0.55, 0.05, 0.32],  // magenta
      [0.05, 0.25, 0.7],   // electric blue
      [0.4, 0.0, 0.6],     // purple
    ];
    var base = palette[Math.floor(Math.random() * palette.length)];
    var jitter = 0.7 + Math.random() * 0.6;
    return [base[0] * jitter * 0.22, base[1] * jitter * 0.22, base[2] * jitter * 0.22];
  }

  function scaleByPixelRatio(input) {
    var pixelRatio = window.devicePixelRatio || 1;
    return Math.floor(input * pixelRatio);
  }

  function updatePointerDownData(pointer, id, posX, posY) {
    pointer.id = id;
    pointer.down = true;
    pointer.moved = false;
    pointer.texcoordX = posX / canvas.width;
    pointer.texcoordY = 1 - posY / canvas.height;
    pointer.prevTexcoordX = pointer.texcoordX;
    pointer.prevTexcoordY = pointer.texcoordY;
    pointer.deltaX = 0;
    pointer.deltaY = 0;
    pointer.color = generateColor();
  }

  function updatePointerMoveData(pointer, posX, posY) {
    pointer.prevTexcoordX = pointer.texcoordX;
    pointer.prevTexcoordY = pointer.texcoordY;
    pointer.texcoordX = posX / canvas.width;
    pointer.texcoordY = 1 - posY / canvas.height;
    var aspect = canvas.width / canvas.height;
    pointer.deltaX = (pointer.texcoordX - pointer.prevTexcoordX) * (aspect < 1 ? aspect : 1);
    pointer.deltaY = (pointer.texcoordY - pointer.prevTexcoordY) * (aspect > 1 ? 1 / aspect : 1);
    pointer.moved = Math.abs(pointer.deltaX) > 0 || Math.abs(pointer.deltaY) > 0;
  }

  window.addEventListener('mousemove', function (e) {
    var pointer = pointers[0];
    var posX = scaleByPixelRatio(e.clientX);
    var posY = scaleByPixelRatio(e.clientY);
    if (pointer.id === -1) {
      updatePointerDownData(pointer, 0, posX, posY);
    }
    updatePointerMoveData(pointer, posX, posY);
    if (Math.random() < 0.02) pointer.color = generateColor();
  });

  window.addEventListener('touchstart', function (e) {
    var touches = e.targetTouches;
    while (pointers.length < touches.length) pointers.push(pointerPrototype());
    for (var i = 0; i < touches.length; i++) {
      var posX = scaleByPixelRatio(touches[i].clientX);
      var posY = scaleByPixelRatio(touches[i].clientY);
      updatePointerDownData(pointers[i], touches[i].identifier, posX, posY);
    }
  }, { passive: true });

  window.addEventListener('touchmove', function (e) {
    var touches = e.targetTouches;
    for (var i = 0; i < touches.length && i < pointers.length; i++) {
      var posX = scaleByPixelRatio(touches[i].clientX);
      var posY = scaleByPixelRatio(touches[i].clientY);
      updatePointerMoveData(pointers[i], posX, posY);
    }
  }, { passive: true });

  // ---------- Splat ----------
  function splat(x, y, dx, dy, color) {
    splatProgram.program && gl.useProgram(splatProgram.program);
    gl.uniform1i(splatProgram.uniforms.uTarget, velocity.read.attach(0));
    gl.uniform1f(splatProgram.uniforms.aspectRatio, canvas.width / canvas.height);
    gl.uniform2f(splatProgram.uniforms.point, x, y);
    gl.uniform3f(splatProgram.uniforms.color, dx, dy, 0);
    gl.uniform1f(splatProgram.uniforms.radius, correctRadius(config.SPLAT_RADIUS / 100));
    blit(velocity.write);
    velocity.swap();

    gl.uniform1i(splatProgram.uniforms.uTarget, dye.read.attach(0));
    gl.uniform3f(splatProgram.uniforms.color, color[0], color[1], color[2]);
    blit(dye.write);
    dye.swap();
  }

  function correctRadius(radius) {
    var aspectRatio = canvas.width / canvas.height;
    if (aspectRatio > 1) radius *= aspectRatio;
    return radius;
  }

  function splatPointer(pointer) {
    var dx = pointer.deltaX * config.SPLAT_FORCE;
    var dy = pointer.deltaY * config.SPLAT_FORCE;
    splat(pointer.texcoordX, pointer.texcoordY, dx, dy, pointer.color);
  }

  function multipleSplats(amount) {
    for (var i = 0; i < amount; i++) {
      var color = generateColor();
      color[0] *= 10; color[1] *= 10; color[2] *= 10;
      var x = Math.random();
      var y = Math.random();
      var dx = 1000 * (Math.random() - 0.5);
      var dy = 1000 * (Math.random() - 0.5);
      splat(x, y, dx, dy, color);
    }
  }

  // ---------- 模拟步 ----------
  function step(dt) {
    gl.disable(gl.BLEND);

    gl.useProgram(curlProgram.program);
    gl.uniform2f(curlProgram.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY);
    gl.uniform1i(curlProgram.uniforms.uVelocity, velocity.read.attach(0));
    blit(curl);

    gl.useProgram(vorticityProgram.program);
    gl.uniform2f(vorticityProgram.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY);
    gl.uniform1i(vorticityProgram.uniforms.uVelocity, velocity.read.attach(0));
    gl.uniform1i(vorticityProgram.uniforms.uCurl, curl.attach(1));
    gl.uniform1f(vorticityProgram.uniforms.curl, config.CURL);
    gl.uniform1f(vorticityProgram.uniforms.dt, dt);
    blit(velocity.write);
    velocity.swap();

    gl.useProgram(divergenceProgram.program);
    gl.uniform2f(divergenceProgram.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY);
    gl.uniform1i(divergenceProgram.uniforms.uVelocity, velocity.read.attach(0));
    blit(divergence);

    gl.useProgram(clearProgram.program);
    gl.uniform1i(clearProgram.uniforms.uTexture, pressure.read.attach(0));
    gl.uniform1f(clearProgram.uniforms.value, config.PRESSURE);
    blit(pressure.write);
    pressure.swap();

    gl.useProgram(pressureProgram.program);
    gl.uniform2f(pressureProgram.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY);
    gl.uniform1i(pressureProgram.uniforms.uDivergence, divergence.attach(0));
    for (var i = 0; i < config.PRESSURE_ITERATIONS; i++) {
      gl.uniform1i(pressureProgram.uniforms.uPressure, pressure.read.attach(1));
      blit(pressure.write);
      pressure.swap();
    }

    gl.useProgram(gradienSubtractProgram.program);
    gl.uniform2f(gradienSubtractProgram.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY);
    gl.uniform1i(gradienSubtractProgram.uniforms.uPressure, pressure.read.attach(0));
    gl.uniform1i(gradienSubtractProgram.uniforms.uVelocity, velocity.read.attach(1));
    blit(velocity.write);
    velocity.swap();

    gl.useProgram(advectionProgram.program);
    gl.uniform2f(advectionProgram.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY);
    if (!ext.supportLinearFiltering) {
      gl.uniform2f(advectionProgram.uniforms.dyeTexelSize, velocity.texelSizeX, velocity.texelSizeY);
    }
    var velocityId = velocity.read.attach(0);
    gl.uniform1i(advectionProgram.uniforms.uVelocity, velocityId);
    gl.uniform1i(advectionProgram.uniforms.uSource, velocityId);
    gl.uniform1f(advectionProgram.uniforms.dt, dt);
    gl.uniform1f(advectionProgram.uniforms.dissipation, config.VELOCITY_DISSIPATION);
    blit(velocity.write);
    velocity.swap();

    if (!ext.supportLinearFiltering) {
      gl.uniform2f(advectionProgram.uniforms.dyeTexelSize, dye.texelSizeX, dye.texelSizeY);
    }
    gl.uniform1i(advectionProgram.uniforms.uVelocity, velocity.read.attach(0));
    gl.uniform1i(advectionProgram.uniforms.uSource, dye.read.attach(1));
    gl.uniform1f(advectionProgram.uniforms.dissipation, config.DENSITY_DISSIPATION);
    blit(dye.write);
    dye.swap();
  }

  function render() {
    gl.useProgram(displayProgram.program);
    gl.uniform1i(displayProgram.uniforms.uTexture, dye.read.attach(0));
    blit(null);
  }

  function resizeCanvas() {
    var width = scaleByPixelRatio(canvas.clientWidth);
    var height = scaleByPixelRatio(canvas.clientHeight);
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
      return true;
    }
    return false;
  }

  // ---------- 主循环 ----------
  var lastUpdateTime = Date.now();
  var autoSplatTimer = 0;
  var hidden = false;

  document.addEventListener('visibilitychange', function () {
    hidden = document.hidden;
    lastUpdateTime = Date.now();
  });

  function update() {
    requestAnimationFrame(update);
    if (hidden) return;

    var now = Date.now();
    var dt = Math.min((now - lastUpdateTime) / 1000, 0.016666);
    lastUpdateTime = now;

    if (resizeCanvas()) initFramebuffers();

    // 指针交互
    for (var i = 0; i < pointers.length; i++) {
      var p = pointers[i];
      if (p.moved) {
        p.moved = false;
        splatPointer(p);
      }
    }

    // 自动注墨,保持画面活着
    autoSplatTimer += dt;
    if (autoSplatTimer > config.AUTO_SPLAT_INTERVAL) {
      autoSplatTimer = 0;
      var color = generateColor();
      color[0] *= 6; color[1] *= 6; color[2] *= 6;
      var x = 0.2 + Math.random() * 0.6;
      var y = 0.2 + Math.random() * 0.6;
      var angle = Math.random() * Math.PI * 2;
      splat(x, y, Math.cos(angle) * 600, Math.sin(angle) * 600, color);
    }

    step(dt);
    render();
  }

  resizeCanvas();
  initFramebuffers();
  multipleSplats(Math.floor(Math.random() * 6) + 6);
  update();
})();
