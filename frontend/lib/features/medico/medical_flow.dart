import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../../core/auth/session.dart';
import '../../core/theme/contigo_theme.dart';
import '../../core/widgets/ui.dart';
import '../documentos/documents_flow.dart';

/// Secciones oficiales de la API; no usar campos inventados.
const medicalSections = <(String, String)>[
  ('informacion_medica', 'Información médica inicial'),
  ('embarazo_nacimiento', 'Embarazo y nacimiento'),
  ('antecedentes_medicos', 'Antecedentes médicos'),
  ('medicamentos_alergias', 'Medicamentos y alergias'),
  ('crecimiento_movilidad', 'Crecimiento y movilidad'),
  ('educacion', 'Educación y antecedentes'),
];

const fieldLabels = <String, String>{
  'diagnostico':'Problema médico o diagnóstico', 'fechaInicio':'¿Cuándo comenzó? (AAAA, AAAA-MM o AAAA-MM-DD)',
  'atencionSolicitada':'Atención solicitada', 'atencionSolicitadaOtra':'Describe la atención',
  'tratamientosPrevios':'Tratamientos anteriores', 'cirugias':'Cirugías previas',
  'estudiosDisponibles':'Estudios disponibles', 'procedimiento':'Procedimiento',
  'fecha':'Fecha', 'lugar':'Lugar', 'descripcion':'Descripción',
  'cuidadosPrenatales':'¿Recibió cuidados prenatales?', 'pesoNacerKg':'Peso al nacer (kg)',
  'momentoParto':'¿Cuándo ocurrió el parto?', 'tipoParto':'Tipo de parto',
  'nacioDeNalgas':'¿Nació de nalgas?', 'medicamentosEmbarazo':'¿Tomó medicamentos durante el embarazo?',
  'medicamentosEmbarazoDetalle':'¿Cuáles medicamentos?', 'ucin':'¿Estuvo en cuidados intensivos neonatales?',
  'ucinDetalle':'¿Durante cuánto tiempo?', 'condiciones':'Condiciones médicas actuales o anteriores',
  'condicionesOtra':'Otra condición', 'antecedentesFamiliares':'¿Hay antecedentes familiares?',
  'antecedentesFamiliaresDetalle':'Describe los antecedentes familiares',
  'cirugiasHospitalizaciones':'¿Tuvo cirugías u hospitalizaciones?',
  'cirugiasHospitalizacionesDetalle':'Detalla las cirugías u hospitalizaciones',
  'transfusiones':'¿Recibió transfusiones?', 'transfusionesDetalle':'Explica el motivo',
  'problemasAnestesia':'¿Hubo problemas con la anestesia?',
  'problemasAnestesiaDetalle':'Describe lo ocurrido',
  'usaMedicamentos':'¿Toma medicamentos o suplementos?', 'medicamentos':'Medicamentos, suplementos y remedios',
  'tipo':'Tipo', 'nombre':'Nombre', 'dosis':'Dosis', 'motivo':'Motivo',
  'alergias':'¿Tiene alergias?', 'alergiasTipo':'Tipo de alergia',
  'alergiasReaccion':'Reacción que presenta',
  'sentarse':'¿Se sentó sin ayuda?', 'sentarseEdadMeses':'Edad en meses al sentarse',
  'caminarConAyuda':'¿Caminó con ayuda?', 'caminarConAyudaEdadMeses':'Edad en meses al caminar con ayuda',
  'caminarSolo':'¿Caminó sin ayuda?', 'caminarSoloEdadMeses':'Edad en meses al caminar solo',
  'ayudasTecnicas':'Ayudas para movilidad', 'ayudasTecnicasOtra':'Otra ayuda técnica',
  'terapias':'Terapias que recibe', 'terapiasOtra':'Otra terapia',
  'actividadesIndependientes':'Actividades que puede hacer sin ayuda',
  'gradoEscolar':'Grado escolar', 'asisteEscuela':'¿Asiste regularmente a la escuela?',
  'educacionEspecial':'¿Recibe educación especial?', 'preocupaciones':'Preocupaciones escolares',
};

const _choiceLabels = <String, String>{
  'si':'Sí', 'no':'No', 'no_se':'No sé',
  'antes':'Antes de la fecha prevista',
  'en_fecha':'En la fecha prevista',
  'despues':'Después de la fecha prevista',
  'vaginal':'Parto vaginal', 'cesarea':'Cesárea',
  'logrado':'Sí, lo logró', 'aun_no':'Aún no',
  'medicamento':'Medicamento', 'suplemento':'Suplemento',
  'remedio':'Remedio casero',
};

