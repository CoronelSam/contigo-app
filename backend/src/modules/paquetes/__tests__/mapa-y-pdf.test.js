'use strict';

// Pruebas unitarias del mapa de campos y de las operaciones con PDF (sin base de datos).

const { PDFDocument } = require('pdf-lib');
const {
  esquemaMapaCampos,
  interpretarOrigen,
  resolverElemento,
  formatearFecha,
} = require('../mapa');
const pdf = require('../pdf');
const { pdfFormulario, pdfEscaneado, textoDelPdf } = require('./ayudantes');

const ctx = {
  solicitud: { codigo: 'HN-0001' },
  paciente: { nombres: 'Niña', sexo: 'femenino', fechaNacimiento: '2016-05-10' },
  tutorResponsable: { parentesco: 'madre' },
  profesional: null,
  secciones: new Map([
    ['crecimiento_movilidad', { ayudasTecnicas: ['andadera', 'muletas'], caminarSolo: 'logrado' }],
    ['informacion_medica', { fechaInicio: '2020-02', cirugias: [{ procedimiento: 'Ficticio' }] }],
  ]),
  consentimientos: new Map([['telesalud', { decision: 'acepta' }]]),
  etiqueta: (tipo, codigo, idioma) => `${tipo}:${codigo}:${idioma}`,
};

const resolver = (el, idioma = 'es') =>
  resolverElemento(el, interpretarOrigen(el.origen), ctx, idioma);

describe('mapa de campos', () => {
  test('orígenes conocidos y desconocidos', () => {
    expect(interpretarOrigen('paciente.nombres')).toMatchObject({
      tipo: 'paciente',
      campo: 'nombres',
    });
    expect(interpretarOrigen('seccion.informacion_medica./cirugias/0/procedimiento')).toMatchObject(
      {
        tipo: 'seccion',
        seccion: 'informacion_medica',
        tokens: ['cirugias', '0', 'procedimiento'],
      },
    );
    expect(interpretarOrigen('consentimiento.telesalud.decision')).toEqual({
      tipo: 'consentimiento',
      consentimiento: 'telesalud',
    });
    for (const origen of [
      'paciente',
      'paciente.toString',
      'constructor.name',
      '__proto__.x',
      'seccion.informacion_medica./',
      'seccion.informacion_medica./cirugias/x',
      'seccion.educacion./../../etc',
      'consentimiento.telesalud.firma',
    ]) {
      expect(interpretarOrigen(origen)).toBeNull();
    }
  });

  test('el esquema exige un destino, no mezcla destinos y no acepta firmas', () => {
    const base = { origen: 'paciente.nombres', tipo: 'texto' };
    expect(esquemaMapaCampos.safeParse([{ ...base, destino: { campoPdf: 'A' } }]).success).toBe(
      true,
    );
    const sinDestino = esquemaMapaCampos.safeParse([base]);
    expect(sinDestino.error.issues[0].params).toEqual({ codigo: 'REQUERIDO' });
    const ambos = esquemaMapaCampos.safeParse([
      { ...base, destino: { campoPdf: 'A' }, destinoCoordenadas: { pagina: 1, x: 1, y: 1 } },
    ]);
    expect(ambos.error.issues[0].params).toEqual({ codigo: 'SOLO_UN_DESTINO' });
    expect(
      esquemaMapaCampos.safeParse([{ ...base, tipo: 'firma', destino: { campoPdf: 'A' } }]).success,
    ).toBe(false);
    const formato = esquemaMapaCampos.safeParse([
      { ...base, formato: 'DD/MM/AAAA', destino: { campoPdf: 'A' } },
    ]);
    expect(formato.error.issues[0].params).toEqual({ codigo: 'SOLO_PARA_FECHAS' });
  });

  test('valores legibles: catálogos, listas, respuestas y fechas', () => {
    const ayudas = { origen: 'seccion.crecimiento_movilidad./ayudasTecnicas', tipo: 'texto' };
    expect(resolver(ayudas, 'en')).toEqual({
      texto: 'ayuda_tecnica:andadera:en, ayuda_tecnica:muletas:en',
    });
    expect(
      resolver({ origen: 'seccion.crecimiento_movilidad./caminarSolo', tipo: 'texto' }, 'en'),
    ).toEqual({ texto: 'Achieved' });
    expect(resolver({ origen: 'tutorResponsable.parentesco', tipo: 'texto' })).toEqual({
      texto: 'parentesco:madre:es',
    });
    expect(resolver({ origen: 'paciente.sexo', tipo: 'texto' }, 'en')).toEqual({ texto: 'Female' });
    expect(resolver({ origen: 'profesional.nombre', tipo: 'texto' })).toBeNull();
    expect(
      resolver({
        origen: 'seccion.informacion_medica./fechaInicio',
        tipo: 'fecha',
        formato: 'MM/DD/AAAA',
      }),
    ).toEqual({ texto: '02/2020' });
    expect(formatearFecha('2016-05-10')).toBe('10/05/2016');
    expect(formatearFecha('2016-05-10', 'MM/DD/AAAA')).toBe('05/10/2016');
    expect(formatearFecha('2016', 'AAAA-MM-DD')).toBe('2016');
  });

  test('casillas: por valor, por lista y por respuesta afirmativa', () => {
    expect(resolver({ origen: 'paciente.sexo', tipo: 'casilla', valor: 'femenino' })).toEqual({
      marcada: true,
    });
    expect(resolver({ origen: 'paciente.sexo', tipo: 'casilla', valor: 'masculino' })).toEqual({
      marcada: false,
    });
    expect(
      resolver({
        origen: 'seccion.crecimiento_movilidad./ayudasTecnicas',
        tipo: 'casilla',
        valor: 'muletas',
      }),
    ).toEqual({ marcada: true });
    expect(resolver({ origen: 'consentimiento.telesalud.decision', tipo: 'casilla' })).toEqual({
      marcada: true,
    });
    expect(resolver({ origen: 'consentimiento.marketing.decision', tipo: 'casilla' })).toEqual({
      marcada: false,
    });
  });
});

