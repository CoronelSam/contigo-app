import 'package:flutter/material.dart';
import '../../core/auth/session.dart';
import '../../core/theme/contigo_theme.dart';
import '../../core/widgets/ui.dart';
import '../pacientes/patients_page.dart';
import '../perfil/profile_page.dart';

class FamilyHome extends StatefulWidget {
  final Session session;
  const FamilyHome({super.key, required this.session});
  @override
  State<FamilyHome> createState() => _FamilyHomeState();
}

class _FamilyHomeState extends State<FamilyHome> {
  Future<dynamic>? summary;
  @override
  void initState() {
    super.initState();
    reload();
  }

  void reload() =>
      setState(() => summary = widget.session.api.get('/me/resumen'));

  void openPatients({bool create = false}) => Navigator.push(
          context,
          MaterialPageRoute(
              builder: (_) =>
                  PatientsPage(session: widget.session, startCreate: create)))
      .then((_) => reload());

  @override
  Widget build(BuildContext context) => ContigoScaffold(
        title: 'CONTIGO',
        actions: [
          IconButton(
              onPressed: () => Navigator.push(
                  context,
                  MaterialPageRoute(
                      builder: (_) => ProfilePage(session: widget.session))),
              icon: const Icon(Icons.person_outline),
              tooltip: 'Mi perfil'),
        ],
        child: RefreshIndicator(
            onRefresh: () async {
              reload();
              await summary;
            },
            child: ListView(padding: const EdgeInsets.all(18), children: [
              const SizedBox(height: 14),
              Text('¡Hola, ${widget.session.user?['nombres'] ?? 'familia'}!',
                  style: const TextStyle(
                      fontSize: 26,
                      fontWeight: FontWeight.w800,
                      color: ContigoColors.vinoOscuro)),
              const Text('Estamos contigo en cada paso de tu solicitud.'),
              const SizedBox(height: 25),
              FutureBuilder<dynamic>(
                  future: summary,
                  builder: (context, snapshot) {
                    if (snapshot.connectionState != ConnectionState.done)
                      return const LinearProgressIndicator();
                    if (snapshot.hasError)
                      return ErrorNotice(snapshot.error.toString());
                    final data = snapshot.data as Map<String, dynamic>;
                    final counts =
                        data['contadores'] as Map<String, dynamic>? ?? {};
                    return ContigoPanel(
                        color: ContigoColors.azul,
                        child: Text(
                            'Niños registrados: ${counts['ninos'] ?? 0}  ·  Solicitudes abiertas: ${counts['solicitudesAbiertas'] ?? 0}',
                            style:
                                const TextStyle(fontWeight: FontWeight.w600)));
                  }),
              const SizedBox(height: 16),
              _tile('Nueva solicitud', Icons.note_add_outlined,
                  ContigoColors.rosa, () => openPatients()),
              _tile('Mis niños', Icons.people_outline, ContigoColors.azul,
                  () => openPatients()),
              _tile(
                  'Documentos',
                  Icons.folder_outlined,
                  ContigoColors.amarillo,
                  () => showMessage(context,
                      'Los documentos estarán disponibles en la etapa 4.')),
              _tile(
                  'Seguimiento',
                  Icons.timeline,
                  ContigoColors.lila,
                  () => showMessage(
                      context, 'El seguimiento se integrará en la etapa 5.')),
            ])),
      );

  Widget _tile(String name, IconData icon, Color color, VoidCallback onTap) =>
      Padding(
        padding: const EdgeInsets.only(bottom: 12),
        child: Material(
            color: color,
            borderRadius: BorderRadius.circular(16),
            child: ListTile(
                contentPadding: const EdgeInsets.all(13),
                leading: Icon(icon, color: ContigoColors.vino, size: 32),
                title: Text(name,
                    style: const TextStyle(fontWeight: FontWeight.bold)),
                trailing: const Icon(Icons.chevron_right),
                onTap: onTap)),
      );
}
