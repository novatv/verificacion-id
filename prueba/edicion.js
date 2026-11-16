/* Detección de edición en la foto del documento. Todo ocurre en el teléfono.
   Tres pruebas: metadatos del archivo, niveles de error JPEG (ELA) y ruido de cámara.
   Da indicios, no una prueba pericial. */
(function(){
'use strict';

var EDITORES = /photoshop|lightroom|gimp|canva|picsart|snapseed|pixelmator|affinity|paint\.net|paint ?shop|photopea|facetune|faceapp|remini|meitu|photodirector|inkscape|illustrator|corel|photoscape|fotor|pixlr|befunky|polarr|airbrush|lensa|acdsee|luminar|capture one|darktable|krita|imagemagick|gd-jpeg|pillow|photoroom|picsay|retouch|photo ?editor|adobe|microsoft paint|windows photo/i;
var IA = /firefly|midjourney|dall[-· ]?e|openai|chatgpt|stable diffusion|trainedAlgorithmicMedia|compositeSynthetic/i;
var TABLA_Q = [16,11,10,16,24,40,51,61,12,12,14,19,26,58,60,55,14,13,16,24,40,57,69,56,14,17,22,29,51,87,80,62,18,22,37,56,68,109,103,77,24,35,55,64,81,104,113,92,49,64,78,87,103,121,120,101,72,92,95,98,112,100,103,99];

function lat(u8, a, b){
  var s = '';
  for (var i = a; i < b; i += 8192) s += String.fromCharCode.apply(null, u8.subarray(i, Math.min(b, i + 8192)));
  return s;
}

/* ---------- Metadatos ---------- */

function leerExif(u8, ini, fin){
  var r = {}, lim = fin - ini;
  if (lim < 8) return r;
  var le = u8[ini] === 0x49;
  function u16(o){ o += ini; return le ? (u8[o] | u8[o+1] << 8) : (u8[o] << 8 | u8[o+1]); }
  function u32(o){ o += ini; return (le ? (u8[o] | u8[o+1] << 8 | u8[o+2] << 16 | u8[o+3] << 24) : (u8[o] << 24 | u8[o+1] << 16 | u8[o+2] << 8 | u8[o+3])) >>> 0; }
  function ascii(o, n){ var s = ''; for (var i = 0; i < n && o + i < lim; i++){ var ch = u8[ini + o + i]; if (!ch) break; s += String.fromCharCode(ch); } return s.trim(); }
  function ifd(off, mapa){
    if (!off || off + 2 > lim) return;
    var n = u16(off);
    for (var i = 0; i < n; i++){
      var e = off + 2 + i * 12;
      if (e + 12 > lim) return;
      var nombre = mapa[u16(e)], tipo = u16(e + 2), cnt = u32(e + 4);
      if (!nombre) continue;
      if (tipo === 2) r[nombre] = ascii(cnt <= 4 ? e + 8 : u32(e + 8), Math.min(cnt, 200));
      else if (tipo === 4) r[nombre] = u32(e + 8);
      else if (tipo === 3) r[nombre] = u16(e + 8);
    }
  }
  ifd(u32(4), { 0x010F:'make', 0x0110:'model', 0x0131:'software', 0x0132:'fecha', 0x8769:'exifIfd' });
  if (r.exifIfd) ifd(r.exifIfd, { 0x9003:'fechaOrig' });
  delete r.exifIfd;
  return r;
}

function copiar(m, e){ for (var k in e) if (e[k] && !m[k]) m[k] = e[k]; }

function metaJpeg(u8){
  var m = { formato: 'JPEG' }, p = 2, n = u8.length;
  while (p + 4 <= n){
    if (u8[p] !== 0xFF){ p++; continue; }
    var mk = u8[p + 1];
    if (mk === 0xFF){ p++; continue; }
    if (mk === 0xDA || mk === 0xD9) break;
    if ((mk >= 0xD0 && mk <= 0xD7) || mk === 0x01){ p += 2; continue; }
    var len = u8[p + 2] << 8 | u8[p + 3], a = p + 4, b = Math.min(n, p + 2 + len);
    if (mk === 0xE1){
      var cab = lat(u8, a, Math.min(b, a + 30));
      if (cab.indexOf('Exif') === 0) copiar(m, leerExif(u8, a + 6, b));
      else if (cab.indexOf('http://ns.adobe.com/xap') === 0) m.xmp = (m.xmp || '') + lat(u8, a, b);
    } else if (mk === 0xED){
      if (lat(u8, a, Math.min(b, a + 13)).indexOf('Photoshop') === 0) m.irb = true;
    } else if (mk === 0xEB){
      var t = lat(u8, a, b);
      if (/c2pa/i.test(t)) m.c2pa = true;
      if (IA.test(t)) m.ia = true;
    } else if (mk === 0xFE){
      m.comentario = lat(u8, a, Math.min(b, a + 200)).replace(/[^\x20-\x7e]/g, ' ').trim();
    } else if (mk === 0xDB){
      var q = a;
      while (q < b){
        var prec = u8[q] >> 4, id = u8[q] & 15, tam = prec ? 128 : 64; q++;
        if (id === 0 && !prec && !m.calidad && q + 64 <= b){
          var suma = 0, base = 0;
          for (var i = 0; i < 64; i++){ suma += u8[q + i]; base += TABLA_Q[i]; }
          var esc = suma / base * 100;
          m.calidad = Math.max(1, Math.min(100, Math.round(esc <= 100 ? (200 - esc) / 2 : 5000 / esc)));
        }
        q += tam;
      }
    }
    p = b;
  }
  return m;
}

function metaPng(u8){
  var m = { formato: 'PNG' }, p = 8, n = u8.length;
  while (p + 12 <= n){
    var len = (u8[p] << 24 | u8[p+1] << 16 | u8[p+2] << 8 | u8[p+3]) >>> 0;
    var tipo = lat(u8, p + 4, p + 8), a = p + 8, b = Math.min(n, a + len);
    if (tipo === 'tEXt' || tipo === 'iTXt'){
      var t = lat(u8, a, Math.min(b, a + 60000));
      if (t.indexOf('Software') === 0) m.software = t.slice(8).replace(/[^\x20-\x7e]/g, ' ').trim();
      if (t.indexOf('XML:com.adobe.xmp') === 0) m.xmp = t;
      if (IA.test(t)) m.ia = true;
    } else if (tipo === 'eXIf'){
      copiar(m, leerExif(u8, a, b));
    } else if (tipo === 'caBX'){
      m.c2pa = true;
      if (IA.test(lat(u8, a, b))) m.ia = true;
    }
    p = b + 4;
  }
  return m;
}

function metadatos(u8){
  var m;
  if (u8[0] === 0xFF && u8[1] === 0xD8) m = metaJpeg(u8);
  else if (u8[0] === 0x89 && u8[1] === 0x50) m = metaPng(u8);
  else if (lat(u8, 8, 12) === 'WEBP') m = { formato: 'WebP' };
  else m = { formato: 'otro' };
  if (m.xmp){
    var x = m.xmp, r;
    r = /CreatorTool(?:>|=")([^<"]+)/.exec(x); if (r) m.herramienta = r[1].trim();
    m.agentes = [];
    var re = /softwareAgent(?:>|=")([^<"]+)/g;
    while ((r = re.exec(x))) if (m.agentes.indexOf(r[1].trim()) < 0) m.agentes.push(r[1].trim());
    if (/xmpMM:History/.test(x)) m.historial = true;
    if (IA.test(x)) m.ia = true;
    delete m.xmp;
  }
  return m;
}