String friendlyChoice(String key) => _choiceLabels[key] ?? key.replaceAll('_', ' ');

class MedicalFlowPage extends StatefulWidget {
  final Session session;
  final String requestId;
  final String caseCode;
  const MedicalFlowPage({super.key, required this.session,
    required this.requestId, required this.caseCode});
  @override
  State<MedicalFlowPage> createState() => _MedicalFlowPageState();
}

class _MedicalFlowPageState extends State<MedicalFlowPage> {
  int step = 0;
  void _next() => setState(() => step = (step + 1).clamp(0, 8));
  void _back() => step == 0 ? Navigator.pop(context) : setState(() => step--);
  @override
  Widget build(BuildContext context) {
    if (step < 6) {
      final section = medicalSections[step];
      return MedicalSectionPage(key: ValueKey('medical_$step'), session: widget.session,
        requestId: widget.requestId, code: section.$1, label: section.$2,
        screenNumber: 13 + step, onNext: _next, onBack: _back);
    }
    if (step == 6) return ProfessionalPage(session: widget.session,
      requestId: widget.requestId, onNext: _next, onBack: _back);
    if (step == 7) return ConsentsPage(session: widget.session,
      requestId: widget.requestId, onNext: _next, onBack: _back);
    return MedicalSummaryPage(session: widget.session,
      requestId: widget.requestId, caseCode: widget.caseCode, onBack: _back);
  }
}

class MedicalSectionPage extends StatefulWidget {
  final Session session;
  final String requestId, code, label;
  final int screenNumber;
  final VoidCallback onNext, onBack;
  const MedicalSectionPage({super.key, required this.session, required this.requestId,
    required this.code, required this.label, required this.screenNumber,
    required this.onNext, required this.onBack});
  @override
  State<MedicalSectionPage> createState() => _MedicalSectionPageState();
}

class _MedicalSectionPageState extends State<MedicalSectionPage> {
  Map<String, dynamic> schema = {}, values = {}, catalogs = {};
  int version = 0;
  bool loading = true, saving = false;
  String? error, state;
  @override
  void initState() { super.initState(); _load(); }

  Future<void> _load() async {
    try {
      final text = await rootBundle.loadString('assets/esquemas/v1/${widget.code}.json');
      final parsed = Map<String, dynamic>.from(jsonDecode(text) as Map);
      final section = await widget.session.api.get(
        '/solicitudes/${widget.requestId}/secciones/${widget.code}');
      final props = Map<String, dynamic>.from(parsed['properties'] as Map);
      final types = <String>{};
      for (final prop in props.values) {
        if (prop is Map && prop['catalogo'] is String) types.add(prop['catalogo'] as String);
        if (prop is Map && prop['items'] is Map && (prop['items'] as Map)['catalogo'] is String) {
          types.add((prop['items'] as Map)['catalogo'].toString());
        }
      }
      final loaded = <String, dynamic>{};
      for (final type in types) {
        loaded[type] = await widget.session.api.get('/catalogos/$type?idioma=es');
      }
      if (!mounted) return;
      setState(() {
        schema = parsed;
        values = Map<String, dynamic>.from((section as Map)['datos'] as Map? ?? {});
        version = (section['version'] as num?)?.toInt() ?? 0;
        state = section['estado']?.toString();
        catalogs = loaded;
        loading = false;
      });
    } catch (e) { if (mounted) setState(() { error = e.toString(); loading = false; }); }
  }

  bool _visible(String key) {
    const conditions = <String, String>{
      'atencionSolicitadaOtra':'atencionSolicitada', 'medicamentosEmbarazoDetalle':'medicamentosEmbarazo',
      'ucinDetalle':'ucin', 'antecedentesFamiliaresDetalle':'antecedentesFamiliares',
      'cirugiasHospitalizacionesDetalle':'cirugiasHospitalizaciones', 'transfusionesDetalle':'transfusiones',
      'problemasAnestesiaDetalle':'problemasAnestesia', 'medicamentos':'usaMedicamentos',
      'alergiasTipo':'alergias', 'alergiasReaccion':'alergias',
      'sentarseEdadMeses':'sentarse', 'caminarConAyudaEdadMeses':'caminarConAyuda',
      'caminarSoloEdadMeses':'caminarSolo', 'condicionesOtra':'condiciones',
      'ayudasTecnicasOtra':'ayudasTecnicas', 'terapiasOtra':'terapias',
    };
    if (key == 'atencionSolicitadaOtra') return values['atencionSolicitada'] == 'otra';
    if (key == 'medicamentos') return values['usaMedicamentos'] == 'si';
    if (key.endsWith('EdadMeses')) return values[conditions[key]] == 'logrado';
    if (['condicionesOtra','ayudasTecnicasOtra','terapiasOtra'].contains(key)) {
      final choices = values[conditions[key]];
      return choices is List && choices.contains('otra');
    }
    if (conditions.containsKey(key)) return values[conditions[key]] == 'si';
    return true;
  }

