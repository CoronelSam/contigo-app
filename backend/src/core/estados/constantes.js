'use strict';

// Constantes de dominio compartidas. Las migraciones copian estos valores en sus CHECK;
// test/modelo/restricciones.test.js comprueba que coincidan con la base.

const congelar = (objeto) => Object.freeze({ ...objeto });

/** Estados de la solicitud: 8 del manual (anexo A) y 4 propuestos para la decisión de ruta. */
const ESTADOS_SOLICITUD = congelar({
  BORRADOR: 'BORRADOR',
  CAPTURA: 'CAPTURA',
  EN_REVISION: 'EN_REVISION',
  INFO_ADICIONAL: 'INFO_ADICIONAL',
  EN_EVALUACION: 'EN_EVALUACION',
  PAQUETE_EXTERIOR: 'PAQUETE_EXTERIOR',
  COMPLETA: 'COMPLETA',
  ENVIADA: 'ENVIADA',
  ACEPTADA: 'ACEPTADA',
  DENEGADA: 'DENEGADA',
  DERIVADA_HN: 'DERIVADA_HN',
  ATENDIDA_HN: 'ATENDIDA_HN',
});

/** Estados en los que el caso terminó. */
const ESTADOS_FINALES = Object.freeze([ESTADOS_SOLICITUD.ACEPTADA, ESTADOS_SOLICITUD.ATENDIDA_HN]);

const ETAPAS = congelar({ EVALUACION: 'evaluacion', PAQUETE: 'paquete' });

const MODALIDADES = congelar({ APP: 'app', FOTOS: 'fotos' });

/** Rutas que una persona puede decidir. */
const RUTAS = congelar({ HONDURAS: 'HONDURAS', MEXICO: 'MEXICO', INTERNACIONAL: 'INTERNACIONAL' });

/** Rutas que pueden sugerir las reglas (incluye "por evaluar" cuando ninguna regla aplica). */
const RUTAS_SUGERIDAS = congelar({ ...RUTAS, POR_EVALUAR: 'POR_EVALUAR' });

/** Paquetes para Shriners (solo rutas al exterior). */
const PAQUETES = congelar({ MEXICO: 'MEXICO', INTERNACIONAL: 'INTERNACIONAL' });

/** Etapa o ruta a la que pertenece un requisito de documento (`requisitos_ruta.ruta`). */
const RUTAS_REQUISITO = congelar({
  EVALUACION: 'EVALUACION',
  HONDURAS: 'HONDURAS',
  MEXICO: 'MEXICO',
  INTERNACIONAL: 'INTERNACIONAL',
});

const ROLES = congelar({
  FAMILIA: 'familia',
  VOLUNTARIO: 'voluntario',
  COORDINADOR: 'coordinador',
  ADMINISTRADOR: 'administrador',
});

const ESTADOS_DOCUMENTO = congelar({
  FALTA: 'FALTA',
  CAPTURADO: 'CAPTURADO',
  VALIDADO: 'VALIDADO',
  RECHAZADO: 'RECHAZADO',
});

const lista = (objeto) => Object.freeze(Object.values(objeto));

module.exports = {
  ESTADOS_SOLICITUD,
  ESTADOS_FINALES,
  ETAPAS,
  MODALIDADES,
  RUTAS,
  RUTAS_SUGERIDAS,
  PAQUETES,
  RUTAS_REQUISITO,
  ROLES,
  ESTADOS_DOCUMENTO,
  LISTA_ESTADOS_SOLICITUD: lista(ESTADOS_SOLICITUD),
  LISTA_ETAPAS: lista(ETAPAS),
  LISTA_MODALIDADES: lista(MODALIDADES),
  LISTA_RUTAS: lista(RUTAS),
  LISTA_RUTAS_SUGERIDAS: lista(RUTAS_SUGERIDAS),
  LISTA_PAQUETES: lista(PAQUETES),
  LISTA_RUTAS_REQUISITO: lista(RUTAS_REQUISITO),
  LISTA_ROLES: lista(ROLES),
  LISTA_ESTADOS_DOCUMENTO: lista(ESTADOS_DOCUMENTO),
};