function fechaExif(s){
  var r = /(\d{4})\D(\d{2})\D(\d{2})\D+(\d{2})\D(\d{2})\D(\d{2})/.exec(s || '');
  return r ? new Date(+r[1], +r[2] - 1, +r[3], +r[4], +r[5], +r[6]) : null;
}

function senalesMeta(m){
  var p = [];
  function add(nivel, titulo, detalle){ p.push({ nivel: nivel, titulo: titulo, detalle: detalle }); }
  var nombres = [m.software, m.herramienta, m.comentario].concat(m.agentes || []).filter(Boolean);
  var editor = nombres.filter(function(s){ return EDITORES.test(s); })[0];
  var ia = m.ia || nombres.some(function(s){ return IA.test(s); });

  if (ia) add('mal', 'Imagen creada o retocada con inteligencia artificial', 'El propio archivo lo declara en sus datos internos.');
  if (editor) add('mal', 'El archivo pasó por un programa de edición', 'Guardado con «' + editor.slice(0, 60) + '».');
  else if (m.irb || m.historial) add('aviso', 'El archivo lleva rastro de un programa de retoque', m.historial ? 'Guarda un historial de cambios.' : 'Lleva un bloque de datos de los que escribe Photoshop y programas parecidos.');

  var f1 = fechaExif(m.fechaOrig), f2 = fechaExif(m.fecha);
  if (f1 && f2 && Math.abs(f2 - f1) > 120000)
    add('aviso', 'Se volvió a guardar después de hacer la foto', 'Hecha el ' + f1.toLocaleString('es') + ' y guardada otra vez el ' + f2.toLocaleString('es') + '.');

  if (m.formato === 'PNG' || m.formato === 'WebP')
    add('aviso', 'No es una foto directa de la cámara', 'Es un archivo ' + m.formato + ': captura de pantalla o imagen exportada desde un programa.');
  else if (m.formato === 'JPEG' && !m.make && !m.model)
    add('aviso', 'Sin datos de la cámara', 'El archivo no dice con qué teléfono se hizo. Pasa con capturas de pantalla, fotos reenviadas por WhatsApp e imágenes exportadas. Pide la foto original.');
  else if ((m.make || m.model) && !editor && !ia)
    add('bien', 'Foto original de cámara', ((m.make || '') + ' ' + (m.model || '')).trim() + (f1 ? ' · ' + f1.toLocaleDateString('es') : '') + (m.calidad ? ' · calidad JPEG ' + m.calidad : ''));
  return p;
}

