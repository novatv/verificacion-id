// Mejoras sobre la validación de Kinky.nl, gratis y en el propio teléfono:
//  - Camara: todas las fotos con la cámara EN VIVO dentro de la app (nunca galería ni capturas de pantalla).
//    Kinky usa un selector de archivo para las fotos manuales, que en muchos móviles deja elegir de la galería.
//  - VidaLibre: prueba de vida con retos al azar (girar la cabeza a un lado, al otro y parpadear),
//    comprobando que es la misma cara de principio a fin. Sirve cuando no hay licencia de Regula,
//    y se suma a Regula cuando la hay.
//  - Caras: compara la cara del documento con la de la prueba de vida (face-api, código abierto).
//  - Ocr: lee fechas del periódico o ticket (Kinky lo deja a un moderador) y datos del documento.
(function(){
  var MODELOS = 'modelos';
  var listo = null;
  function cargarModelos(){
    if (listo) return listo;
    var f = window.faceapi;
    listo = Promise.all([
      f.nets.tinyFaceDetector.loadFromUri(MODELOS),
      f.nets.faceLandmark68Net.loadFromUri(MODELOS),
      f.nets.faceRecognitionNet.loadFromUri(MODELOS),
    ]);
    return listo;
  }
  var OPC = function(){ return new window.faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.5 }); };

  // ---------- capa de cámara ----------
  function capa(html){
    var c = document.createElement('div');
    c.style.cssText = 'position:fixed;inset:0;z-index:80;background:#000;display:flex;flex-direction:column;color:#fff;font-family:system-ui,sans-serif';
    c.innerHTML = html;
    document.body.appendChild(c);
    return c;
  }
  function pedirCamara(facing){
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return Promise.reject(new Error('Este navegador no deja usar la cámara'));
    return navigator.mediaDevices.getUserMedia({ video: { facingMode: facing, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false });
  }
  function parar(stream){ try { stream.getTracks().forEach(function(t){ t.stop(); }); } catch(e){} }
  function fotograma(video, max){
    var w = video.videoWidth, h = video.videoHeight, k = max ? Math.min(1, max / Math.max(w, h)) : 1;
    var c = document.createElement('canvas'); c.width = Math.round(w * k); c.height = Math.round(h * k);
    c.getContext('2d').drawImage(video, 0, 0, c.width, c.height);
    return c;
  }

  // Detecta un vídeo de cámara virtual o una pantalla: etiqueta del dispositivo sospechosa
  function camaraSospechosa(stream){
    var t = stream.getVideoTracks()[0], l = (t && t.label || '').toLowerCase();
    return /virtual|obs|manycam|snap camera|xsplit|droidcam|epoccam|splitcam|vcam|fake/.test(l) ? l : '';
  }

  var Camara = {
    // Foto con la cámara en vivo. marco: 'cara' | 'documento' | 'cuerpo'
    foto: function(opts){
      var facing = opts.facing || 'environment';
      return pedirCamara(facing).then(function(stream){
        return new Promise(function(resolve, reject){
          var ratio = opts.marco === 'pasaporte' ? 1.42 : 1.586; // página de pasaporte (TD3) o tarjeta (TD1)
          var marco = (opts.marco === 'documento' || opts.marco === 'pasaporte')
            ? '<div style="position:absolute;left:6%;right:6%;top:28%;aspect-ratio:' + ratio + ';border:3px solid #3b6cff;border-radius:14px;box-shadow:0 0 0 9999px rgba(0,0,0,.35)"></div>'
            : '';
          var c = capa(
            '<div style="padding:14px 16px;font-weight:700;font-size:17px">' + opts.titulo + '</div>' +
            '<div style="position:relative;flex:1;overflow:hidden"><video playsinline autoplay muted style="width:100%;height:100%;object-fit:cover' + (facing === 'user' ? ';transform:scaleX(-1)' : '') + '"></video>' + marco + '</div>' +
            '<div style="padding:10px 16px;color:#cbd2e1;font-size:14px;min-height:40px">' + (opts.ayuda || '') + '</div>' +
            '<div style="display:flex;gap:10px;padding:0 16px 22px"><button data-x style="flex:1;padding:14px;border:0;border-radius:12px;background:#2a3350;color:#fff;font-size:16px">Cancelar</button>' +
            '<button data-ok style="flex:2;padding:14px;border:0;border-radius:12px;background:#3b6cff;color:#fff;font-size:16px;font-weight:700">📷 Hacer la foto</button></div>');
          var video = c.querySelector('video'); video.srcObject = stream;
          var sospecha = camaraSospechosa(stream);
          c.querySelector('[data-x]').onclick = function(){ parar(stream); c.remove(); reject(new Error('cancelado')); };
          c.querySelector('[data-ok]').onclick = function(){
            if (!video.videoWidth) return;
            var lienzo = fotograma(video, 1600);
            parar(stream); c.remove();
            resolve({ dataUrl: lienzo.toDataURL('image/jpeg', 0.9), lienzo: lienzo, enVivo: true, camaraSospechosa: sospecha, hora: new Date() });
          };
        });
      });
    },
  };

  // ---------- prueba de vida gratuita ----------
  function punto(l, i){ return l.positions[i]; }
  function dist(a, b){ return Math.hypot(a.x - b.x, a.y - b.y); }
  function giro(l){ // <0 un lado, >0 el otro (independiente de espejo)
    var ojoI = punto(l, 36), ojoD = punto(l, 45), nariz = punto(l, 30);
    var mx = (ojoI.x + ojoD.x) / 2, ancho = dist(ojoI, ojoD) || 1;
    return (nariz.x - mx) / ancho;
  }
  function apertura(l){ // EAR medio de los dos ojos
    function ear(a){ var p = a.map(function(i){ return punto(l, i); });
      return (dist(p[1], p[5]) + dist(p[2], p[4])) / (2 * dist(p[0], p[3]) || 1); }
    return (ear([36,37,38,39,40,41]) + ear([42,43,44,45,46,47])) / 2;
  }
  function barajar(a){ for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t; } return a; }

  var VidaLibre = {
    prueba: function(){
      return cargarModelos().then(function(){ return pedirCamara('user'); }).then(function(stream){
        return new Promise(function(resolve){
          var c = capa(
            '<div style="padding:14px 16px;font-weight:700;font-size:17px">Prueba de vida</div>' +
            '<div style="position:relative;flex:1;overflow:hidden"><video playsinline autoplay muted style="width:100%;height:100%;object-fit:cover;transform:scaleX(-1)"></video>' +
            '<div style="position:absolute;left:50%;top:45%;width:62%;aspect-ratio:.78;transform:translate(-50%,-50%);border:4px solid #fff;border-radius:50%;box-shadow:0 0 0 9999px rgba(0,0,0,.45)" data-aro></div></div>' +
            '<div data-msg style="padding:16px;font-size:20px;font-weight:700;text-align:center;min-height:64px">Mira a la cámara</div>' +
            '<div style="padding:0 16px 22px"><button data-x style="width:100%;padding:14px;border:0;border-radius:12px;background:#2a3350;color:#fff;font-size:16px">Cancelar</button></div>');
          var video = c.querySelector('video'), msg = c.querySelector('[data-msg]'), aro = c.querySelector('[data-aro]');
          video.srcObject = stream;
          var sospecha = camaraSospechosa(stream);
          var retos = barajar(['lado1', 'parpadeo']).concat([]); // girar a un lado, al otro y parpadear, en orden al azar
          retos.splice(retos.indexOf('lado1') + 1, 0, 'lado2');
          var TEXTO = { lado1: 'Gira la cabeza despacio hacia un lado', lado2: 'Ahora gira hacia el otro lado', parpadeo: 'Parpadea dos veces' };
          var i = 0, signo = 0, abierto = false, parpadeos = 0, inicio = null, finCara = null, frontal = null;
          var empezado = Date.now(), LIMITE = 45000, fin = false;
          function terminar(ok, motivo){
            if (fin) return; fin = true;
            parar(stream); c.remove();
            var d = (inicio && finCara) ? window.faceapi.euclideanDistance(inicio, finCara) : null;
            if (ok && d !== null && d > 0.5) { ok = false; motivo = 'La cara cambió durante la prueba'; }
            resolve({ ok: ok, motivo: motivo, descriptor: frontal && frontal.d, foto: frontal && frontal.foto,
              retos: retos.length, camaraSospechosa: sospecha, mismaCara: d });
          }
          c.querySelector('[data-x]').onclick = function(){ terminar(false, 'Cancelado'); };
          function paso(){
            if (fin) return;
            if (Date.now() - empezado > LIMITE) return terminar(false, 'Se acabó el tiempo');
            if (!video.videoWidth) return requestAnimationFrame(paso);
            window.faceapi.detectAllFaces(video, OPC()).withFaceLandmarks().withFaceDescriptors().then(function(caras){
              if (fin) return;
              if (caras.length !== 1) { aro.style.borderColor = '#ff4d6d'; msg.textContent = caras.length ? 'Solo una persona delante' : 'Pon tu cara dentro del óvalo'; return setTimeout(paso, 120); }
              aro.style.borderColor = '#22c55e';
              var cara = caras[0], g = giro(cara.landmarks), e = apertura(cara.landmarks);
              if (!inicio && Math.abs(g) < 0.12) { inicio = cara.descriptor; frontal = { d: cara.descriptor, foto: fotograma(video, 800).toDataURL('image/jpeg', 0.9) }; }
              if (!inicio) { msg.textContent = 'Mira de frente a la cámara'; return setTimeout(paso, 120); }
              var r = retos[i];
              msg.textContent = TEXTO[r];
              if (r === 'lado1' && Math.abs(g) > 0.28) { signo = Math.sign(g); i++; }
              else if (r === 'lado2' && g * signo < -0.28) { i++; }
              else if (r === 'parpadeo') {
                if (e > 0.26) { if (!abierto) abierto = true; }
                else if (e < 0.19 && abierto) { abierto = false; parpadeos++; if (parpadeos >= 2) i++; }
              }
              if (i >= retos.length) {
                if (Math.abs(g) < 0.12) { finCara = cara.descriptor; frontal = { d: cara.descriptor, foto: fotograma(video, 800).toDataURL('image/jpeg', 0.9) }; return terminar(true, ''); }
                msg.textContent = 'Vuelve a mirar de frente';
              }
              setTimeout(paso, 90);
            }).catch(function(){ setTimeout(paso, 200); });
          }
          video.onloadeddata = function(){ requestAnimationFrame(paso); };
        });
      });
    },
  };

  // ---------- comparar caras ----------
  var Caras = {
    descriptorDe: function(dataUrl){
      return cargarModelos().then(function(){
        return new Promise(function(res){ var im = new Image(); im.onload = function(){ res(im); }; im.src = dataUrl; });
      }).then(function(im){
        return window.faceapi.detectAllFaces(im, new window.faceapi.TinyFaceDetectorOptions({ inputSize: 608, scoreThreshold: 0.35 }))
          .withFaceLandmarks().withFaceDescriptors();
      }).then(function(caras){
        if (!caras.length) return null;
        caras.sort(function(a, b){ return b.detection.box.area - a.detection.box.area; });
        return caras[0].descriptor;
      });
    },
    // distancia euclídea → parecido 0-1 (misma persona por debajo de 0,5 de distancia)
    parecido: function(a, b){ if (!a || !b) return null; var d = window.faceapi.euclideanDistance(a, b); return { distancia: d, pct: Math.max(0, Math.round((1 - d) * 100)), misma: d < 0.5 }; },
  };

  // ---------- OCR ----------
  var tess = null;
  function cargarTesseract(){
    if (window.Tesseract) return Promise.resolve();
    if (tess) return tess;
    tess = new Promise(function(res, rej){ var s = document.createElement('script'); s.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js'; s.onload = res; s.onerror = function(){ rej(new Error('Sin conexión para leer el texto')); }; document.head.appendChild(s); });
    return tess;
  }
  var MESES = { jan:1, januari:1, january:1, enero:1, janvier:1, januar:1, feb:2, februari:2, february:2, febrero:2, fevrier:2, februar:2,
    mrt:3, maart:3, mar:3, march:3, marzo:3, mars:3, maerz:3, apr:4, april:4, abril:4, avril:4, mei:5, may:5, mayo:5, mai:5,
    jun:6, juni:6, june:6, junio:6, juin:6, jul:7, juli:7, july:7, julio:7, juillet:7, aug:8, augustus:8, august:8, agosto:8, aout:8,
    sep:9, sept:9, september:9, septiembre:9, septembre:9, okt:10, oct:10, oktober:10, october:10, octubre:10, octobre:10,
    nov:11, november:11, noviembre:11, novembre:11, dec:12, december:12, diciembre:12, decembre:12, dez:12, dezember:12 };
  function fechasEn(texto){
    var t = texto.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''), out = [], m;
    var re1 = /(\d{1,2})[\s./-]+(\d{1,2})[\s./-]+(\d{2,4})/g;
    while ((m = re1.exec(t))) { var a = +m[3]; if (a < 100) a += 2000; out.push(new Date(a, +m[2] - 1, +m[1])); }
    var re2 = /(\d{1,2})\s+([a-z]{3,10})\.?\s+(\d{4})/g;
    while ((m = re2.exec(t))) { var mes = MESES[m[2]]; if (mes) out.push(new Date(+m[3], mes - 1, +m[1])); }
    return out.filter(function(f){ return !isNaN(f) && f.getFullYear() > 1900 && f.getFullYear() < 2100; });
  }
  var Ocr = {
    texto: function(dataUrl, idiomas){
      return cargarTesseract().then(function(){ return window.Tesseract.recognize(dataUrl, idiomas || 'eng'); })
        .then(function(r){ return r.data.text || ''; });
    },
    fechasEn: fechasEn,
    // Fecha del periódico o ticket: la más reciente que no sea del futuro; ok si tiene 7 días o menos
    fechaReciente: function(dataUrl){
      return Ocr.texto(dataUrl, 'nld+eng').then(function(t){
        var hoy = new Date(); hoy.setHours(23, 59, 59);
        var fs = fechasEn(t).filter(function(f){ return f <= hoy; }).sort(function(a, b){ return b - a; });
        if (!fs.length) return { leida: false };
        var dias = Math.floor((hoy - fs[0]) / 864e5);
        return { leida: true, fecha: fs[0], dias: dias, ok: dias <= 7 };
      });
    },
  };

  window.Camara = Camara; window.VidaLibre = VidaLibre; window.Caras = Caras; window.Ocr = Ocr;
})();
