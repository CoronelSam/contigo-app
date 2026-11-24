import 'package:flutter/material.dart';
import '../../core/auth/session.dart';
import '../../core/theme/contigo_theme.dart';
import '../../core/widgets/ui.dart';

class NewRequestPage extends StatefulWidget {
  final Session session;
  final String patientId;
  final String patientName;
  final String? existingRequestId;
  final String? existingCode;
  const NewRequestPage({super.key, required this.session, required this.patientId,
    required this.patientName, this.existingRequestId, this.existingCode});
  @override
  State<NewRequestPage> createState() => _NewRequestPageState();
}
class _NewRequestPageState extends State<NewRequestPage> {
  String? id, code, selected;
  bool saving = false;
  String? error;
  @override
  void initState() {
    super.initState();
    id = widget.existingRequestId;
    code = widget.existingCode;
  }
  Future<void> create() async {
    setState(() { saving = true; error = null; });
    try {
      final data = await widget.session.api.post('/solicitudes', {'pacienteId': widget.patientId});
      if (mounted) setState(() { id = data['id'].toString(); code = data['codigo'].toString(); });
    } catch (e) { if (mounted) setState(() => error = e.toString()); }
    finally { if (mounted) setState(() => saving = false); }
  }
  Future<void> choose() async {
    if (id == null || selected == null) return;
    setState(() {saving = true; error = null;});
    try {
      await widget.session.api.put('/solicitudes/$id/modalidad', {'modalidad': selected});
      if (!mounted) return;
      showMessage(context, 'Modalidad guardada en el expediente $code.');
      // Las siguientes etapas requieren formulario/cámara y se integran por separado.
    } catch (e) { if (mounted) setState(() => error = e.toString()); }
    finally { if (mounted) setState(() => saving = false); }
  }
  @override
  Widget build(BuildContext context) => ContigoScaffold(
    title: id == null ? 'Nueva solicitud de atención' : 'Elegir modalidad',
    child: ListView(padding: const EdgeInsets.all(20), children: [
      const SizedBox(height: 18),
      if (id == null) ...[
        const Text('Selecciona el niño para crear una solicitud',
          style: TextStyle(fontSize: 20, fontWeight: FontWeight.w700,
            color: ContigoColors.vino)),
        const SizedBox(height: 16),
        ContigoPanel(color: ContigoColors.amarillo,
          child: Text(widget.patientName)),
        const SizedBox(height: 25),
        const Text('Crearemos una solicitud vinculada a este niño. Los datos se guardarán en un solo expediente.'),
        const SizedBox(height: 24),
        ElevatedButton(onPressed: saving ? null : create, child: const Text('Crear solicitud')),
      ] else ...[
        Text('Solicitud ${code ?? 'existente'}', style: const TextStyle(fontWeight: FontWeight.bold)),
        const SizedBox(height: 18),
        const Text('¿Cómo deseas completar tu solicitud?',
          style: TextStyle(fontSize: 22, fontWeight: FontWeight.bold,
            color: ContigoColors.vinoOscuro)),
        const SizedBox(height: 20),
        RadioListTile<String>(title: const Text('Llenar en la aplicación'),
          subtitle: const Text('Responde las preguntas paso a paso.'),
          value: 'app', groupValue: selected,
          onChanged: (v) => setState(() => selected = v)),
        RadioListTile<String>(title: const Text('Fotografiar formularios llenos'),
          subtitle: const Text('Captura formularios completados a mano.'),
          value: 'fotos', groupValue: selected,
          onChanged: (v) => setState(() => selected = v)),
        const SizedBox(height: 22),
        const ContigoPanel(color: ContigoColors.azul,
          child: Text('Puedes guardar tu avance y continuar después.')),
        const SizedBox(height: 22),
        ElevatedButton(onPressed: saving || selected == null ? null : choose,
          child: const Text('Guardar modalidad')),
        const SizedBox(height: 12),
        const Text('El cuestionario médico y la cámara se añadirán en las próximas etapas.',
          style: TextStyle(fontSize: 12), textAlign: TextAlign.center),
      ],
      if (saving) const LinearProgressIndicator(),
      if (error != null) ErrorNotice(error!),
    ]),
  );
}