/* ---------- Píxeles ---------- */

function cargarImagen(src){
  return new Promise(function(ok, mal){
    var im = new Image();
    im.onload = function(){ ok(im); };
    im.onerror = function(){ mal(new Error('No se pudo abrir la imagen')); };
    im.src = src;
  });
}

function lienzoDe(im, w, h){
  var c = document.createElement('canvas');
  c.width = w; c.height = h;
  c.getContext('2d', { willReadFrequently: true }).drawImage(im, 0, 0, w, h);
  return c;
}

function recomprimir(c, q){
  return new Promise(function(ok, mal){
    c.toBlob(function(b){
      if (!b) return mal(new Error('sin blob'));
      var u = URL.createObjectURL(b);
      cargarImagen(u).then(function(im){ URL.revokeObjectURL(u); ok(lienzoDe(im, c.width, c.height)); }, mal);
    }, 'image/jpeg', q);
  });
}

// Estadísticas por bloque, leyendo el lienzo por tiras para no llenar la memoria del móvil
function medirBloques(cA, cB, B){
  var bw = Math.floor(cA.width / B), bh = Math.floor(cA.height / B), n = bw * bh;
  var r = { bw: bw, bh: bh, B: B, ela: cB ? new Float32Array(n) : null, tex: new Float32Array(n), rui: new Float32Array(n), luz: new Float32Array(n) };
  var xA = cA.getContext('2d', { willReadFrequently: true }), xB = cB ? cB.getContext('2d', { willReadFrequently: true }) : null;
  var porTira = Math.max(1, Math.floor(512 / B)), ww = bw * B;
  for (var by0 = 0; by0 < bh; by0 += porTira){
    var nb = Math.min(porTira, bh - by0), alto = nb * B;
    var a = xA.getImageData(0, by0 * B, ww, alto).data;
    var b = xB ? xB.getImageData(0, by0 * B, ww, alto).data : null;
    var L = new Float32Array(ww * alto);
    for (var i = 0, k = 0; i < L.length; i++, k += 4) L[i] = 0.299 * a[k] + 0.587 * a[k+1] + 0.114 * a[k+2];
    for (var by = 0; by < nb; by++){
      for (var bx = 0; bx < bw; bx++){
        var sE = 0, sT = 0, sL = 0, sR = 0, sR2 = 0, nR = 0;
        for (var y = 0; y < B; y++){
          var j = (by * B + y) * ww + bx * B;
          for (var x = 0; x < B; x++, j++){
            var v = L[j];
            sL += v;
            if (x < B - 1) sT += Math.abs(L[j + 1] - v);
            if (y < B - 1) sT += Math.abs(L[j + ww] - v);
            if (b){ var q = j * 4; sE += Math.abs(a[q] - b[q]) + Math.abs(a[q+1] - b[q+1]) + Math.abs(a[q+2] - b[q+2]); }
            if (x > 0 && x < B - 1 && y > 0 && y < B - 1){
              var d = v - (L[j-ww-1] + L[j-ww] + L[j-ww+1] + L[j-1] + v + L[j+1] + L[j+ww-1] + L[j+ww] + L[j+ww+1]) / 9;
              sR += d; sR2 += d * d; nR++;
            }
          }
        }
        var idx = (by0 + by) * bw + bx;
        if (r.ela) r.ela[idx] = sE / (3 * B * B);
        r.tex[idx] = sT / (2 * B * (B - 1));
        r.luz[idx] = sL / (B * B);
        r.rui[idx] = Math.sqrt(Math.max(0, sR2 / nR - (sR / nR) * (sR / nR)));
      }
    }
  }
  return r;
}

