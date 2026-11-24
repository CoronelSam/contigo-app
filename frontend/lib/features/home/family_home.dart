import 'package:flutter/material.dart';
import '../../core/auth/session.dart';
import '../../core/theme/contigo_theme.dart';
import '../../core/widgets/ui.dart';
import '../familia/widgets/step_header.dart';
import '../pacientes/patients_page.dart';
import '../perfil/profile_page.dart';

class FamilyHome extends StatefulWidget {
  final Session session;
  const FamilyHome({super.key, required this.session});
  @override
  State<FamilyHome> createState() => _FamilyHomeState();
}

class _FamilyHomeState extends State<FamilyHome> {
  late Future<dynamic> summary;
  @override
  void initState() { super.initState(); _reload(); }

  void _reload() {
    summary = widget.session.api.get('/me/resumen');
    if (mounted) setState(() {});
  }

  Future<void> _openPatients({bool newRequest = false}) async {
    await Navigator.push<void>(context, MaterialPageRoute(
      builder: (_) => PatientsPage(session: widget.session, requestFlow: newRequest),
    ));
    if (mounted) _reload();
  }

  @override
  Widget build(BuildContext context) {
    final name = (widget.session.user?['nombres'] ?? 'familia').toString().trim();
    final firstName = name.isEmpty ? 'familia' : name.split(' ').first;
    return ContigoScaffold(
      title: 'CONTIGO',
      actions: [IconButton(
        tooltip: 'Mi perfil', icon: const Icon(Icons.person_outline_rounded),
        onPressed: () => Navigator.push<void>(context, MaterialPageRoute(
          builder: (_) => ProfilePage(session: widget.session),
        )),
      )],
      child: RefreshIndicator(
        onRefresh: () async {
          _reload();
          try { await summary; } catch (_) { /* Mostrar error en pantalla. */ }
        },
        child: ListView(
          physics: const AlwaysScrollableScrollPhysics(),
          padding: const EdgeInsets.all(18),
          children: [
            FamilyStepHeader(title: '¡Hola, $firstName!',
              subtitle: 'Estamos contigo en cada paso de tu solicitud.',
              screen: 7, icon: Icons.favorite_border_rounded),
            const SizedBox(height: 16),
            FutureBuilder<dynamic>(future: summary, builder: (context, snapshot) {
              if (snapshot.connectionState != ConnectionState.done) {
                return const LinearProgressIndicator();
              }
              if (snapshot.hasError) {
                return Column(children: [ErrorNotice(snapshot.error.toString()),
                  TextButton(onPressed: _reload, child: const Text('Reintentar'))]);
              }
              final data = snapshot.data is Map
                  ? Map<String, dynamic>.from(snapshot.data as Map) : <String, dynamic>{};
              final counts = data['contadores'] is Map
                  ? Map<String, dynamic>.from(data['contadores'] as Map) : <String, dynamic>{};
              return Row(children: [
                Expanded(child: _counter('Mis niños', '${counts['ninos'] ?? 0}',
                    ContigoColors.azul, Icons.child_care_rounded)),
                const SizedBox(width: 10),
                Expanded(child: _counter('Solicitudes abiertas',
                    '${counts['solicitudesAbiertas'] ?? 0}',
                    ContigoColors.rosa, Icons.assignment_outlined)),
              ]);
            }),
            const SizedBox(height: 22),
            const Text('¿Qué deseas hacer?', style: TextStyle(fontSize: 19,
                color: ContigoColors.vinoOscuro, fontWeight: FontWeight.w800)),
            const SizedBox(height: 12),
            _shortcut('Nueva solicitud', 'Inicia o continúa una solicitud de atención',
                Icons.note_add_outlined, ContigoColors.rosa,
                () => _openPatients(newRequest: true)),
            _shortcut('Mis niños', 'Consulta o registra a tus niños',
                Icons.people_outline_rounded, ContigoColors.azul,
                () => _openPatients()),
            _shortcut('Documentos', 'Disponible en la etapa 4',
                Icons.folder_outlined, ContigoColors.amarillo,
                () => showMessage(context, 'La gestión de documentos se integrará en la etapa 4.')),
            _shortcut('Seguimiento', 'Disponible en la etapa 5',
                Icons.timeline_rounded, ContigoColors.lila,
                () => showMessage(context, 'El seguimiento se integrará en la etapa 5.')),
          ],
        ),
      ),
    );
  }

  Widget _counter(String label, String value, Color color, IconData icon) =>
      ContigoPanel(color: color, child: Column(
        crossAxisAlignment: CrossAxisAlignment.start, children: [
          Icon(icon, color: ContigoColors.vino),
          const SizedBox(height: 8),
          Text(value, style: const TextStyle(fontSize: 28,
              fontWeight: FontWeight.w800, color: ContigoColors.vinoOscuro)),
          Text(label, style: const TextStyle(fontSize: 12)),
        ],
      ));

  Widget _shortcut(String name, String description, IconData icon,
      Color color, VoidCallback onTap) => Padding(
    padding: const EdgeInsets.only(bottom: 12),
    child: Material(color: color, borderRadius: BorderRadius.circular(18),
      child: InkWell(onTap: onTap, borderRadius: BorderRadius.circular(18),
        child: Padding(padding: const EdgeInsets.all(15), child: Row(children: [
          Icon(icon, color: ContigoColors.vino, size: 30),
          const SizedBox(width: 14),
          Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start,
            children: [Text(name, style: const TextStyle(fontSize: 16,
                fontWeight: FontWeight.w800)),
              Text(description, style: const TextStyle(fontSize: 12))])),
          const Icon(Icons.chevron_right_rounded),
        ])),
      ),
    ),
  );
}
