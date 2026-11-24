import 'package:flutter/material.dart';
import 'core/auth/session.dart';
import 'core/theme/contigo_theme.dart';
import 'features/access/access_screen.dart';
import 'features/home/family_home.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(const ContigoApp());
}

class ContigoApp extends StatefulWidget {
  const ContigoApp({super.key});
  @override
  State<ContigoApp> createState() => _ContigoAppState();
}

class _ContigoAppState extends State<ContigoApp> {
  final Session session = Session();
  @override
  void initState() { super.initState(); session.initialize(); }
  @override
  Widget build(BuildContext context) => MaterialApp(
    title: 'CONTIGO', debugShowCheckedModeBanner: false,
    theme: createContigoTheme(),
    home: AnimatedBuilder(animation: session, builder: (context, _) {
      if (!session.initialized) return const Scaffold(body: Center(child: CircularProgressIndicator()));
      if (!session.authenticated) return AccessScreen(session: session);
      if (session.role == 'familia') return FamilyHome(session: session);
      return Scaffold(appBar: AppBar(title: const Text('CONTIGO')),
        body: Center(child: Padding(padding: const EdgeInsets.all(24), child: Column(
          mainAxisSize: MainAxisSize.min, children: [
            const Icon(Icons.construction_rounded, size: 54),
            const SizedBox(height: 14),
            Text('Módulo ${session.role} pendiente de implementar', textAlign: TextAlign.center),
            const SizedBox(height: 12),
            ElevatedButton(onPressed: session.signOut, child: const Text('Cerrar sesión')),
          ],
        ))));
    }),
  );
  @override
  void dispose() { session.api.dispose(); session.dispose(); super.dispose(); }
}
