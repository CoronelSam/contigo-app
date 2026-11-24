import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../../core/api/api_client.dart';
import '../../core/auth/session.dart';
import '../../core/theme/contigo_theme.dart';
import '../../core/widgets/ui.dart';
import '../familia/widgets/step_header.dart';
import '../solicitudes/new_request_page.dart';

class PatientsPage extends StatefulWidget {
  final Session session;
  final bool startCreate;
  final bool requestFlow;
  const PatientsPage({super.key, required this.session,
    this.startCreate = false, this.requestFlow = false});
  @override
  State<PatientsPage> createState() => _PatientsPageState();
}

class _PatientsPageState extends State<PatientsPage> {
  late Future<dynamic> patients;
  @override
  void initState() {
    super.initState();
    _reload();
    if (widget.startCreate) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) _create();
      });
    }
  }
  void _reload() {
    patients = widget.session.api.get('/pacientes');
    if (mounted) setState(() {});
  }
  Future<void> _create() async {
    await Navigator.push<void>(context, MaterialPageRoute(
      builder: (_) => PatientForm(session: widget.session)));
    if (mounted) _reload();
  }

  Future<void> _select(Map<String, dynamic> patient) async {
    try {
      final detail = await widget.session.api.get('/pacientes/${patient['id']}');
      if (!mounted) return;
      final guardians = detail is Map && detail['tutores'] is List
          ? detail['tutores'] as List : <dynamic>[];
      final hasGuardian = guardians.any((t) => t is Map && t['esResponsableLegal'] == true);
      final id = patient['id'].toString();
      final childName = patient['nombreCompleto'].toString();
      if (!hasGuardian) {
        await Navigator.push<void>(context, MaterialPageRoute(
          builder: (_) => GuardianForm(session: widget.session,
            patientId: id, childName: childName)));
      } else {
        final latest = patient['ultimaSolicitud'] is Map
            ? Map<String, dynamic>.from(patient['ultimaSolicitud'] as Map)
            : <String, dynamic>{};
        await Navigator.push<void>(context, MaterialPageRoute(
          builder: (_) => NewRequestPage(session: widget.session,
            patientId: id, patientName: childName,
            existingRequestId: latest['id']?.toString(),
            existingCode: latest['codigo']?.toString()),
        ));
      }
      if (mounted) _reload();
    } catch (e) {
      if (mounted) showMessage(context, e.toString());
    }
  }

  @override
  Widget build(BuildContext context) => ContigoScaffold(
    title: widget.requestFlow ? 'Nueva solicitud' : 'Mis niños',
    child: FutureBuilder<dynamic>(future: patients, builder: (context, snap) {
      if (snap.connectionState != ConnectionState.done) {
        return const Center(child: CircularProgressIndicator());
      }
      if (snap.hasError) {
        return Center(child: Padding(padding: const EdgeInsets.all(18),
          child: Column(mainAxisSize: MainAxisSize.min, children: [
            ErrorNotice(snap.error.toString()),
            TextButton(onPressed: _reload, child: const Text('Reintentar')),
          ])));
      }
      final response = snap.data is Map
          ? Map<String, dynamic>.from(snap.data as Map) : <String, dynamic>{};
      final values = response['datos'] is List
          ? response['datos'] as List : <dynamic>[];
      return RefreshIndicator(onRefresh: () async {
        _reload();
        try { await patients; } catch (_) { /* Ver aviso de error. */ }
      }, child: ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.all(18), children: [
          FamilyStepHeader(screen: 8, icon: Icons.people_outline_rounded,
            title: widget.requestFlow ? 'Selecciona un niño' : 'Mis niños',
            subtitle: widget.requestFlow
                ? 'Elige el niño para crear o continuar su solicitud.'
                : 'Consulta los niños registrados y sus solicitudes.'),
          const SizedBox(height: 16),
          for (final raw in values)
            if (raw is Map) _patientCard(Map<String, dynamic>.from(raw)),
          if (values.isEmpty) ...[
            const ContigoPanel(color: ContigoColors.azul,
              child: Text('Aún no tienes niños registrados. Comienza agregando uno.')),
            const SizedBox(height: 16),
          ],
          ElevatedButton.icon(onPressed: _create,
            icon: const Icon(Icons.add_circle_outline),
            label: const Text('Registrar niño')),
        ],
      ));
    }),
  );

  Widget _patientCard(Map<String, dynamic> patient) {
    final age = patient['edad'] is Map ? patient['edad'] as Map : <String, dynamic>{};
    final latest = patient['ultimaSolicitud'] is Map
        ? patient['ultimaSolicitud'] as Map : <String, dynamic>{};
    final name = patient['nombreCompleto']?.toString() ?? 'Niño registrado';
    return Padding(padding: const EdgeInsets.only(bottom: 12),
      child: Card(child: ListTile(
        contentPadding: const EdgeInsets.all(13),
        leading: const CircleAvatar(backgroundColor: ContigoColors.azul,
          child: Icon(Icons.child_care_rounded, color: ContigoColors.vino)),
        title: Text(name, style: const TextStyle(fontWeight: FontWeight.w700)),
        subtitle: Text('${age['anios'] ?? '—'} años · '
            '${latest['estadoFamilia'] ?? 'Sin solicitud'}'),
        trailing: const Icon(Icons.chevron_right_rounded),
        onTap: () => _select(patient),
      )),
    );
  }
}

