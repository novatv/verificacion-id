// Lectura de la cara DELANTERA del DNI en el propio teléfono (Tesseract), sin servidor.
// Regula en el navegador solo lee las líneas «<<<», que en el DNI están detrás; Kinky lee la
// delantera porque tiene el servidor de Regula. Esto es el equivalente gratuito: número con su
// letra de control, fecha de nacimiento, validez y país. No comprueba la autenticidad del soporte.
// Misma lógica que el lector de manual.html (buscarDatosAnverso), reducida a lo que usa la validación.
(function(){
  var worker = null, cola = Promise.resolve();
  function cargar(){
    if (window.Tesseract) return Promise.resolve();
    return new Promise(function(ok, ko){
      var s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
      s.onload = ok;
      s.onerror = function(){ ko(new Error('No se pudo cargar el lector. Necesita internet la primera vez.')); };
      document.head.appendChild(s);
    });
  }
  function obtener(){
    if (worker) return worker;
    worker = cargar().then(function(){ return window.Tesseract.createWorker('spa'); });
    worker.catch(function(){ worker = null; });
    return worker;
  }

  var LETRAS = 'TRWAGMYFPDXBNJZSQVHLCKE';
  function validar(s){
    s = String(s).toUpperCase().replace(/[^A-Z0-9]/g, '');
    var dni = /^\d{8}[A-Z]$/.test(s), nie = /^[XYZ]\d{7}[A-Z]$/.test(s);
    if (!dni && !nie) return { numero: s, tipo: null, valido: false };
    var num = dni ? s.slice(0, 8) : ({ X: '0', Y: '1', Z: '2' })[s[0]] + s.slice(1, 8);
    var esperada = LETRAS[parseInt(num, 10) % 23];
    return { numero: s, tipo: dni ? 'DNI' : 'NIE', valido: s.slice(-1) === esperada, letraEsperada: esperada };
  }

  // Cada documento lleva escrito su país (códigos de tres letras, como en paises.js)
  var PAIS_TEXTO = [
    ['ESP', /ESPA[NÑ]A|DOCUMENTO NACIONAL DE IDENTIDAD|NACIONAL D.IDENTITAT/], ['ITA', /REPUBBLICA ITALIANA|CARTA DI IDENTIT/],
    ['FRA', /R[EÉ]PUBLIQUE FRAN|CARTE NATIONALE D/], ['DEU', /BUNDESREPUBLIK|PERSONALAUSWEIS/], ['NLD', /NEDERLAND|IDENTITEITSKAART/],
    ['BEL', /BELGI[EQ]|BELGIUM|BELGIEN/], ['PRT', /PORTUGUESA|CART[AÃ]O DE CIDAD/], ['POL', /RZECZPOSPOLITA|DOW[OÓ]D OSOBISTY/],
    ['ROU', /ROM[AÂ]NIA|CARTE DE IDENTITATE/], ['CHE', /SCHWEIZ|SUISSE|SVIZZERA|HELVETIC/], ['AUT', /[OÖ]STERREICH/],
    ['IRL', /[EÉ]IREANN|IRELAND/], ['LUX', /LUXEMBOURG|LETZEBUERG/], ['SWE', /SVERIGE/], ['FIN', /SUOMI|FINLAND/],
    ['NOR', /NORGE/], ['DNK', /DANMARK/], ['HRV', /HRVATSKA/], ['SVN', /SLOVENIJA/], ['HUN', /MAGYARORSZ/],
    ['BGR', /БЪЛГАРИЯ|BULGARIA/], ['EST', /EESTI/], ['LTU', /LIETUVOS/], ['LVA', /LATVIJAS/], ['MLT', /MALTA/]
  ];
  function paisPorTexto(t){
    for (var i = 0; i < PAIS_TEXTO.length; i++) if (PAIS_TEXTO[i][1].test(t)) return PAIS_TEXTO[i][0];
    return null;
  }

  var RE_FECHA = '(?:^|\\D)(\\d{2})[ \\t.\\-\\/]{0,2}(\\d{2})[ \\t.\\-\\/]{0,2}(\\d{4})(?!\\d)';
  function fechaValida(d, m, a){ return d >= 1 && d <= 31 && m >= 1 && m <= 12 && a >= 1900 && a <= 2100; }

  function buscar(texto){
    var t = texto.toUpperCase().replace(/[|]/g, 'I');
    // Errores típicos del OCR en los dígitos
    var tn = t.replace(/(\d)[O](?=\d)/g, '$10').replace(/(\d)[IL](?=\d)/g, '$11');
    var pais = paisPorTexto(t), doc = null, m;
    var buscarEsp = !pais || pais === 'ESP';
    // El OCR a veces confunde la letra final con un número (Z→7/2, S→5, B→8, G→6...)
    var parecidas = { '7': 'ZT', '2': 'Z', '5': 'S', '8': 'B', '6': 'G', '0': 'DQ', '1': 'LT', '4': 'AW', '3': 'B', '9': 'PG' };
    function letraDe(num, c){
      if (/[A-Z]/.test(c)) return c;
      var esperada = LETRAS[parseInt(num, 10) % 23];
      return (parecidas[c] || '').indexOf(esperada) >= 0 ? esperada : c;
    }
    if (buscarEsp){
      // número y letra en la misma línea; también sin los espacios que el OCR mete dentro del número
      var reD = /(?:^|\D)(\d{8})[ \t]?-?[ \t]?([A-Z0-9])(?![A-Z0-9])/g;
      var tnD = tn + '\n' + tn.replace(/\b\d{2}[ \t]\d{2}[ \t]\d{4}\b/g, ' ').replace(/(\d) (?=\d)/g, '$1');
      while ((m = reD.exec(tnD))){
        var r = validar(m[1] + letraDe(m[1], m[2]));
        if (r.tipo && (!doc || r.valido)) doc = r;
        if (r.valido) break;
      }
      if (!doc || !doc.valido){
        var aCifra = { O: '0', D: '0', Q: '0', I: '1', L: '1', T: '1', Z: '2', S: '5', B: '8', G: '6' };
        var reDs = /(?:^|[^A-Z0-9])([0-9ODQILTZSBG]{8})[ \t]?-?[ \t]?([A-Z0-9])(?![A-Z0-9])/g;
        while ((m = reDs.exec(t))){
          if ((m[1].match(/\d/g) || []).length < 6) continue;
          var num = m[1].replace(/[A-Z]/g, function(c){ return aCifra[c]; });
          var rs = validar(num + letraDe(num, m[2]));
          if (rs.valido){ doc = rs; break; }
        }
      }
      if (!doc || !doc.valido){
        var reN = /([XYZ])[ \t]?(\d{7})[ \t]?-?[ \t]?([A-Z0-9])(?![A-Z0-9])/g;
        while ((m = reN.exec(tn))){
          var rn = validar(m[1] + m[2] + letraDe(({ X: '0', Y: '1', Z: '2' })[m[1]] + m[2], m[3]));
          if (rn.tipo && (!doc || rn.valido)) doc = rn;
          if (rn.valido) break;
        }
      }
    }

    var fechas = [], reF = new RegExp(RE_FECHA, 'g');
    while ((m = reF.exec(tn))){
      // 8 cifras pegadas seguidas de letra en la misma línea = número de DNI, no una fecha
      if (/^\D?\d{8}$/.test(m[0]) && /^[ \t]?-?[ \t]?[A-Z]\b/.test(tn.slice(reF.lastIndex))) continue;
      if (fechaValida(+m[1], +m[2], +m[3])){
        var f = new Date(+m[3], +m[2] - 1, +m[1]);
        if (!fechas.some(function(x){ return +x === +f; })) fechas.push(f);
      }
    }
    fechas.sort(function(a, b){ return a - b; });
    var hoy = new Date(), nac = null, cad = null, emision = [];
    // Cada fecha va bajo su etiqueta; con varias etiquetas en una línea, las fechas siguen el mismo orden.
    var ETQ = [
      ['nac', /NACIMIENTO|NAIXEMENT|JAIOTZE|NACEMENTO|NACIM|NASCIMENTO|BIRTH|NAISSANCE|NASCITA|GEBURT|GEBOORTE|URODZENIA/g],
      ['emi', /EMISI[OÓ]N?|EMISSI|EXPEDICI|IGORPEN|ISSUE|D[EÉ]LIVR|RILASCIO|AUSSTELL|AFGIFTE|WYDANIA/g],
      ['val', /VALIDEZ|VALIDESA|V[AÁ]LIDO HASTA|CADUCIDAD|BALIOZ|VALIDADE|EXPIR|SCADENZA|G[UÜ]LTIG|GELDIG|VALABLE|WA[ZŻ]NO/g]
    ];
    var lineas = tn.split('\n');
    function fechasDe(linea){
      var out = [], mm, re = new RegExp(RE_FECHA, 'g');
      while ((mm = re.exec(linea))) if (fechaValida(+mm[1], +mm[2], +mm[3])) out.push(new Date(+mm[3], +mm[2] - 1, +mm[1]));
      return out;
    }
    lineas.forEach(function(l, i){
      var etqs = [];
      ETQ.forEach(function(e){ var mm; e[1].lastIndex = 0; while ((mm = e[1].exec(l))) etqs.push({ k: e[0], pos: mm.index }); });
      if (!etqs.length) return;
      etqs.sort(function(a, b){ return a.pos - b.pos; });
      etqs = etqs.filter(function(e, k){ return k === 0 || e.k !== etqs[k - 1].k; });
      var fs = fechasDe(l.slice(etqs[0].pos));
      for (var j = 1; j <= 2 && fs.length < etqs.length && lineas[i + j] !== undefined; j++) fs = fs.concat(fechasDe(lineas[i + j]));
      if (fs.length !== etqs.length) return;  // sin correspondencia clara, no se adivina
      etqs.forEach(function(e, k){
        if (e.k === 'nac' && !nac && fs[k] < hoy) nac = fs[k];
        if (e.k === 'val' && !cad) cad = fs[k];
        if (e.k === 'emi') emision.push(+fs[k]);
      });
    });
    var permanente = /PERMANENTE/.test(tn);
    // Una fecha de los últimos 10 años es la de expedición, no la de nacimiento:
    // si el nacimiento no se lee, mejor no dar edad que dar una edad falsa.
    var hace10 = new Date(hoy.getFullYear() - 10, hoy.getMonth(), hoy.getDate());
    var etqNac = !!nac, etqCad = !!cad;
    fechas.forEach(function(f){
      if (emision.indexOf(+f) >= 0) return;
      if (!etqNac && f < hace10 && (!nac || f < nac)) nac = f;
      if (!etqCad && f > hoy && (!cad || f > cad)) cad = f;
    });
    if (permanente && !etqCad) cad = null;
    return { doc: doc, nac: nac, cad: cad, permanente: permanente && !cad, pais: pais };
  }

  // lienzo: la foto. progreso(texto): aviso opcional mientras lee.
  function leer(lienzo, progreso){
    var o = document.createElement('canvas');  // un solo lienzo para todas las pasadas (memoria en iPhone)
    function preparar(giro, sinFiltro){
      var k = Math.min(2, 2400 / Math.max(lienzo.width, lienzo.height));
      var w = Math.round(lienzo.width * k), h = Math.round(lienzo.height * k), lado = giro % 180 !== 0;
      o.width = lado ? h : w; o.height = lado ? w : h;
      var ox = o.getContext('2d'); ox.setTransform(1, 0, 0, 1, 0, 0);
      ox.filter = sinFiltro ? 'none' : 'grayscale(1) contrast(1.4)';
      ox.translate(o.width / 2, o.height / 2); ox.rotate(giro * Math.PI / 180);
      ox.drawImage(lienzo, 0, 0, lienzo.width, lienzo.height, -w / 2, -h / 2, w, h);
      return o;
    }
    function completo(d){ return d.doc && d.doc.valido && d.nac && (d.cad || d.permanente); }
    cola = cola.catch(function(){}).then(obtener).then(function(wk){
      var textos = '', mejor = null, mejorGiro = 0, mejorConf = -1, n = 0;
      function pasada(giro, sinFiltro){
        n++;
        if (progreso) progreso(n === 1 ? 'Leyendo el número y las fechas…' : 'Leyendo otra vez la foto (' + n + ')…');
        return wk.recognize(preparar(giro, sinFiltro)).then(function(res){
          textos += '\n' + (res.data.text || '');
          if (res.data.confidence > mejorConf){ mejorConf = res.data.confidence; mejorGiro = giro; }
          mejor = buscar(textos);
          return completo(mejor);
        });
      }
      // la foto entera en los 4 giros, en gris; si falta algo, en color en el giro que mejor se leyó
      var pasos = [0, 90, 270, 180].map(function(g){ return function(){ return pasada(g, false); }; });
      pasos.push(function(){ return pasada(mejorGiro, true); });
      function siguiente(i){
        if (i >= pasos.length) return mejor;
        return pasos[i]().then(function(ok){ return ok ? mejor : siguiente(i + 1); });
      }
      return siguiente(0).then(function(d){ o.width = o.height = 0; d.texto = textos; return d; });
    });
    return cola;
  }

  window.Anverso = { leer: leer, buscar: buscar, validar: validar };
})();
