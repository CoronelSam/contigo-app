import 'package:flutter/material.dart';
import '../../core/auth/session.dart';
import '../../core/theme/contigo_theme.dart';
import '../../core/widgets/ui.dart';
import '../solicitudes/new_request_page.dart';

class PatientsPage extends StatefulWidget {
  final Session session;
  final bool startCreate;
  const PatientsPage({super.key, required this.session, this.startCreate = false});
  @override
  State<PatientsPage> createState() => _PatientsPageState();
}

class _PatientsPageState extends State<PatientsPage> {
  late Future<dynamic> patients;
  @override
  void initState() { super.initState(); reload(); if (widget.startCreate) {
    WidgetsBinding.instance.addPostFrameCallback((_) => create());
  }}
  void reload() => setState(() => patients = widget.session.api.get('/pacientes'));
  Future<void> create() async {
    await Navigator.push(context, MaterialPageRoute(builder: (_) => PatientForm(session: widget.session)));
    if (mounted) reload();
  }
  @override
  Widget build(BuildContext context) => ContigoScaffold(title: 'Mis niños',
    child: FutureBuilder<dynamic>(future: patients, builder: (context, snapshot) {
      if (snapshot.connectionState != ConnectionState.done) return const Center(child: CircularProgressIndicator());
      if (snapshot.hasError) return Center(child: ErrorNotice(snapshot.error.toString()));
      final values = ((snapshot.data as Map<String, dynamic>)['datos'] as List<dynamic>);
      return ListView(padding: const EdgeInsets.all(18), children: [
        const Text('Niños registrados', style: TextStyle(fontSize: 23, fontWeight: FontWeight.bold,
          color: ContigoColors.vinoOscuro)),
        const SizedBox(height: 12),
        for (final raw in values) _patientCard(Map<String, dynamic>.from(raw as Map)),
        if (values.isEmpty) const ContigoPanel(child: Text('Aún no tienes niños registrados.')),
        const SizedBox(height: 16),
        ElevatedButton(onPressed: create, child: const Text('Registrar niño')),
      ]);
    }));
  Widget _patientCard(Map<String, dynamic> p) {
    final age = p['edad'] as Map?;
    return Padding(padding: const EdgeInsets.only(bottom: 12),
      child: Card(child: ListTile(
        leading: const CircleAvatar(backgroundColor: ContigoColors.azul,
          child: Icon(Icons.child_care, color: ContigoColors.vino)),
        title: Text(p['nombreCompleto'].toString()),
        subtitle: Text('${age?['anios'] ?? '?'} años · ${p['ultimaSolicitud']?['estadoFamilia'] ?? 'Sin solicitud'}'),
        trailing: const Icon(Icons.chevron_right),
        onTap: () => Navigator.push(context, MaterialPageRoute(
          builder: (_) => NewRequestPage(session: widget.session, patientId: p['id'].toString(),
            patientName: p['nombreCompleto'].toString(),
            existingRequestId: (p['ultimaSolicitud'] as Map?)?['id']?.toString(),
            existingCode: (p['ultimaSolicitud'] as Map?)?['codigo']?.toString()))).then((_) => reload()),
      )));
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
  String? department, town;
  List<Map<String, dynamic>> departments = [], towns = [];
  bool loading = false;
  String? error;

  @override
  void initState() { super.initState(); getDepartments(); }
  Future<void> getDepartments() async {
    try {
      final result = await widget.session.api.get('/catalogos/departamentos');
      if (mounted) setState(() => departments = (result as List).cast<Map<String,dynamic>>());
    } catch (e) { if (mounted) setState(() => error = e.toString()); }
  }
  Future<void> getTowns(String code) async {
    setState(() { department = code; town = null; towns = []; });
    try {
      final result = await widget.session.api.get('/catalogos/departamentos/$code/municipios');
      if (mounted) setState(() => towns = (result as List).cast<Map<String,dynamic>>());
    } catch (e) { if (mounted) setState(() => error = e.toString()); }
  }
  Future<void> save() async {
    if (!form.currentState!.validate()) return;
    if (birth == null || department == null || town == null) {
      setState(() => error = 'Selecciona fecha de nacimiento, departamento y municipio');return;
    }
    setState(() { loading = true; error = null; });
    try {
      final res = await widget.session.api.post('/pacientes', {
        'nombres': names.text.trim(), 'apellidoPaterno': father.text.trim(),
        'apellidoMaterno': mother.text.trim().isEmpty ? null : mother.text.trim(),
        'fechaNacimiento': '${birth!.year.toString().padLeft(4, '0')}-${birth!.month.toString().padLeft(2, '0')}-${birth!.day.toString().padLeft(2, '0')}',
        'sexo': sex, 'departamentoCodigo': department, 'municipioCodigo': town,
        'direccion': address.text.trim().isEmpty ? null : address.text.trim(),
      });
      if (!mounted) return;
      final patientId = (res as Map)['id'].toString();
      await Navigator.pushReplacement(context, MaterialPageRoute(
        builder: (_) => GuardianForm(session: widget.session, patientId: patientId,
          childName: '${names.text.trim()} ${father.text.trim()}')));
    } catch (e) { if (mounted) setState(() => error = e.toString()); }
    finally { if (mounted) setState(() => loading = false); }
  }

  Widget field(TextEditingController c, String label, {bool mandatory = true}) => Padding(
    padding: const EdgeInsets.only(bottom: 12), child: TextFormField(
      controller: c, decoration: fieldDecoration(label),
      validator: (v) => mandatory && (v == null || v.trim().isEmpty) ? 'Campo obligatorio' : null));

  @override
  Widget build(BuildContext context) => ContigoScaffold(title: 'Registrar niño',
    child: ListView(padding: const EdgeInsets.all(18), children: [
      Form(key: form, child: Column(children: [
        field(names, 'Nombres *'), field(father, 'Apellido paterno *'),
        field(mother, 'Apellido materno'),
        ListTile(title: Text(birth == null ? 'Fecha de nacimiento *' :
          'Nacimiento: ${birth!.day}/${birth!.month}/${birth!.year}'),
          trailing: const Icon(Icons.calendar_month), onTap: () async {
            final chosen = await showDatePicker(context: context,
              firstDate: DateTime(2000), lastDate: DateTime.now(), initialDate: birth ?? DateTime(2018));
            if (chosen != null) setState(() => birth = chosen);
          }),
        DropdownButtonFormField<String>(value: sex, decoration: fieldDecoration('Sexo *'),
          items: const [DropdownMenuItem(value: 'femenino', child: Text('Femenino')),
            DropdownMenuItem(value: 'masculino', child: Text('Masculino'))],
          onChanged: (v) => setState(() => sex = v!)),
        const SizedBox(height: 12),
        DropdownButtonFormField<String>(value: department, isExpanded: true,
          decoration: fieldDecoration('Departamento *'),
          items: [for (final d in departments) DropdownMenuItem(
            value: d['codigo'].toString(), child: Text(d['nombre'].toString()))],
          onChanged: (v) { if (v != null) getTowns(v); }),
        const SizedBox(height: 12),
        DropdownButtonFormField<String>(value: town, isExpanded: true,
          decoration: fieldDecoration('Municipio *'),
          items: [for (final m in towns) DropdownMenuItem(
            value: m['codigo'].toString(), child: Text(m['nombre'].toString()))],
          onChanged: (v) => setState(() => town = v)),
        const SizedBox(height: 12),field(address, 'Dirección', mandatory: false),
      ])),
      if (error != null) ErrorNotice(error!),
      if (loading) const LinearProgressIndicator(),
      ElevatedButton(onPressed: loading ? null : save, child: const Text('Continuar')),
    ]));
}

class GuardianForm extends StatefulWidget {
  final Session session;
  final String patientId;
  final String childName;
  const GuardianForm({super.key, required this.session, required this.patientId, required this.childName});
  @override
  State<GuardianForm> createState() => _GuardianFormState();
}
class _GuardianFormState extends State<GuardianForm> {
  final form = GlobalKey<FormState>();
  final names = TextEditingController(), surnames = TextEditingController();
  final phone = TextEditingController(), email = TextEditingController(), address = TextEditingController();
  String? relationship;
  List<Map<String,dynamic>> relationships = [];
  bool confirmLegal = false, busy = false;
  String? error;
  @override
  void initState() { super.initState(); load(); }
  Future<void> load() async {
    try {
      final profile = await widget.session.api.get('/me');
      names.text = profile['nombres'].toString(); surnames.text = profile['apellidos'].toString();
      phone.text = profile['telefono']?.toString() ?? '';
      email.text = profile['correo']?.toString() ?? '';
      final catalog = await widget.session.api.get('/catalogos/parentesco');
      if (mounted) setState(() => relationships = (catalog as List).cast<Map<String,dynamic>>());
    } catch (e) { if (mounted) setState(() => error = e.toString()); }
  }
  Widget entry(TextEditingController c,String label,{bool mandatory = true}) => Padding(
    padding: const EdgeInsets.only(bottom: 12), child: TextFormField(controller: c,
      decoration: fieldDecoration(label),
      validator: (v) => mandatory && (v == null || v.trim().isEmpty) ? 'Campo obligatorio' : null));
  Future<void> save() async {
    if (!form.currentState!.validate()) return;
    if (relationship == null || !confirmLegal) {
      setState(() => error = 'Selecciona parentesco y confirma la responsabilidad legal');return;
    }
    setState(() { busy = true;error = null; });
    try {
      await widget.session.api.post('/pacientes/${widget.patientId}/tutores', {
        'esLaCuentaActual': true, 'nombres': names.text.trim(),
        'apellidos': surnames.text.trim(), 'parentesco': relationship,
        'telefono': phone.text.trim().isEmpty ? null : phone.text.trim(),
        'correo': email.text.trim().isEmpty ? null : email.text.trim(),
        'direccion': address.text.trim().isEmpty ? null : address.text.trim(),
        'esResponsableLegal': true, 'confirmoResponsableLegal': true,
      });
      if (!mounted) return;
      Navigator.pushReplacement(context, MaterialPageRoute(builder: (_) => NewRequestPage(
        session: widget.session, patientId: widget.patientId,
        patientName: widget.childName)));
    } catch (e) { if (mounted) setState(() => error = e.toString()); }
    finally { if (mounted) setState(() => busy = false); }
  }
  @override
  Widget build(BuildContext context) => ContigoScaffold(title: 'Responsable legal',
    child: ListView(padding: const EdgeInsets.all(18), children: [
      const ContigoPanel(color: ContigoColors.azul, child: Text(
        'Confirma los datos del padre, madre o tutor legal del niño.')),
      const SizedBox(height: 15),
      Form(key: form, child: Column(children: [
        entry(names, 'Nombres *'), entry(surnames, 'Apellidos *'),
        DropdownButtonFormField<String>(value: relationship, isExpanded: true,
          decoration: fieldDecoration('Parentesco *'),
          items: [for (final item in relationships) DropdownMenuItem(
            value: item['codigo'].toString(), child: Text(item['etiqueta'].toString()))],
          onChanged: (v) => setState(() => relationship = v)),
        const SizedBox(height: 12),
        entry(phone, 'Teléfono (+504)'), entry(email, 'Correo electrónico'),
        entry(address, 'Dirección',mandatory: false),
      ])),
      CheckboxListTile(value: confirmLegal,
        onChanged: (v) => setState(() => confirmLegal = v ?? false),
        title: const Text('Confirmo que soy responsable legal del niño o niña.')),
      if (error != null) ErrorNotice(error!),
      if (busy) const LinearProgressIndicator(),
      ElevatedButton(onPressed: busy ? null : save, child: const Text('Guardar y continuar')),
    ]));
}