  Future<void> _save({bool next = false}) async {
    if (saving || schema.isEmpty) return;
    setState(() { saving = true; error = null; });
    try {
      final clean = <String, dynamic>{};
      for (final entry in values.entries) {
        if (!_visible(entry.key) || entry.value == null) continue;
        if (entry.value is String && (entry.value as String).trim().isEmpty) continue;
        if (entry.value is List && (entry.value as List).isEmpty) continue;
        clean[entry.key] = entry.value;
      }
      final saved = await widget.session.api.put(
        '/solicitudes/${widget.requestId}/secciones/${widget.code}',
        {'datos':clean,'idioma':'es'},
        headers: version > 0 ? {'If-Match':'"v$version"'} : null,
      );
      if (!mounted) return;
      setState(() {
        version = (saved['version'] as num?)?.toInt() ?? version;
        state = saved['estado']?.toString();
      });
      if (next) widget.onNext(); else showMessage(context, 'Borrador guardado correctamente.');
    } catch (e) {
      if (mounted) setState(() => error = e.toString());
    } finally { if (mounted) setState(() => saving = false); }
  }

  Widget _catalogPicker(String key, String title, String catalogType) {
    final options = (catalogs[catalogType] as List?) ?? [];
    final selected = values[key]?.toString();
    final usable = options.whereType<Map>().toList();
    return DropdownButtonFormField<String>(
      key: ValueKey('${widget.code}_$key'),
      initialValue: usable.any((o) => o['codigo'].toString() == selected) ? selected : null,
      isExpanded: true,
      decoration: fieldDecoration(title),
      items: usable.map((o) => DropdownMenuItem<String>(
        value: o['codigo'].toString(), child: Text(o['etiqueta'].toString(),
          overflow: TextOverflow.ellipsis))).toList(),
      onChanged: (v) => setState(() => values[key] = v),
    );
  }

  Widget _buildField(String key, Map<String, dynamic> spec) {
    if (!_visible(key)) return const SizedBox.shrink();
    final label = fieldLabels[key] ?? key;
    final type = spec['type']?.toString();
    final options = spec['enum'] as List?;
    final catalog = spec['catalogo'];
    Widget child;
    if (catalog is String) {
      child = _catalogPicker(key, label, catalog);
    } else if (options != null) {
      final current = values[key]?.toString();
      child = DropdownButtonFormField<String>(
        key: ValueKey('${widget.code}_$key'),
        initialValue: options.contains(current) ? current : null,
        isExpanded: true, decoration: fieldDecoration(label),
        items: options.map((v) => DropdownMenuItem<String>(
          value: v.toString(), child: Text(friendlyChoice(v.toString())))).toList(),
        onChanged: (v) => setState(() => values[key] = v));
    } else if (type == 'array') {
      child = _arrayField(key, label, spec);
    } else {
      final isNumber = type == 'integer' || type == 'number';
      child = TextFormField(
        key: ValueKey('${widget.code}_${key}_$version'),
        initialValue: values[key]?.toString() ?? '',
        keyboardType: isNumber ? const TextInputType.numberWithOptions(decimal: true) :
          (key.toLowerCase().contains('fecha') ? TextInputType.datetime : TextInputType.multiline),
        maxLines: isNumber || key.toLowerCase().contains('fecha') ? 1 : (['diagnostico','tratamientosPrevios','preocupaciones','actividadesIndependientes'].contains(key) ? 3 : 1),
        maxLength: (spec['maxLength'] as num?)?.toInt(),
        decoration: fieldDecoration(label),
        onChanged: (v) { values[key] = isNumber ? (v.isEmpty ? null : num.tryParse(v.replaceAll(',', '.'))) : v; },
      );
    }
    return Padding(padding: const EdgeInsets.only(bottom: 14), child: child);
  }