function mediana(v){
  if (!v.length) return 0;
  var s = Array.prototype.slice.call(v).sort(function(x, y){ return x - y; });
  return s[s.length >> 1];
}

// Agrupa bloques marcados que se tocan (también en diagonal)
function grupos(marca, bw, bh){
  var visto = new Uint8Array(marca.length), out = [];
  for (var i = 0; i < marca.length; i++){
    if (!marca[i] || visto[i]) continue;
    var pila = [i], g = { n: 0, x0: bw, y0: bh, x1: 0, y1: 0 };
    visto[i] = 1;
    while (pila.length){
      var c = pila.pop(), cx = c % bw, cy = (c - cx) / bw;
      g.n++;
      if (cx < g.x0) g.x0 = cx; if (cx > g.x1) g.x1 = cx; if (cy < g.y0) g.y0 = cy; if (cy > g.y1) g.y1 = cy;
      for (var dy = -1; dy <= 1; dy++) for (var dx = -1; dx <= 1; dx++){
        var nx = cx + dx, ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= bw || ny >= bh) continue;
        var k = ny * bw + nx;
        if (marca[k] && !visto[k]){ visto[k] = 1; pila.push(k); }
      }
    }
    out.push(g);
  }
  return out;
}

// ELA: bloques con mucho más error del que toca para su textura
function zonasEla(m){
  var n = m.ela.length, orden = [];
  for (var i = 0; i < n; i++) orden.push(i);
  orden.sort(function(x, y){ return m.tex[x] - m.tex[y]; });
  var marca = new Uint8Array(n), NB = 12, tam = Math.ceil(n / NB), marcados = 0;
  for (var b = 0; b < NB; b++){
    var ids = orden.slice(b * tam, (b + 1) * tam);
    if (ids.length < 20) continue;
    var vals = ids.map(function(i){ return m.ela[i]; });
    var med = mediana(vals), mad = mediana(vals.map(function(v){ return Math.abs(v - med); }));
    var umbral = med + 6 * (1.4826 * mad) + 1.2;
    ids.forEach(function(i){ if (m.ela[i] > umbral && m.ela[i] > med * 2.2){ marca[i] = 1; marcados++; } });
  }
  if (marcados > n * 0.10) return { zonas: [], difuso: true };
  return { zonas: grupos(marca, m.bw, m.bh).filter(function(g){ return g.n >= 8 && g.n >= (g.x1 - g.x0 + 1) * (g.y1 - g.y0 + 1) * 0.4; }) };
}

// Parches «de ordenador»: rectángulos de color perfectamente liso rodeados de grano normal de cámara
function zonasRuido(m){
  var n = m.rui.length, lisos = [], i;
  var texMed = mediana(m.tex);
  for (i = 0; i < n; i++) if (m.tex[i] <= texMed && m.luz[i] > 14 && m.luz[i] < 241) lisos.push(m.rui[i]);
  var r = { base: mediana(lisos), zonas: [] };
  var marca = new Uint8Array(n);
  for (i = 0; i < n; i++) if (m.rui[i] < 0.03 && m.tex[i] < 0.03 && m.luz[i] > 14 && m.luz[i] < 241) marca[i] = 1;
  r.zonas = grupos(marca, m.bw, m.bh).filter(function(g){
    var w = g.x1 - g.x0 + 1, h = g.y1 - g.y0 + 1;
    if (g.n < 8 || g.n < w * h * 0.7 || w * h > n * 0.04) return false;
    // alrededor tiene que haber grano normal: si no, es una zona lisa de verdad (fondo oscuro o muy comprimido)
    var s = 0, c = 0, planos = 0;
    for (var y = g.y0 - 3; y <= g.y1 + 3; y++) for (var x = g.x0 - 3; x <= g.x1 + 3; x++){
      if (x < 0 || y < 0 || x >= m.bw || y >= m.bh) continue;
      if (x >= g.x0 && x <= g.x1 && y >= g.y0 && y <= g.y1) continue;
      var k = y * m.bw + x;
      s += m.rui[k]; c++; if (m.rui[k] < 0.03) planos++;
    }
    return c > 0 && s / c > 0.15 && planos < c * 0.15;
  });
  return r;
}

function unir(zonas, m, tipo){
  return zonas.map(function(g){
    return { tipo: tipo, x: g.x0 / m.bw, y: g.y0 / m.bh, w: (g.x1 - g.x0 + 1) / m.bw, h: (g.y1 - g.y0 + 1) / m.bh };
  });
}