class PatientForm extends StatefulWidget {
  final Session session;
  const PatientForm({super.key, required this.session});
  @override
  State<PatientForm> createState() => _PatientFormState();
}

class _PatientFormState extends State<PatientForm> {
  final form = GlobalKey<FormState>();
  final names = TextEditingController();
  final father = TextEditingController();
  final mother = TextEditingController();
  final address = TextEditingController();
  DateTime? birth;
  String sex = 'femenino';
  String? department, town, error;
  List<Map<String, dynamic>> departments = [], towns = [];
  bool saving = false, loadingTowns = false;

  @override
  void initState() { super.initState(); _departments(); }
  @override
  void dispose() {
    names.dispose(); father.dispose(); mother.dispose(); address.dispose();
    super.dispose();
  }
  Future<void> _departments() async {
    try {
      final result = await widget.session.api.get('/catalogos/departamentos');
      if (mounted) setState(() => departments =
          (result as List).map((e) => Map<String, dynamic>.from(e as Map)).toList());
    } catch (e) { if (mounted) setState(() => error = e.toString()); }
  }
  Future<void> _towns(String code) async {
    setState(() { department = code; town = null; towns = []; loadingTowns = true; });
    try {
      final result = await widget.session.api.get('/catalogos/departamentos/$code/municipios');
      if (mounted && department == code) setState(() => towns =
          (result as List).map((e) => Map<String, dynamic>.from(e as Map)).toList());
    } catch (e) { if (mounted) setState(() => error = e.toString()); }
    finally { if (mounted && department == code) setState(() => loadingTowns = false); }
  }
  String _date(DateTime d) => '${d.year.toString().padLeft(4, '0')}-'
      '${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';

  Future<void> _save({bool confirmDuplicate = false}) async {
    if (!form.currentState!.validate()) return;
    if (birth == null || department == null || town == null) {
      setState(() => error = 'Selecciona fecha de nacimiento, departamento y municipio.');
      return;
    }
    setState(() { saving = true; error = null; });
    try {
      final result = await widget.session.api.post('/pacientes', {
        'nombres': names.text.trim(),
        'apellidoPaterno': father.text.trim(),
        'apellidoMaterno': mother.text.trim().isEmpty ? null : mother.text.trim(),
        'fechaNacimiento': _date(birth!),
        'sexo': sex, 'departamentoCodigo': department,
        'municipioCodigo': town,
        'direccion': address.text.trim().isEmpty ? null : address.text.trim(),
        if (confirmDuplicate) 'confirmarDuplicado': true,
      });
      if (!mounted) return;
      final id = (result as Map)['id'].toString();
      await Navigator.pushReplacement<void, void>(context, MaterialPageRoute(
        builder: (_) => GuardianForm(session: widget.session,
          patientId: id, childName: '${names.text.trim()} ${father.text.trim()}'),
      ));
    } on ApiException catch (e) {
      if (!mounted) return;
      if (e.status == 409 && e.code == 'PACIENTE_POSIBLE_DUPLICADO' && !confirmDuplicate) {
        final another = await showDialog<bool>(context: context, builder: (ctx) =>
          AlertDialog(title: const Text('Posible registro duplicado'),
            content: const Text('Ya hay un niño con datos similares. '
                'Revisa antes de crear otro registro.'), actions: [
              TextButton(onPressed: () => Navigator.pop(ctx, false),
                child: const Text('Cancelar')),
              TextButton(onPressed: () => Navigator.pop(ctx, true),
                child: const Text('Es otro niño')),
            ]));
        if (another == true && mounted) {
          setState(() => saving = false);
          await _save(confirmDuplicate: true);
        }
      } else { setState(() => error = e.message); }
    } catch (e) { if (mounted) setState(() => error = e.toString()); }
    finally { if (mounted) setState(() => saving = false); }
  }