  Widget _arrayField(String key, String title, Map<String, dynamic> spec) {
    final list = List<dynamic>.from(values[key] as List? ?? []);
    final itemSpec = Map<String, dynamic>.from(spec['items'] as Map);
    if (itemSpec['catalogo'] is String) {
      final options = (catalogs[itemSpec['catalogo']] as List? ?? []).whereType<Map>().toList();
      return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text(title, style: const TextStyle(fontWeight: FontWeight.bold)),
        ...options.map((o) => CheckboxListTile(
          dense: true, contentPadding: EdgeInsets.zero,
          title: Text(o['etiqueta'].toString()),
          value: list.contains(o['codigo']),
          onChanged: (v) => setState(() {
            final changed = List<dynamic>.from(values[key] as List? ?? []);
            if (v == true && !changed.contains(o['codigo'])) changed.add(o['codigo']);
            if (v != true) changed.remove(o['codigo']);
            values[key] = changed;
          }),
        )),
      ]);
    }
    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Text(title, style: const TextStyle(fontWeight: FontWeight.bold)),
      ...list.asMap().entries.map((entry) => Card(child: ListTile(
        title: Text((entry.value as Map).values.join(' · '), maxLines: 2,
          overflow: TextOverflow.ellipsis),
        trailing: IconButton(icon: const Icon(Icons.delete_outline),
          onPressed: () => setState(() {
            final changed = List<dynamic>.from(values[key] as List? ?? []);
            changed.removeAt(entry.key); values[key] = changed;
          })),
      ))),
      OutlinedButton.icon(onPressed: () => _addArrayObject(key, itemSpec),
        icon: const Icon(Icons.add), label: Text('Agregar ${title.toLowerCase()}')),
    ]);
  }

  Future<void> _addArrayObject(String key, Map<String, dynamic> itemSpec) async {
    final fields = Map<String, dynamic>.from(itemSpec['properties'] as Map);
    final entries = <String, TextEditingController>{};
    final enums = <String, String?>{};
    for (final entry in fields.entries) {
      if ((entry.value as Map)['enum'] is List) {
        enums[entry.key] = ((entry.value as Map)['enum'] as List).first.toString();
      } else { entries[entry.key] = TextEditingController(); }
    }
    final result = await showDialog<Map<String, dynamic>>(context: context, builder: (ctx) =>
      StatefulBuilder(builder: (ctx, setDialogState) => AlertDialog(
        title: Text('Agregar ${fieldLabels[key]?.toLowerCase() ?? 'registro'}'),
        content: SingleChildScrollView(child: Column(mainAxisSize: MainAxisSize.min,
          children: fields.entries.map((e) {
            final choices = (e.value as Map)['enum'] as List?;
            if (choices != null) return DropdownButtonFormField<String>(
              initialValue: enums[e.key], decoration: fieldDecoration(fieldLabels[e.key] ?? e.key),
              items: choices.map((v) => DropdownMenuItem<String>(value: v.toString(),
                child: Text(friendlyChoice(v.toString())))).toList(),
              onChanged: (v) => setDialogState(() => enums[e.key] = v));
            return Padding(padding: const EdgeInsets.only(bottom: 10), child: TextField(
              controller: entries[e.key], decoration: fieldDecoration(fieldLabels[e.key] ?? e.key)));
          }).toList())),
        actions: [TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Cancelar')),
          FilledButton(onPressed: () {
            final data = <String, dynamic>{};
            for (final e in entries.entries) {
              if (e.value.text.trim().isNotEmpty) data[e.key] = e.value.text.trim();
            }
            for (final e in enums.entries) { if (e.value != null) data[e.key] = e.value; }
            Navigator.pop(ctx, data);
          }, child: const Text('Agregar'))],
      )));
    for (final controller in entries.values) { controller.dispose(); }
    if (result != null && result.isNotEmpty && mounted) {
      setState(() {
        final changed = List<dynamic>.from(values[key] as List? ?? []);
        changed.add(result); values[key] = changed;
      });
    }
  }

  @override
  Widget build(BuildContext context) => ContigoScaffold(title: 'Solicitud de atención', child:
    loading ? const Center(child: CircularProgressIndicator()) : ListView(
      padding: const EdgeInsets.all(18), children: [
        Text('${widget.screenNumber}. ${widget.label}', style: const TextStyle(
          fontSize: 22, fontWeight: FontWeight.w800, color: ContigoColors.vinoOscuro)),
        const SizedBox(height: 8),
        LinearProgressIndicator(value: (widget.screenNumber - 12) / 9,
          color: ContigoColors.vino),
        const SizedBox(height: 12),
        Text('Estado: ${state ?? 'Sin guardar'}. Guarda tu avance cuando quieras.'),
        const SizedBox(height: 16),
        if (schema.isNotEmpty)
          ...Map<String, dynamic>.from(schema['properties'] as Map).entries.map(
            (e) => _buildField(e.key, Map<String, dynamic>.from(e.value as Map))),
        if (error != null) ErrorNotice(error!),
        if (saving) const LinearProgressIndicator(),
        const SizedBox(height: 12),
        Row(children: [
          Expanded(child: OutlinedButton(onPressed: widget.onBack, child: const Text('Atrás'))),
          const SizedBox(width: 8),
          Expanded(child: OutlinedButton(onPressed: saving ? null : () => _save(),
            child: const Text('Guardar borrador'))),
          const SizedBox(width: 8),
          Expanded(child: ElevatedButton(onPressed: saving ? null : () => _save(next: true),
            child: const Text('Siguiente'))),
        ]),
      ],
    ));
}