function mapa(c, zonas){
  var esc = Math.min(1, 900 / Math.max(c.width, c.height));
  var o = document.createElement('canvas');
  o.width = Math.round(c.width * esc); o.height = Math.round(c.height * esc);
  var x = o.getContext('2d');
  x.drawImage(c, 0, 0, o.width, o.height);
  x.lineWidth = Math.max(3, o.width / 220); x.strokeStyle = '#ff2d55'; x.fillStyle = 'rgba(255,45,85,.22)';
  zonas.forEach(function(z){
    var m = x.lineWidth * 2;
    var rx = z.x * o.width - m, ry = z.y * o.height - m, rw = z.w * o.width + 2 * m, rh = z.h * o.height + 2 * m;
    x.fillRect(rx, ry, rw, rh); x.strokeRect(rx, ry, rw, rh);
  });
  return o.toDataURL('image/jpeg', 0.8);
}

function pixeles(im, esJpeg, calidad){
  var W = im.naturalWidth, H = im.naturalHeight, MAX = 12e6;
  var esc = W * H > MAX ? Math.sqrt(MAX / (W * H)) : 1;
  var c = lienzoDe(im, Math.round(W * esc), Math.round(H * esc));
  var B = Math.max(c.width, c.height) <= 2200 ? 8 : 16;
  var conEla = esJpeg && esc === 1;   // al reducir la imagen se pierde la rejilla JPEG
  return (conEla ? recomprimir(c, 0.9).catch(function(){ return null; }) : Promise.resolve(null)).then(function(c2){
    var m = medirBloques(c, c2, B);
    var p = [], zonas = [];
    var ruido = zonasRuido(m);
    if (ruido.zonas.length){
      zonas = zonas.concat(unir(ruido.zonas, m, 'ruido'));
      p.push({ nivel: 'aviso', titulo: 'Zonas sin ruido de cámara', detalle: ruido.zonas.length + ' zona(s) perfectamente lisas en medio de una foto con grano: es lo que deja tapar un dato y escribir encima.' });
    }
    if (m.ela){
      var ela = zonasEla(m);
      if (ela.zonas.length){
        zonas = zonas.concat(unir(ela.zonas, m, 'ela'));
        p.push({ nivel: 'aviso', titulo: 'Zonas guardadas de otra manera que el resto', detalle: ela.zonas.length + ' zona(s) con una compresión distinta a la de la foto: suele pasar al pegar o reescribir algo y volver a guardar.' });
      }
    }
    if (!p.length)
      p.push({ nivel: 'bien', titulo: 'Sin zonas retocadas a la vista', detalle: conEla ? 'La compresión y el grano son iguales en toda la foto.' : 'El grano es igual en toda la foto.' });
    return { puntos: p, zonas: zonas, mapa: zonas.length ? mapa(c, zonas) : null };
  });
}

/* ---------- Entrada ---------- */

function leer(file){
  return new Promise(function(ok, mal){
    var fr = new FileReader();
    fr.onload = function(){ ok(new Uint8Array(fr.result)); };
    fr.onerror = function(){ mal(fr.error); };
    fr.readAsArrayBuffer(file);
  });
}

function analizar(file){
  var meta, puntos = [];
  return leer(file).then(function(u8){
    meta = metadatos(u8);
    puntos = senalesMeta(meta);
    var u = URL.createObjectURL(file);
    return cargarImagen(u).then(function(im){
      return pixeles(im, meta.formato === 'JPEG', meta.calidad || 0).then(function(r){ URL.revokeObjectURL(u); return r; });
    });
  }).catch(function(){ return { puntos: [{ nivel: 'aviso', titulo: 'No se pudo analizar si está retocada', detalle: 'El archivo no se deja abrir como una foto normal.' }], zonas: [], mapa: null }; }).then(function(px){
    puntos = puntos.concat(px.puntos);
    var nivel = puntos.some(function(x){ return x.nivel === 'mal'; }) ? 'mal' : puntos.some(function(x){ return x.nivel === 'aviso'; }) ? 'aviso' : 'bien';
    var fuertes = px.zonas.length > 0 || puntos.some(function(x){ return x.nivel === 'mal'; });
    return { nivel: nivel, puntos: puntos, zonas: px.zonas, mapa: px.mapa, meta: meta || {}, retoque: fuertes };
  });
}

window.Edicion = { analizar: analizar, metadatos: metadatos };
})();