  Widget _field(TextEditingController controller, String label, {bool mandatory = true}) =>
    Padding(padding: const EdgeInsets.only(bottom: 12),
      child: TextFormField(controller: controller,
        decoration: fieldDecoration(label),
        textCapitalization: TextCapitalization.words,
       validator: (v) => mandatory && (v == null || v.trim().isEmpty)
    ? 'Campo obligatorio'
    : null,));

  @override
  Widget build(BuildContext context) => ContigoScaffold(title: 'Registrar niño',
    child: ListView(padding: const EdgeInsets.all(18), children: [
      const FamilyStepHeader(screen: 9, title: 'Datos del niño',
        subtitle: 'Completa la información del niño que solicita atención.',
        icon: Icons.child_care_outlined),
      const SizedBox(height: 18),
      Form(key: form, child: Column(children: [
        _field(names, 'Nombres *'),
        _field(father, 'Apellido paterno *'),
        _field(mother, 'Apellido materno', mandatory: false),
        Card(child: ListTile(
          title: Text(birth == null ? 'Fecha de nacimiento *'
            : 'Nacimiento: ${birth!.day}/${birth!.month}/${birth!.year}'),
          trailing: const Icon(Icons.calendar_month_rounded,
              color: ContigoColors.vino),
          onTap: () async {
            final now = DateTime.now();
            final picked = await showDatePicker(context: context,
              initialDate: birth ?? DateTime(now.year - 8),
              firstDate: DateTime(1900), lastDate: now);
            if (picked != null && mounted) setState(() => birth = picked);
          },
        )),
        const SizedBox(height: 12),
        DropdownButtonFormField<String>(initialValue: sex,
          decoration: fieldDecoration('Sexo *'), items: const [
            DropdownMenuItem(value: 'femenino', child: Text('Femenino')),
            DropdownMenuItem(value: 'masculino', child: Text('Masculino')),
          ], onChanged: (v) { if (v != null) setState(() => sex = v); }),
        const SizedBox(height: 12),
        DropdownButtonFormField<String>(initialValue: department,
          isExpanded: true, decoration: fieldDecoration('Departamento *'),
          items: [for (final d in departments) DropdownMenuItem(
            value: d['codigo'].toString(), child: Text(d['nombre'].toString()))],
          onChanged: (v) { if (v != null) _towns(v); }),
        const SizedBox(height: 12),
        if (loadingTowns) const LinearProgressIndicator(),
        DropdownButtonFormField<String>(key: ValueKey(department),
          initialValue: town, isExpanded: true,
          decoration: fieldDecoration('Municipio *'),
          items: [for (final m in towns) DropdownMenuItem(
            value: m['codigo'].toString(), child: Text(m['nombre'].toString()))],
          onChanged: (v) => setState(() => town = v)),
        const SizedBox(height: 12),
        _field(address, 'Dirección', mandatory: false),
      ])),
      if (error != null) ErrorNotice(error!),
      if (saving) const LinearProgressIndicator(),
      const SizedBox(height: 10),
      ElevatedButton(onPressed: saving ? null : _save,
        child: const Text('Continuar')),
    ]),
  );
}

class GuardianForm extends StatefulWidget {
  final Session session;
  final String patientId;
  final String childName;
  const GuardianForm({super.key, required this.session,
    required this.patientId, required this.childName});
  @override
  State<GuardianForm> createState() => _GuardianFormState();
}

class _GuardianFormState extends State<GuardianForm> {
  final form = GlobalKey<FormState>();
  final names = TextEditingController();
  final surnames = TextEditingController();
  final phone = TextEditingController();
  final email = TextEditingController();
  final address = TextEditingController();
  String? relationship, error;
  List<Map<String, dynamic>> relationships = [];
  bool confirmLegal = false, busy = false;