class ProfessionalPage extends StatefulWidget {
  final Session session;
  final String requestId;
  final VoidCallback onNext, onBack;
  const ProfessionalPage({super.key, required this.session, required this.requestId,
    required this.onNext, required this.onBack});
  @override
  State<ProfessionalPage> createState() => _ProfessionalPageState();
}
class _ProfessionalPageState extends State<ProfessionalPage> {
  final name = TextEditingController(), phone = TextEditingController(), email = TextEditingController();
  String? speciality, error;
  List<dynamic> options = [];
  bool saving = false, loading = true;
  @override
  void initState() { super.initState(); _load(); }
  Future<void> _load() async {
    try {
      final results = await Future.wait([
        widget.session.api.get('/solicitudes/${widget.requestId}'),
        widget.session.api.get('/catalogos/especialidad_medica?idioma=es')]);
      final professional = (results[0] as Map)['profesional'] as Map? ?? {};
      name.text = professional['nombre']?.toString() ?? '';
      phone.text = professional['telefono']?.toString() ?? '';
      email.text = professional['correo']?.toString() ?? '';
      if (mounted) setState(() {
        speciality = professional['especialidad']?.toString();
        options = results[1] as List; loading = false;
      });
    } catch (e) { if (mounted) setState(() { error = e.toString(); loading = false; }); }
  }
  Future<void> _save() async {
    setState(() { saving = true; error = null; });
    try {
      await widget.session.api.put('/solicitudes/${widget.requestId}/profesional-salud', {
        'nombre':name.text.trim().isEmpty ? null : name.text.trim(),
        'especialidad':speciality,
        'telefono':phone.text.trim().isEmpty ? null : phone.text.trim(),
        'correo':email.text.trim().isEmpty ? null : email.text.trim(),
      });
      if (mounted) widget.onNext();
    } catch(e) { if (mounted) setState(() => error = e.toString()); }
    finally { if (mounted) setState(() => saving = false); }
  }
  @override
  void dispose() { name.dispose(); phone.dispose(); email.dispose(); super.dispose(); }
  @override
  Widget build(BuildContext context) => ContigoScaffold(title: 'Solicitud médica', child:
    loading ? const Center(child: CircularProgressIndicator()) : ListView(
      padding: const EdgeInsets.all(18), children: [
        const Text('19. Profesional de salud y certificación', style: TextStyle(fontSize: 22,
          fontWeight: FontWeight.w800, color: ContigoColors.vinoOscuro)),
        const SizedBox(height: 14),
        const ContigoPanel(color: ContigoColors.azul, child: Text(
          'La certificación médica debe completarla o firmarla un profesional autorizado. '
          'Se adjuntará como documento en la siguiente etapa; la familia no puede certificarla.')),
        const SizedBox(height: 15),
        TextField(controller: name, decoration: fieldDecoration('Nombre del profesional')),
        const SizedBox(height: 12),
        DropdownButtonFormField<String>(initialValue: options.any((o) => o['codigo'] == speciality)
          ? speciality : null, isExpanded: true,
          decoration: fieldDecoration('Especialidad'),
          items: options.whereType<Map>().map((o) => DropdownMenuItem<String>(
            value: o['codigo'].toString(), child: Text(o['etiqueta'].toString()))).toList(),
          onChanged: (v) => setState(() => speciality = v)),
        const SizedBox(height: 12),
        TextField(controller: phone, keyboardType: TextInputType.phone,
          decoration: fieldDecoration('Teléfono de contacto (con prefijo)')),
        const SizedBox(height: 12),
        TextField(controller: email, keyboardType: TextInputType.emailAddress,
          decoration: fieldDecoration('Correo electrónico')),
        const SizedBox(height: 14),
        if (error != null) ErrorNotice(error!),
        if (saving) const LinearProgressIndicator(),
        Row(children: [
          Expanded(child: OutlinedButton(onPressed: widget.onBack, child: const Text('Atrás'))),
          const SizedBox(width: 10),
          Expanded(child: ElevatedButton(onPressed: saving ? null : () => _save(),
            child: const Text('Guardar y seguir'))),
        ]),
      ]));
}

