import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../../core/auth/session.dart';
import '../../core/theme/contigo_theme.dart';
import '../../core/widgets/ui.dart';

class AccessScreen extends StatefulWidget {
  final Session session;
  const AccessScreen({super.key, required this.session});
  @override
  State<AccessScreen> createState() => _AccessScreenState();
}

class _AccessScreenState extends State<AccessScreen> {
  int step = 0; // 0 bienvenida, 1 idioma, 2 login, 3 registro, 4 recuperar
  String language = 'es';
  final mail = TextEditingController();
  final pass = TextEditingController();
  final names = TextEditingController();
  final surnames = TextEditingController();
  final phone = TextEditingController();
  final confirm = TextEditingController();
  bool accepts = false;
  bool loading = false;
  String? error;
  final keyForm = GlobalKey<FormState>();
  @override
  void dispose() {
    for (final c in [mail, pass, names, surnames, phone, confirm]) { c.dispose(); }
    super.dispose();
  }

  Future<void> perform(Future<void> Function() action) async {
    setState(() { loading = true; error = null; });
    try { await action(); } catch (e) { if (mounted) setState(() => error = e.toString()); }
    finally { if (mounted) setState(() => loading = false); }
  }

  Widget entry(TextEditingController controller, String label,
      {bool secret = false, TextInputType? type, String? Function(String?)? validator}) =>
    Padding(padding: const EdgeInsets.only(bottom: 12), child: TextFormField(
      controller: controller, obscureText: secret, keyboardType: type,
      decoration: fieldDecoration(label), validator: validator,
    ));
  String? validateRequired(String? v) => (v == null || v.trim().isEmpty) ? 'Este campo es obligatorio' : null;

  @override
  Widget build(BuildContext context) => ContigoScaffold(
    title: 'CONTIGO',
    child: SingleChildScrollView(padding: const EdgeInsets.all(22),
      child: Form(key: keyForm, child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        const SizedBox(height: 30),
        Icon(step == 0 ? Icons.volunteer_activism : Icons.favorite_border_rounded,
          size: 72, color: ContigoColors.vino),
        const SizedBox(height: 16),
        Text(_title(), textAlign: TextAlign.center, style: const TextStyle(
          fontSize: 26, fontWeight: FontWeight.w800, color: ContigoColors.vinoOscuro)),
        const SizedBox(height: 10),
        if (step == 0) ...[
          const Text('Digitalización y seguimiento de solicitudes de atención infantil en Honduras.',
            textAlign: TextAlign.center),
          const SizedBox(height: 45),
          ElevatedButton(onPressed: () => setState(() => step = 1), child: const Text('Comenzar')),
        ] else if (step == 1) ...[
          const Text('Elige el idioma de la aplicación', textAlign: TextAlign.center),
          const SizedBox(height: 20),
          RadioListTile<String>(title: const Text('Español'), value: 'es',
            groupValue: language, onChanged: (v) => setState(() => language = v!)),
          RadioListTile<String>(title: const Text('English'), value: 'en',
            groupValue: language, onChanged: (v) => setState(() => language = v!)),
          const SizedBox(height: 18),
          ElevatedButton(onPressed: () async {
            if (language == 'en') {
              showMessage(context, 'La interfaz en inglés estará disponible en una próxima etapa.');
              return;
            }
            final prefs = await SharedPreferences.getInstance();
            await prefs.setString('idioma', language);
            if (!context.mounted) return;
            setState(() => step = 2);
          }, child: const Text('Continuar')),
          const SizedBox(height: 8),
          const Text('La versión inglesa de las pantallas se implementará en una fase posterior.',
            textAlign: TextAlign.center, style: TextStyle(fontSize: 12)),
        ] else if (step == 2) ...[
          entry(mail, 'Correo electrónico', type: TextInputType.emailAddress, validator: validateRequired),
          entry(pass, 'Contraseña', secret: true, validator: validateRequired),
          Align(alignment: Alignment.centerRight, child: TextButton(
            onPressed: () => setState(() => step = 4), child: const Text('Olvidé mi contraseña'))),
          ElevatedButton(onPressed: loading ? null : () {
            if (keyForm.currentState!.validate()) perform(() => widget.session.signIn(mail.text, pass.text));
          }, child: const Text('Iniciar sesión')),
          TextButton(onPressed: () => setState(() { step = 3; error = null; }),
            child: const Text('Crear cuenta')),
        ] else if (step == 3) ...[
          entry(names, 'Nombres', validator: validateRequired),
          entry(surnames, 'Apellidos', validator: validateRequired),
          entry(phone, 'Teléfono (+504)', type: TextInputType.phone,
            validator: (s) => RegExp(r'^(\+504)?\d{8}$').hasMatch((s ?? '').replaceAll(' ', ''))
              ? null : 'Ingresa 8 dígitos hondureños'),
          entry(mail, 'Correo electrónico', type: TextInputType.emailAddress, validator: validateRequired),
          entry(pass, 'Contraseña (mínimo 10 caracteres)', secret: true,
            validator: (s) => (s?.length ?? 0) >= 10 ? null : 'Mínimo 10 caracteres'),
          entry(confirm, 'Confirmar contraseña', secret: true,
            validator: (s) => s == pass.text ? null : 'Las contraseñas no coinciden'),
          CheckboxListTile(value: accepts,
            onChanged: (v) => setState(() => accepts = v ?? false),
            title: const Text('Acepto los términos y la política de privacidad'),
            controlAffinity: ListTileControlAffinity.leading),
          ElevatedButton(onPressed: loading ? null : () {
            if (!keyForm.currentState!.validate()) return;
            if (!accepts) { setState(() => error = 'Debes aceptar los términos y la política de privacidad'); return; }
            perform(() => widget.session.signUp({
              'nombres': names.text.trim(), 'apellidos': surnames.text.trim(),
              'telefono': phone.text.trim(), 'correo': mail.text.trim(),
              'contrasena': pass.text, 'idioma': language,
              'aceptaTerminos': true, 'terminosVersion': '2026-11',
            }));
          }, child: const Text('Crear cuenta')),
          TextButton(onPressed: () => setState(() => step = 2), child: const Text('Ya tengo cuenta')),
        ] else if (step == 4) ...[
          const Text('Te enviaremos instrucciones si existe una cuenta con ese correo.',
            textAlign: TextAlign.center),
          const SizedBox(height: 20),
          entry(mail, 'Correo electrónico', type: TextInputType.emailAddress, validator: validateRequired),
          ElevatedButton(onPressed: loading ? null : () {
            if (!keyForm.currentState!.validate()) return;
            perform(() async {
              await widget.session.api.post('/auth/password/forgot', {'correo': mail.text.trim()});
              if (context.mounted) showMessage(context, 'Si el correo existe, recibirás instrucciones.');
            });
          }, child: const Text('Solicitar recuperación')),
          TextButton(onPressed: () => setState(() => step = 2), child: const Text('Volver a iniciar sesión')),
        ],
        if (loading) const Padding(padding: EdgeInsets.all(12), child: LinearProgressIndicator()),
        if (error != null) ErrorNotice(error!),
      ]))),
  );

  String _title() => switch (step) {
    0 => 'Bienvenido a CONTIGO', 1 => 'Selecciona tu idioma',
    2 => 'Iniciar sesión', 3 => 'Crear cuenta', _ => 'Recuperar contraseña',
  };
}