  @override
  void initState() { super.initState(); _load(); }
  @override
  void dispose() {
    names.dispose(); surnames.dispose(); phone.dispose();
    email.dispose(); address.dispose(); super.dispose();
  }
  Future<void> _load() async {
    try {
      final profile = await widget.session.api.get('/me');
      final catalog = await widget.session.api.get('/catalogos/parentesco');
      if (!mounted) return;
      names.text = profile['nombres']?.toString() ?? '';
      surnames.text = profile['apellidos']?.toString() ?? '';
      phone.text = profile['telefono']?.toString() ?? '';
      email.text = profile['correo']?.toString() ?? '';
      setState(() => relationships =
          (catalog as List).map((e) => Map<String, dynamic>.from(e as Map)).toList());
    } catch (e) { if (mounted) setState(() => error = e.toString()); }
  }
  Widget _entry(TextEditingController controller, String label,
      {bool mandatory = true, TextInputType? keyboard}) =>
    Padding(padding: const EdgeInsets.only(bottom: 12),
      child: TextFormField(controller: controller,
        keyboardType: keyboard, decoration: fieldDecoration(label),
        inputFormatters: controller == phone
          ? [FilteringTextInputFormatter.allow(RegExp(r'[0-9+]'))] : null,
        validator: (v) {
          final value = v?.trim() ?? '';
          if (mandatory && value.isEmpty) return 'Campo obligatorio';
          if (controller == phone && value.isNotEmpty &&
              !RegExp(r'^(\+504)?[0-9]{8}$').hasMatch(value)) {
            return 'Ingresa ocho dígitos (opcional +504)';
          }
          if (controller == email && value.isNotEmpty &&
              !RegExp(r'^[^@ ]+@[^@ ]+\.[^@ ]+$').hasMatch(value)) {
            return 'Correo electrónico inválido';
          }
          return null;
        }));

  Future<void> _save() async {
    if (!form.currentState!.validate()) return;
    if (relationship == null || !confirmLegal) {
      setState(() => error = 'Selecciona el parentesco y confirma tu responsabilidad legal.');
      return;
    }
    setState(() { busy = true; error = null; });
    try {
      await widget.session.api.post('/pacientes/${widget.patientId}/tutores', {
        'esLaCuentaActual': true,
        'nombres': names.text.trim(), 'apellidos': surnames.text.trim(),
        'parentesco': relationship,
        'telefono': phone.text.trim().isEmpty ? null : phone.text.trim(),
        'correo': email.text.trim().isEmpty ? null : email.text.trim(),
        'direccion': address.text.trim().isEmpty ? null : address.text.trim(),
        'esResponsableLegal': true, 'confirmoResponsableLegal': true,
      });
      if (!mounted) return;
      await Navigator.pushReplacement<void, void>(context, MaterialPageRoute(
        builder: (_) => NewRequestPage(session: widget.session,
          patientId: widget.patientId, patientName: widget.childName),
      ));
    } catch (e) { if (mounted) setState(() => error = e.toString()); }
    finally { if (mounted) setState(() => busy = false); }
  }

  @override
  Widget build(BuildContext context) => ContigoScaffold(title: 'Responsable legal',
    child: ListView(padding: const EdgeInsets.all(18), children: [
      const FamilyStepHeader(screen: 10, title: 'Responsable legal',
        subtitle: 'Confirma los datos de quien acompaña al niño.',
        icon: Icons.family_restroom_rounded),
      const SizedBox(height: 16),
      ContigoPanel(color: ContigoColors.azul,
        child: Text('Niño: ${widget.childName}')),
      const SizedBox(height: 14),
      Form(key: form, child: Column(children: [
        _entry(names, 'Nombres *'),
        _entry(surnames, 'Apellidos *'),
        DropdownButtonFormField<String>(initialValue: relationship,
          isExpanded: true, decoration: fieldDecoration('Parentesco *'),
          items: [for (final r in relationships) DropdownMenuItem(
            value: r['codigo'].toString(), child: Text(r['etiqueta'].toString()))],
          onChanged: (v) => setState(() => relationship = v)),
        const SizedBox(height: 12),
        _entry(phone, 'Teléfono (+504)', mandatory: false,
          keyboard: TextInputType.phone),
        _entry(email, 'Correo electrónico', mandatory: false,
          keyboard: TextInputType.emailAddress),
        _entry(address, 'Dirección', mandatory: false),
      ])),
      CheckboxListTile(contentPadding: EdgeInsets.zero,
        controlAffinity: ListTileControlAffinity.leading, value: confirmLegal,
        onChanged: (v) => setState(() => confirmLegal = v ?? false),
        title: const Text('Confirmo que soy responsable legal del niño o niña.'),
      ),
      if (error != null) ErrorNotice(error!),
      if (busy) const LinearProgressIndicator(),
      const SizedBox(height: 12),
      ElevatedButton(onPressed: busy ? null : _save,
        child: const Text('Guardar y continuar')),
    ]),
  );
}