class ConsentsPage extends StatefulWidget {
  final Session session;
  final String requestId;
  final VoidCallback onNext, onBack;
  const ConsentsPage({super.key, required this.session, required this.requestId,
    required this.onNext, required this.onBack});
  @override
  State<ConsentsPage> createState() => _ConsentsPageState();
}
class _ConsentsPageState extends State<ConsentsPage> {
  List<dynamic> texts = [], saved = [];
  bool loading = true, saving = false;
  String? error;
  @override
  void initState() { super.initState(); _load(); }
  Future<void> _load() async {
    try {
      final response = await Future.wait([
        widget.session.api.get('/consentimientos/textos?idioma=es'),
        widget.session.api.get('/solicitudes/${widget.requestId}')]);
      if (mounted) setState(() {
        texts = response[0] as List;
        saved = ((response[1] as Map)['consentimientos'] as List? ?? []);
        loading = false;
      });
    } catch(e) { if (mounted) setState(() { error = e.toString(); loading = false; }); }
  }
  Future<void> _openText(Map text) async {
    final id = text['id'].toString();
    final canDecide = await showDialog<bool>(context: context, builder: (ctx) => AlertDialog(
      title: Text(text['titulo']?.toString() ?? 'Consentimiento'),
      content: SizedBox(width: 420, child: SingleChildScrollView(child:
        SelectableText(text['cuerpo']?.toString() ?? ''))),
      actions: [TextButton(onPressed: () => Navigator.pop(ctx, false),
        child: const Text('Cerrar')),
        ElevatedButton(onPressed: () => Navigator.pop(ctx, true),
          child: const Text('He leído el texto completo'))],
    ));
    if (canDecide != true) return;
    try {
      await widget.session.api.post('/consentimientos/textos/$id/abierto',
        {'solicitudId':widget.requestId});
      if (!mounted) return;
      final decision = await showDialog<String>(context: context,
        builder: (ctx) => AlertDialog(
          title: const Text('¿Cuál es tu decisión?'),
          content: const Text('Tu decisión se guardará. No se genera ninguna firma digital.'),
          actions: [
            TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Cancelar')),
            TextButton(onPressed: () => Navigator.pop(ctx, 'no_acepta'),
              child: const Text('No acepto')),
            ElevatedButton(onPressed: () => Navigator.pop(ctx, 'acepta'),
              child: const Text('Acepto')),
          ],
        ));
      if (decision == null) return;
      setState(() { saving = true; error = null; });
      await widget.session.api.put(
        '/solicitudes/${widget.requestId}/consentimientos/${text['tipo']}',
        {'decision':decision, 'textoId':id});
      await _load();
    } catch(e) { if (mounted) setState(() => error = e.toString()); }
    finally { if (mounted) setState(() => saving = false); }
  }
  @override
  Widget build(BuildContext context) => ContigoScaffold(title: 'Consentimientos', child:
    loading ? const Center(child: CircularProgressIndicator()) : ListView(
      padding: const EdgeInsets.all(18), children: [
        const Text('20. Consentimientos', style: TextStyle(fontSize: 22,
          color: ContigoColors.vinoOscuro, fontWeight: FontWeight.w800)),
        const SizedBox(height: 10),
        const ContigoPanel(color: ContigoColors.amarillo,
          child: Text('Lee cada documento oficial antes de decidir. '
            'Puedes rechazar el uso de imágenes para marketing sin afectar la evaluación médica. '
            'Las firmas requeridas permanecen pendientes hasta que se validen los documentos firmados.')),
        const SizedBox(height: 14),
        ...texts.whereType<Map>().map((t) {
          final current = saved.whereType<Map>().where((s) => s['tipo'] == t['tipo']);
          final status = current.isNotEmpty ? current.first : <String, dynamic>{};
          final decision = status['decision']?.toString();
          return Card(child: ListTile(
            title: Text(t['titulo']?.toString() ?? t['tipo'].toString(),
              style: const TextStyle(fontWeight: FontWeight.bold)),
            subtitle: Text(decision == null ? 'Pendiente de decisión' :
              '${decision == 'acepta' ? 'Aceptado' : 'No aceptado'} · '
              '${status['firmaPendiente'] == true ? 'Firma pendiente' : 'Decisión registrada'}'),
            trailing: const Icon(Icons.chevron_right),
            onTap: saving ? null : () => _openText(t),
          ));
        }),
        if (error != null) ErrorNotice(error!),
        if (saving) const LinearProgressIndicator(),
        const SizedBox(height: 12),
        Row(children: [
          Expanded(child: OutlinedButton(onPressed: widget.onBack,
            child: const Text('Atrás'))),
          const SizedBox(width: 10),
          Expanded(child: ElevatedButton(onPressed: widget.onNext,
            child: const Text('Ver resumen'))),
        ]),
      ]));
}

