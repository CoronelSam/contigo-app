import 'package:flutter/material.dart';
import '../../core/auth/session.dart';
import '../../core/theme/contigo_theme.dart';
import '../../core/widgets/ui.dart';
import '../familia/widgets/step_header.dart';
import '../medico/medical_flow.dart';
import '../documentos/documents_flow.dart';

class NewRequestPage extends StatefulWidget {
  final Session session;
  final String patientId;
  final String patientName;
  final String? existingRequestId;
  final String? existingCode;
  const NewRequestPage({super.key, required this.session,
    required this.patientId, required this.patientName,
    this.existingRequestId, this.existingCode});
  @override
  State<NewRequestPage> createState() => _NewRequestPageState();
}

class _NewRequestPageState extends State<NewRequestPage> {
  String? id, code, selected, status, error;
  bool saving = false, loading = false;

  bool get canEdit => status == null ||
      status == 'BORRADOR' || status == 'CAPTURA';

  @override
  void initState() {
    super.initState();
    id = widget.existingRequestId;
    code = widget.existingCode;
    if (id != null) _loadExisting();
  }

  Future<void> _loadExisting() async {
    setState(() { loading = true; error = null; });
    try {
      final data = await widget.session.api.get('/solicitudes/$id');
      if (!mounted) return;
      if (data is Map) {
        setState(() {
          status = data['estado']?.toString();
          code = data['codigo']?.toString() ?? code;
          final saved = data['modalidad']?.toString();
          selected = saved == 'app' || saved == 'fotos' ? saved : null;
        });
      }
    } catch (e) { if (mounted) setState(() => error = e.toString()); }
    finally { if (mounted) setState(() => loading = false); }
  }

  Future<void> _create() async {
    if (id != null || saving) return;
    setState(() { saving = true; error = null; });
    try {
      final result = await widget.session.api.post('/solicitudes',
          {'pacienteId': widget.patientId});
      if (!mounted) return;
      setState(() {
        id = (result as Map)['id']?.toString();
        code = result['codigo']?.toString();
        status = result['estado']?.toString() ?? 'BORRADOR';
      });
    } catch (e) {
      if (mounted) setState(() => error =
          '$e. Si ya existe una solicitud abierta, regresa a Mis niños '
          'y selecciónala para continuar.');
    } finally { if (mounted) setState(() => saving = false); }
  }

  Future<void> _choose() async {
    if (id == null || selected == null || saving || !canEdit) return;
    setState(() { saving = true; error = null; });
    try {
      final result = await widget.session.api.put('/solicitudes/$id/modalidad',
          {'modalidad': selected});
      if (!mounted) return;
      if (result is Map) {
        setState(() => status = result['estado']?.toString() ?? 'CAPTURA');
      }
      await _continueFlow();
    } catch (e) { if (mounted) setState(() => error = e.toString()); }
    finally { if (mounted) setState(() => saving = false); }
  }

  Future<void> _continueFlow() async {
    if (id == null || selected == null) return;
    if (selected == 'app') {
      await Navigator.push(context, MaterialPageRoute(builder: (_) =>
        MedicalFlowPage(session: widget.session, requestId: id!,
          caseCode: code ?? '')));
    } else {
      await Navigator.push(context, MaterialPageRoute(builder: (_) =>
        DocumentsFlowPage(session: widget.session, requestId: id!,
          caseCode: code ?? '')));
    }
    if (mounted) _loadExisting();
  }

  @override
  Widget build(BuildContext context) => ContigoScaffold(
    title: id == null ? 'Nueva solicitud' : 'Elegir modalidad',
    child: ListView(padding: const EdgeInsets.all(18), children: [
      FamilyStepHeader(
        screen: id == null ? 11 : 12,
        icon: id == null ? Icons.note_add_outlined : Icons.fact_check_outlined,
        title: id == null ? 'Nueva solicitud de atención' : '¿Cómo deseas completarla?',
        subtitle: id == null
            ? 'Crearemos un expediente único para este niño.'
            : 'Selecciona la opción que te resulte más cómoda.',
      ),
      const SizedBox(height: 18),
      ContigoPanel(color: ContigoColors.azul,
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          const Text('Niño', style: TextStyle(fontWeight: FontWeight.bold)),
          Text(widget.patientName),
          if (code != null) Text('Caso: $code',
              style: const TextStyle(color: ContigoColors.vinoOscuro)),
        ])),
      const SizedBox(height: 20),
      if (loading) const LinearProgressIndicator(),
      if (id == null) ...[
        const Text('Tu solicitud guardará la información médica y los '
            'documentos en el expediente de este niño.'),
        const SizedBox(height: 22),
        ElevatedButton.icon(onPressed: saving ? null : _create,
          icon: const Icon(Icons.add_circle_outline),
          label: const Text('Crear solicitud')),
      ] else if (!loading && !canEdit) ...[
        const ContigoPanel(color: ContigoColors.amarillo,
          child: Text('Esta solicitud ya pasó a una etapa de revisión o '
              'seguimiento. Su modalidad no puede modificarse desde aquí.')),
        const SizedBox(height: 12),
        Text('Estado actual: ${status ?? 'Sin información'}'),
        TextButton(onPressed: () => Navigator.pop(context),
          child: const Text('Volver a Mis niños')),
      ] else if (!loading) ...[
        _choice('app', 'Llenar en la aplicación',
          'Responde preguntas sencillas paso a paso.',
          Icons.edit_note_rounded, ContigoColors.rosa),
        const SizedBox(height: 12),
        _choice('fotos', 'Fotografiar formularios llenos',
          'Toma fotografías de los formularios escritos a mano.',
          Icons.document_scanner_outlined, ContigoColors.azul),
        const SizedBox(height: 18),
        const ContigoPanel(color: ContigoColors.amarillo,
          child: Text('Ambas opciones utilizan el mismo expediente. '
              'No tendrás que registrar al niño nuevamente.')),
        const SizedBox(height: 16),
        ElevatedButton(onPressed: saving || selected == null ? null : _choose,
          child: const Text('Guardar y continuar')),
        const SizedBox(height: 10),
        if (status == 'CAPTURA' && selected != null)
          TextButton(onPressed: saving ? null : _continueFlow,
            child: const Text('Continuar solicitud existente')),
      ],
      if (saving) const LinearProgressIndicator(),
      if (error != null) ErrorNotice(error!),
    ]),
  );

  Widget _choice(String value, String title, String description,
      IconData icon, Color color) => Material(
    color: color, borderRadius: BorderRadius.circular(17),
    child: InkWell(borderRadius: BorderRadius.circular(17),
      onTap: saving ? null : () => setState(() => selected = value),
      child: Padding(padding: const EdgeInsets.all(14), child: Row(children: [
        Icon(icon, color: ContigoColors.vino, size: 30),
        const SizedBox(width: 11),
        Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start,
          children: [Text(title, style: const TextStyle(fontWeight: FontWeight.w800)),
            Text(description, style: const TextStyle(fontSize: 12))])),
        Radio<String>(value: value, groupValue: selected,
          onChanged: saving ? null : (v) => setState(() => selected = v)),
      ])),
    ),
  );
}