describe('operaciones con PDF', () => {
  test('inspecciona páginas y campos, incluido el de firma', async () => {
    const info = await pdf.inspeccionar(await pdfFormulario());
    expect(info.paginas).toBe(2);
    expect(Object.fromEntries(info.campos)).toMatchObject({
      PatientLastName: 'texto',
      Female: 'casilla',
      ParentSignature: 'firma',
    });
    await expect(pdf.inspeccionar(Buffer.from('%PDF-roto'))).rejects.toMatchObject({
      codigo: 'PDF_INVALIDO',
    });
  });

  test('texto fuera de WinAnsi: quita tildes que no existen y cambia lo demás por ?', async () => {
    const doc = await pdf.abrir(await pdfFormulario());
    await pdf.rellenarPorCampo(doc, [{ campoPdf: 'PatientLastName', texto: 'Ñandú Őrs 😀' }]);
    expect(doc.getForm().getTextField('PatientLastName').getText()).toBe('Ñandú Ors ?');
    const { firmas } = pdf.aplanar(doc);
    expect(firmas).toEqual(['ParentSignature']);
    expect(doc.getForm().getFields()).toHaveLength(0);
  });

  test('coordenadas: reduce la letra y recorta lo que no cabe en el ancho', async () => {
    const doc = await pdf.abrir(await pdfEscaneado());
    const { recortados } = await pdf.dibujarPorCoordenadas(doc, [
      {
        pagina: 1,
        x: 10,
        y: 10,
        ancho: 40,
        texto: 'Texto ficticio demasiado largo',
        etiqueta: 'a',
      },
      { pagina: 1, x: 10, y: 30, ancho: 200, texto: 'Cabe', etiqueta: 'b' },
      { pagina: 1, x: 10, y: 50, marcada: false, etiqueta: 'c' },
    ]);
    expect(recortados).toEqual(['a']);
    const texto = await textoDelPdf(await doc.save());
    expect(texto).toContain('Cabe');
    expect(texto).not.toContain('Texto ficticio demasiado largo');
    await expect(
      pdf.dibujarPorCoordenadas(doc, [{ pagina: 2, x: 1, y: 1, texto: 'x', etiqueta: 'd' }]),
    ).rejects.toMatchObject({ codigo: 'PLANTILLA_PAGINA_INEXISTENTE' });
  });

  test('extrae una página y rechaza las que no existen', async () => {
    const bytes = await pdfFormulario();
    const una = await pdf.extraerPagina(bytes, 2);
    expect((await PDFDocument.load(una)).getPageCount()).toBe(1);
    await expect(pdf.extraerPagina(bytes, 3)).rejects.toMatchObject({
      codigo: 'PAGINA_FUERA_DE_RANGO',
    });
  });
});