class MedicalSummaryPage extends StatefulWidget {
  final Session session;
  final String requestId, caseCode;
  final VoidCallback onBack;
  const MedicalSummaryPage({super.key, required this.session, required this.requestId,
    required this.caseCode, required this.onBack});
  @override
  State<MedicalSummaryPage> createState() => _MedicalSummaryPageState();
}
class _MedicalSummaryPageState extends State<MedicalSummaryPage> {
  dynamic summary;
  String? error;
  @override
  void initState() { super.initState(); _load(); }
  Future<void> _load() async {
    try {
      final result = await widget.session.api.get('/solicitudes/${widget.requestId}');
      if (mounted) setState(() { summary = result; error = null; });
    } catch (e) { if (mounted) setState(() => error = e.toString()); }
  }
  @override
  Widget build(BuildContext context) {
    final data = summary as Map?;
    return ContigoScaffold(title: 'Resumen médico', child: ListView(
      padding: const EdgeInsets.all(18), children: [
        const Text('21. Resumen del formulario', style: TextStyle(fontSize: 22,
          fontWeight: FontWeight.w800, color: ContigoColors.vinoOscuro)),
        const SizedBox(height: 12),
        if (data == null) const LinearProgressIndicator(),
        if (data != null) ...[
          ContigoPanel(color: ContigoColors.rosa, child: Text(
            '${data['paciente']?['nombreCompleto'] ?? 'Paciente'} · Caso: ${data['codigo'] ?? widget.caseCode}')),
          const SizedBox(height: 14),
          ...(data['secciones'] as List? ?? []).whereType<Map>().map((s) =>
            Card(child: ListTile(
              leading: Icon(s['estado'] == 'completa' ? Icons.check_circle : Icons.info_outline,
                color: s['estado'] == 'completa' ? ContigoColors.verde : ContigoColors.vino),
              title: Text(s['titulo']?.toString() ?? s['codigo'].toString()),
              subtitle: Text(s['estado']?.toString() ?? 'Pendiente')))),
          const SizedBox(height: 10),
          Text('Requisitos pendientes: ${(data['faltantes'] as List? ?? []).length}'),
        ],
        if (error != null) ErrorNotice(error!),
        const SizedBox(height: 16),
        OutlinedButton(onPressed: widget.onBack, child: const Text('Editar información')),
        const SizedBox(height: 10),
        OutlinedButton(onPressed: () => showMessage(context,
          'Los borradores se guardan en cada sección. Puedes continuar después.'),
          child: const Text('Guardar borrador')),
        const SizedBox(height: 10),
        OutlinedButton(onPressed: _load, child: const Text('Actualizar resumen')),
        const SizedBox(height: 10),
        ElevatedButton(onPressed: data == null ? null : () => Navigator.push(context,
          MaterialPageRoute(builder: (_) => DocumentsFlowPage(session: widget.session,
            requestId: widget.requestId, caseCode: widget.caseCode))),
          child: const Text('Continuar a documentos')),
      ],
    ));
  }
}
