// Control de identidad completo, en el orden de Kinky: selfie con documento y código, cuerpo entero,
// prueba de vida, documento y (fuera de UE/EEE/Suiza) permiso. Al final se cruza todo:
// la cara del documento con la persona en vivo, el selfie y la foto de cuerpo entero.
// Con el servidor de Regula (pasarela) la prueba de vida y la comparación de caras las hace Regula;
// sin él, se hacen en el propio teléfono (face-api).
// Usa de index.html: E, SERVIDOR, EDAD_MINIMA, pintar, svg, esc, $, documento, validacion, pintarVeredicto.
(function(){
  var SIMILITUD_MINIMA = 0.75;   // como Kinky: cara del documento ↔ persona en vivo
  var I = null;                  // capturas de la verificación en curso (solo en memoria)
  var cargados = {};
  function cargar(src){
    if (!cargados[src]) cargados[src] = new Promise(function(res, rej){
      var s = document.createElement('script'); s.src = src; s.onload = res;
      s.onerror = function(){ delete cargados[src]; rej(new Error('No se pudo cargar ' + src)); };
      document.head.appendChild(s);
    });
    return cargados[src];
  }
  function b64(dataUrl){ return dataUrl ? String(dataUrl).replace(/^data:[^,]*,/, '') : ''; }
  function limite(p, ms, valor){ return Promise.race([p, new Promise(function(r){ setTimeout(function(){ r(valor); }, ms); })]); }

  // ¿Hay servidor de caras de Regula detrás de la pasarela?
  function servidorCaras(){
    if (!window.SERVIDOR) return Promise.resolve('');
    return limite(fetch(SERVIDOR + '/face/api/ping').then(function(r){ return r.ok ? r.json() : null; })
      .then(function(j){ return j && j.code === 0 ? SERVIDOR + '/face' : ''; }).catch(function(){ return ''; }), 6000, '');
  }

  function paso(n, total, titulo, texto, boton, alPulsar, extra){
    pintar('<button class="back" onclick="Identidad.cancelar()">' + svg('arrow') + 'Empezar de nuevo</button>' +
      '<div class="panel"><p class="lede tight" style="margin:0 0 6px">Paso ' + n + ' de ' + total + '</p><h2>' + titulo + '</h2>' +
      '<p class="lede">' + texto + '</p>' + (extra || '') +
      '<button class="btn btn-gold" id="pasoBtn">' + svg('camera') + boton + '</button></div>');
    $('pasoBtn').onclick = alPulsar;
  }
  function fallo(titulo, msg, reintentar){
    pintar('<div class="panel"><h2 style="color:var(--bad)">' + esc(titulo) + '</h2><p class="lede">' + esc(msg) + '</p>' +
      '<button class="btn btn-gold" id="reint">Volver a intentarlo</button>' +
      '<button class="btn btn-plain" onclick="Identidad.cancelar()">Empezar de nuevo</button></div>');
    $('reint').onclick = reintentar;
  }
  function total(){ return I.permiso ? 5 : 4; }
  function alCancelar(reintentar){ return function(e){ if (e && e.message === 'cancelado') return reintentar(); fallo('No se pudo usar la cámara', (e && e.message) || String(e), reintentar); }; }

  // 1 — Selfie con el documento y un código escrito a mano
  function pSelfie(){
    paso(1, total(), 'Selfie con tu documento y el código',
      'Escribe este código en un papel. Después hazte una foto en la que se vean <b>tu cara</b>, <b>tu documento</b> y <b>el papel</b>.',
      'Hacer el selfie', function(){
        Camara.foto({ facing: 'user', girar: true, titulo: 'Selfie con documento y código ' + I.codigo,
          ayuda: 'Cara, documento y papel con el código ' + I.codigo + ', todo dentro de la foto.' })
          .then(function(f){ I.selfie = f; pCuerpo(); }).catch(alCancelar(pSelfie));
      },
      '<div style="text-align:center;font-size:44px;font-weight:800;letter-spacing:.18em;margin:6px 0 18px">' + I.codigo + '</div>');
  }

  // 2 — Cuerpo entero
  function pCuerpo(){
    paso(2, total(), 'Foto de cuerpo entero',
      'De pie, de la cabeza a los pies y con la cara visible. Apoya el teléfono o pide a alguien que te haga la foto.',
      'Hacer la foto', function(){
        Camara.foto({ facing: 'environment', girar: true, titulo: 'Cuerpo entero', ayuda: 'De la cabeza a los pies, con la cara visible.' })
          .then(function(f){ I.cuerpo = f; pVida(); }).catch(alCancelar(pCuerpo));
      });
  }

  // 3 — Prueba de vida
  function pVida(){
    paso(3, total(), 'Prueba de vida',
      'La cámara comprueba que hay una persona real delante: no vale una foto, una pantalla ni una máscara. Sigue las indicaciones.',
      'Empezar', function(){
        $('pasoBtn').disabled = true; $('pasoBtn').textContent = 'Preparando…';
        servidorCaras().then(function(url){ I.caras = url; return url ? vidaRegula(url) : vidaTelefono(); });
      });
  }
  function vidaTelefono(){
    return cargar('face-api.js').then(function(){ return VidaLibre.prueba(); }).then(function(r){
      if (!r.ok) return fallo('Prueba de vida no superada', r.motivo || 'No se ha podido confirmar.', pVida);
      I.vida = { ok: true, regula: false, foto: r.foto, descriptor: r.descriptor, sospecha: r.camaraSospechosa };
      pDocumento();
    }).catch(alCancelar(pVida));
  }
  function vidaRegula(url){
    return cargar('regula-face.js').then(function(){
      var capa = $('capaRegula');
      capa.innerHTML = '<face-liveness style="display:block;width:100%;height:100%"></face-liveness>';
      capa.classList.remove('oculto');
      var el = capa.querySelector('face-liveness'), hecho = false;
      function cerrar(){ capa.classList.add('oculto'); capa.innerHTML = ''; }
      el.settings = { locale: 'es', copyright: false, startScreen: false, closeDisabled: false, url: url,
        recordingProcess: 1, retryCount: 16, tag: 'verif-' + Date.now() };
      el.addEventListener('face-liveness', function(ev){
        var d = ev.detail; if (!d || hecho) return;
        var r = d.data && d.data.response;
        if (d.action === 'PROCESS_FINISHED') {
          hecho = true; cerrar();
          if (!r || d.data.status !== 1) return vidaTelefono();           // el servidor falló: se hace en el teléfono
          if (r.status !== 0) return fallo('Prueba de vida no superada', 'Regula no ha confirmado que haya una persona real delante.', pVida);
          var img = r.images && r.images[0];
          I.vida = { ok: true, regula: true, foto: img ? 'data:image/jpeg;base64,' + img : '' };
          pDocumento();
        } else if (d.action === 'CLOSE' || d.action === 'SERVICE_INITIALIZATION_FAILED' || d.action === 'CONNECTION_ERROR') {
          hecho = true; cerrar();
          if (d.action === 'CLOSE') return pVida();
          vidaTelefono();
        }
      });
    }).catch(function(){ return vidaTelefono(); });
  }

  // 4 — Documento: lo lee index.html y vuelve aquí por Identidad.conDocumento
  function pDocumento(){ documento(); }

  // 5 — Permiso de residencia o de trabajo (solo fuera de UE/EEE/Suiza): una sola foto, la parte delantera. No se lee solo: queda para revisión.
  function pPermiso(){
    paso(5, total(), 'Permiso de residencia o de trabajo',
      'Tu nacionalidad está fuera del Espacio Económico Europeo. Haz la foto de la parte <b>delantera</b> del permiso.',
      'Hacer la foto', function(){
        Camara.foto({ marco: 'documento', titulo: 'Permiso de residencia o de trabajo', ayuda: 'Que se vea entero dentro del marco.' })
          .then(function(f){ I.permiso1 = f; analizar(); }).catch(alCancelar(pPermiso));
      });
  }

  // ---------- comparación de caras ----------
  function parecidoRegula(a, tipoA, b, tipoB){
    if (!I.caras || !a || !b) return Promise.resolve(null);
    return limite(fetch(I.caras + '/api/match', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ images: [{ index: 0, type: tipoA, data: b64(a) }, { index: 1, type: tipoB, data: b64(b) }] }) })
      .then(function(r){ return r.json(); }).then(function(j){
        if (j.code === 2) return { sinCara: true };
        var mejor = null;
        (j.results || []).forEach(function(x){ if (typeof x.similarity === 'number' && (mejor === null || x.similarity > mejor)) mejor = x.similarity; });
        return mejor === null ? null : { pct: Math.round(mejor * 100), misma: mejor >= SIMILITUD_MINIMA, regula: true };
      }).catch(function(){ return null; }), 30000, null);
  }
  function descriptor(img){
    if (!img) return Promise.resolve(null);
    return cargar('face-api.js').then(function(){ return Caras.descriptorDe(img); }).catch(function(){ return null; });
  }
  function parecidoTelefono(a, b){
    return Promise.all([a && a.length === 128 ? a : descriptor(a), descriptor(b)]).then(function(d){
      if (!d[0] || !d[1]) return { sinCara: true };
      var p = Caras.parecido(d[0], d[1]);
      return { pct: p.pct, misma: p.misma, regula: false };
    });
  }
  function parecido(a, tipoA, b, tipoB, descA){
    if (!a || !b) return Promise.resolve(null);
    return parecidoRegula(a, tipoA, b, tipoB).then(function(r){ return r || parecidoTelefono(descA || a, b); });
  }
  function leerCodigo(){
    if (!window.Ocr) return Promise.resolve(null);
    return limite(Ocr.texto(I.selfie.dataUrl, 'eng').then(function(t){
      return t.replace(/[^0-9]/g, '').indexOf(I.codigo) >= 0;
    }).catch(function(){ return null; }), 25000, null);
  }

  function analizar(){
    pintar('<div class="panel"><h2>Comprobando tu identidad…</h2><p class="lede tight">Comparamos la cara del documento con la prueba de vida, el selfie y la foto de cuerpo entero.</p></div>');
    var base = I.doc, vivo = I.vida.foto, retrato = base.retrato ? 'data:image/jpeg;base64,' + base.retrato : base.fotoDoc;
    Promise.all([
      parecido(retrato, 1, vivo, 3),                          // documento ↔ persona en vivo
      parecido(vivo, 3, I.selfie.dataUrl, 3, I.vida.descriptor), // persona en vivo ↔ selfie
      parecido(vivo, 3, I.cuerpo.dataUrl, 3, I.vida.descriptor), // persona en vivo ↔ cuerpo entero
      leerCodigo(),
    ]).then(function(r){
      var checks = base.checks.slice(), quien = function(x){ return x && x.regula ? ' (Regula)' : ''; };
      function add(nivel, t, d){ checks.push({ nivel: nivel, t: t, d: d }); }
      add('ok', 'Prueba de vida', I.vida.regula ? 'Persona real confirmada por Regula' : 'Superada en el teléfono: giros de cabeza y parpadeo');
      var doc = r[0];
      if (!retrato) add('warn', 'Cara del documento', 'Esta lectura no trae la foto del documento; no se pudo comparar');
      else if (!doc || doc.sinCara) add('warn', 'Cara del documento', 'No se distingue la cara en la foto del documento');
      else add(doc.misma ? 'ok' : 'bad', 'El documento es tuyo', doc.pct + ' % de parecido con la prueba de vida' + quien(doc));
      var s = r[1];
      if (!s || s.sinCara) add('bad', 'Selfie con el documento', 'No se ve tu cara en el selfie');
      else add(s.misma ? 'ok' : 'bad', 'Selfie con el documento', s.misma ? 'Eres la misma persona (' + s.pct + ' %)' + quien(s) : 'La cara del selfie no coincide (' + s.pct + ' %)');
      add(r[3] ? 'ok' : 'warn', 'Código escrito en el papel', r[3] ? 'Leído: ' + I.codigo : 'No se pudo leer solo el ' + I.codigo + '; hay que mirarlo a ojo');
      var c = r[2];
      if (!c || c.sinCara) add('warn', 'Foto de cuerpo entero', 'No se distingue la cara para compararla');
      else add(c.misma ? 'ok' : 'bad', 'Foto de cuerpo entero', c.misma ? 'Eres la misma persona (' + c.pct + ' %)' + quien(c) : 'La cara no coincide (' + c.pct + ' %)');
      if (I.permiso) add('warn', 'Permiso de residencia o de trabajo', 'Fotografiado por delante; lo tiene que revisar una persona');
      if ((I.selfie.camaraSospechosa || I.cuerpo.camaraSospechosa || I.vida.sospecha)) add('bad', 'Cámara real', 'Se ha detectado una cámara virtual');
      var hecho = I; I = null;   // las fotos dejan de estar en memoria en cuanto hay veredicto
      pintarVeredicto(base.datos, checks, base.nota, '', { identidad: true, carasRegula: !!hecho.caras });
    }).catch(function(e){ fallo('No se pudo terminar la comprobación', (e && e.message) || String(e), analizar); });
  }

  window.Identidad = {
    enCurso: function(){ return !!I; },
    empezar: function(){
      var a = new Uint32Array(1); (window.crypto || window.msCrypto).getRandomValues(a);
      I = { codigo: String(1000 + a[0] % 9000), permiso: !EEE[E.nacionalidad] };
      pSelfie();
    },
    // index.html llama aquí cuando el documento se ha leído y es válido
    conDocumento: function(doc){ I.doc = doc; if (I.permiso) pPermiso(); else analizar(); },
    olvidar: function(){ I = null; },
    cancelar: function(){ I = null; validacion(); },
  };
})();
