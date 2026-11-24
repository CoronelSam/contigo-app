import 'package:flutter/material.dart';
import '../../core/auth/session.dart';
import '../../core/theme/contigo_theme.dart';
import '../../core/widgets/ui.dart';

class ProfilePage extends StatefulWidget {
  final Session session;
  const ProfilePage({super.key, required this.session});
  @override
  State<ProfilePage> createState() => _ProfilePageState();
}
class _ProfilePageState extends State<ProfilePage> {
  late Future<dynamic> profile;
  String? error;
  @override
  void initState() { super.initState(); profile = widget.session.api.get('/me'); }
  @override
  Widget build(BuildContext context) => ContigoScaffold(title: 'Perfil y configuración',
    child: FutureBuilder<dynamic>(future: profile, builder: (context, snapshot) {
      if (snapshot.connectionState != ConnectionState.done) return const Center(child: CircularProgressIndicator());
      if (snapshot.hasError) return Center(child: ErrorNotice(snapshot.error.toString()));
      final user = snapshot.data as Map<String, dynamic>;
      return ListView(padding: const EdgeInsets.all(18), children: [
        ContigoPanel(color: ContigoColors.amarillo, child: Column(children: [
          const Icon(Icons.account_circle, color: ContigoColors.vino, size: 54),
          Text('${user['nombres']} ${user['apellidos']}',
            style: const TextStyle(fontSize: 20, fontWeight: FontWeight.bold)),
          Text(user['correo']?.toString() ?? ''),
          Text(user['telefono']?.toString() ?? ''),
        ])),
        const SizedBox(height: 16),
        ListTile(leading: const Icon(Icons.language), title: const Text('Idioma'),
          subtitle: Text(user['idioma'] == 'en' ? 'English' : 'Español'),
          onTap: () => showMessage(context, 'La configuración de idioma se integrará después.')),
        ListTile(leading: const Icon(Icons.notifications_outlined),
          title: const Text('Notificaciones'), onTap: () => showMessage(context,
            'Las preferencias de notificación se integrarán en la etapa 5.')),
        ListTile(leading: const Icon(Icons.lock_outline),
          title: const Text('Cambiar contraseña'), onTap: () => _passwordDialog()),
        const SizedBox(height: 15),
        OutlinedButton.icon(onPressed: () async {
          await widget.session.signOut();
          if (context.mounted) Navigator.pop(context);
        }, icon: const Icon(Icons.logout), label: const Text('Cerrar sesión')),
        if (error != null) ErrorNotice(error!),
      ]);
    }));

  Future<void> _passwordDialog() async {
    final current = TextEditingController(), next = TextEditingController();
    await showDialog<void>(context: context, builder: (ctx) => AlertDialog(
      title: const Text('Cambiar contraseña'),
      content: Column(mainAxisSize: MainAxisSize.min, children: [
        TextField(controller: current, obscureText: true,
          decoration: fieldDecoration('Contraseña actual')),
        const SizedBox(height: 12),
        TextField(controller: next, obscureText: true,
          decoration: fieldDecoration('Nueva contraseña (10 o más caracteres)')),
      ]),
      actions: [
        TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Cancelar')),
        TextButton(onPressed: () async {
          try {
            if (next.text.length < 10) throw Exception('Mínimo 10 caracteres');
            await widget.session.api.patch('/me/password', {'actual': current.text, 'nueva': next.text});
            if (ctx.mounted) Navigator.pop(ctx);
            if (mounted) showMessage(context, 'Contraseña actualizada');
          } catch (e) { if (mounted) setState(() => error = e.toString()); }
        }, child: const Text('Guardar')),
      ],
    ));
    current.dispose();next.dispose();
  }
}
