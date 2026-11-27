import 'dart:typed_data';
import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import 'package:file_picker/file_picker.dart';
import 'package:uuid/uuid.dart';
import '../../core/auth/session.dart';
import '../../core/theme/contigo_theme.dart';
import '../../core/widgets/ui.dart';

const _uuid = Uuid();

/// Etapa 4 — el checklist viene de la API según el paquete y la ruta asignados.
class DocumentsFlowPage extends StatefulWidget {
  final Session session;
  final String requestId, caseCode;
  const DocumentsFlowPage(
      {super.key,
      required this.session,
      required this.requestId,
      required this.caseCode});
  @override
  State<DocumentsFlowPage> createState() => _DocumentsFlowPageState();
}

class _DocumentsFlowPageState extends State<DocumentsFlowPage> {
  Map<String, dynamic>? checklist;
  String? error;
  bool loading = true;
  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      loading = true;
      error = null;
    });
    try {
      final result = await widget.session.api
          .get('/solicitudes/${widget.requestId}/documentos');
      if (mounted)
        setState(() {
          checklist = Map<String, dynamic>.from(result as Map);
          loading = false;
        });
    } catch (e) {
      if (mounted)
        setState(() {
          error = e.toString();
          loading = false;
        });
    }
  }

  Future<void> _open(Map requirement) async {
    await Navigator.push(
        context,
        MaterialPageRoute(
            builder: (_) => DocumentDetailPage(
                session: widget.session,
                requestId: widget.requestId,
                requirement: Map<String, dynamic>.from(requirement))));
    if (mounted) _load();
  }

  @override
  Widget build(BuildContext context) {
    final items =
        (checklist?['requisitos'] as List? ?? []).whereType<Map>().toList();
    final completed = items.where((r) => r['cumplido'] == true).length;
    return ContigoScaffold(
        title: 'Documentos',
        child: RefreshIndicator(
          onRefresh: _load,
          child: ListView(
            physics: const AlwaysScrollableScrollPhysics(),
            padding: const EdgeInsets.all(18),
            children: [
              const Text('22. Documentos requeridos',
                  style: TextStyle(
                      fontSize: 22,
                      fontWeight: FontWeight.w800,
                      color: ContigoColors.vinoOscuro)),
              Text('Caso: ${widget.caseCode}'),
              const SizedBox(height: 10),
              const ContigoPanel(
                  color: ContigoColors.azul,
                  child: Text(
                      'La lista corresponde a los requisitos activos de este caso. '
                      'Capturado no significa validado. Una persona revisará los documentos.')),
              const SizedBox(height: 12),
              Text('$completed de ${items.length} requisitos cumplidos',
                  style: const TextStyle(fontWeight: FontWeight.bold)),
              LinearProgressIndicator(
                  value: items.isEmpty ? 0 : completed / items.length),
              if (loading) const LinearProgressIndicator(),
              if (error != null) ErrorNotice(error!),
              ...items.map((r) {
                final type = r['tipoDocumento'] as Map? ?? {};
                final status = r['estado']?.toString() ?? 'FALTA';
                final completed = r['cumplido'] == true;
                return Card(
                    child: ListTile(
                  leading: Icon(
                      completed
                          ? Icons.check_circle
                          : Icons.description_outlined,
                      color:
                          completed ? ContigoColors.verde : ContigoColors.vino),
                  title: Text(type['nombre']?.toString() ?? 'Documento'),
                  subtitle: Text(
                      '${r['obligatorio'] == true ? 'Requisito' : 'Opcional'} · $status'
                      '${r['cubiertoPorFormulario'] == true ? ' · Cubierto por formulario' : ''}'),
                  trailing: const Icon(Icons.chevron_right),
                  onTap: () => _open(r),
                ));
              }),
              if (checklist != null) ...[
                const SizedBox(height: 14),
                ElevatedButton.icon(
                    onPressed: () => Navigator.push(
                        context,
                        MaterialPageRoute(
                            builder: (_) => SubmissionPage(
                                session: widget.session,
                                requestId: widget.requestId,
                                caseCode: widget.caseCode))),
                    icon: const Icon(Icons.fact_check_outlined),
                    label: const Text('Revisar expediente y enviar')),
              ],
            ],
          ),
        ));
  }
}

class DocumentDetailPage extends StatefulWidget {
  final Session session;
  final String requestId;
  final Map<String, dynamic> requirement;
  const DocumentDetailPage(
      {super.key,
      required this.session,
      required this.requestId,
      required this.requirement});
  @override
  State<DocumentDetailPage> createState() => _DocumentDetailPageState();
}

class _DocumentDetailPageState extends State<DocumentDetailPage> {
  Map<String, dynamic>? info;
  String? error;
  bool loading = true;
  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final id = (widget.requirement['tipoDocumento'] as Map)['id'];
      final result = await widget.session.api.get('/tipos-documento/$id');
      if (mounted)
        setState(() {
          info = Map<String, dynamic>.from(result as Map);
          loading = false;
        });
    } catch (e) {
      if (mounted)
        setState(() {
          error = e.toString();
          loading = false;
        });
    }
  }

  @override
  Widget build(BuildContext context) {
    final Map t = info ?? (widget.requirement['tipoDocumento'] as Map? ?? {});
    final status = widget.requirement['estado']?.toString() ?? 'FALTA';
    final current = widget.requirement['documento'] as Map?;
    return ContigoScaffold(
        title: 'Detalle del documento',
        child: ListView(
          padding: const EdgeInsets.all(18),
          children: [
            const Text('23. Detalle del documento',
                style: TextStyle(
                    fontSize: 22,
                    fontWeight: FontWeight.w800,
                    color: ContigoColors.vinoOscuro)),
            const SizedBox(height: 14),
            ContigoPanel(
                color: ContigoColors.rosa,
                child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(t['nombre']?.toString() ?? '',
                          style: const TextStyle(
                              fontSize: 18, fontWeight: FontWeight.bold)),
                      Text('Estado: $status'),
                    ])),
            const SizedBox(height: 12),
            const Text('¿Para qué sirve?',
                style: TextStyle(fontWeight: FontWeight.bold)),
            Text(info?['paraQueSirve']?.toString() ??
                'Consulta la ayuda oficial del documento.'),
            const SizedBox(height: 14),
            const Text('¿Cómo fotografiarlo?',
                style: TextStyle(fontWeight: FontWeight.bold)),
            Text(info?['comoFotografiar']?.toString() ??
                'Toma una foto nítida y completa de cada página, sin sombras.'),
            const SizedBox(height: 14),
            if (loading) const LinearProgressIndicator(),
            if (error != null) ErrorNotice(error!),
            if (status == 'VALIDADO')
              const ContigoPanel(
                  color: ContigoColors.azul,
                  child: Text(
                      'Documento validado. Solo el coordinador puede autorizar una sustitución.')),
            if (status != 'VALIDADO') ...[
              if (status == 'CAPTURADO')
                const ContigoPanel(
                    color: ContigoColors.amarillo,
                    child: Text(
                        'Este documento está capturado y espera revisión. '
                        'Si necesitas sustituirlo, se creará una nueva versión.')),
              const SizedBox(height: 14),
              ElevatedButton.icon(
                  icon: const Icon(Icons.camera_alt_outlined),
                  label: Text(current != null && status == 'FALTA'
                      ? 'Continuar captura'
                      : 'Tomar foto o seleccionar archivo'),
                  onPressed: loading
                      ? null
                      : () async {
                          await Navigator.push(
                              context,
                              MaterialPageRoute(
                                  builder: (_) => DocumentCapturePage(
                                        session: widget.session,
                                        requestId: widget.requestId,
                                        documentTypeId:
                                            t['id']?.toString() ?? '',
                                        documentTypeCode:
                                            t['codigo']?.toString() ?? '',
                                        title: t['nombre']?.toString() ??
                                            'Documento',
                                        existingId:
                                            status == 'FALTA' && current != null
                                                ? current['id']?.toString()
                                                : null,
                                      )));
                          if (context.mounted) Navigator.pop(context);
                        }),
            ],
          ],
        ));
  }
}

class _PickedFile {
  final Uint8List bytes;
  final String name, mime;
  const _PickedFile(this.bytes, this.name, this.mime);
}

/// Pantallas 24-27: captura local, revisión de páginas, subida y finalización.
/// No fingimos sincronización sin conexión: esa función se construirá aparte.
class DocumentCapturePage extends StatefulWidget {
  final Session session;
  final String requestId, documentTypeId, documentTypeCode, title;
  final String? existingId;
  const DocumentCapturePage(
      {super.key,
      required this.session,
      required this.requestId,
      required this.documentTypeId,
      required this.documentTypeCode,
      required this.title,
      this.existingId});
  @override
  State<DocumentCapturePage> createState() => _DocumentCapturePageState();
}

class _DocumentCapturePageState extends State<DocumentCapturePage> {
  final picker = ImagePicker();
  final List<_PickedFile> files = [];
  String? docId, error, phase;
  bool working = false;
  int uploaded = 0;
  @override
  void initState() {
    super.initState();
    docId = widget.existingId;
  }

  Future<void> _take(ImageSource source) async {
    try {
      final photo = await picker.pickImage(
          source: source, maxWidth: 2200, imageQuality: 85);
      if (photo == null) return;
      final bytes = await photo.readAsBytes();
      if (!mounted) return;
      if (bytes.lengthInBytes > 10 * 1024 * 1024) {
        setState(() => error = 'El archivo supera 10 MB. Intenta otra imagen.');
        return;
      }
      final lower = photo.name.toLowerCase();
      final mime = lower.endsWith('.png')
          ? 'image/png'
          : lower.endsWith('.webp')
              ? 'image/webp'
              : 'image/jpeg';
      setState(() {
        files.add(_PickedFile(bytes, photo.name, mime));
        error = null;
      });
    } catch (e) {
      if (mounted) setState(() => error = e.toString());
    }
  }

  Future<void> _chooseFile() async {
    try {
      final picked = await FilePicker.platform.pickFiles(
          type: FileType.custom,
          allowedExtensions: ['jpg', 'jpeg', 'png', 'webp', 'pdf'],
          withData: true);
      if (picked == null || picked.files.isEmpty) return;
      final f = picked.files.first;
      if (f.bytes == null) {
        setState(() => error = 'No se pudo leer el archivo.');
        return;
      }
      if (f.size > 10 * 1024 * 1024) {
        setState(() => error = 'El archivo supera 10 MB.');
        return;
      }
      final ext = f.extension?.toLowerCase() ?? '';
      final mime = switch (ext) {
        'png' => 'image/png',
        'webp' => 'image/webp',
        'pdf' => 'application/pdf',
        _ => 'image/jpeg',
      };
      if (mounted)
        setState(() {
          files.add(_PickedFile(f.bytes!, f.name, mime));
          error = null;
        });
    } catch (e) {
      if (mounted) setState(() => error = e.toString());
    }
  }

  Future<void> _upload() async {
    if (working || files.isEmpty) return;
    setState(() {
      working = true;
      error = null;
      phase = 'Preparando documento';
    });
    try {
      docId ??= (await widget.session.api.request(
              'POST', '/solicitudes/${widget.requestId}/documentos', headers: {
        'Idempotency-Key': _uuid.v4()
      }, data: {
        'tipoDocumentoId': widget.documentTypeId,
        'origen': 'app'
      }))['id']
          .toString();
      for (var i = uploaded; i < files.length; i++) {
        if (mounted)
          setState(() => phase = 'Subiendo página ${i + 1} de ${files.length}');
        await widget.session.api.uploadPage('/documentos/$docId/paginas',
            files[i].bytes, files[i].name, files[i].mime, _uuid.v4());
        uploaded = i + 1;
      }
      if (mounted) setState(() => phase = 'Finalizando captura');
      // Releer del servidor: en un reintento puede haber páginas subidas antes.
      final detail = await widget.session.api.get('/documentos/$docId');
      final total = ((detail as Map)['paginas'] as List? ?? []).length;
      if (total == 0) throw StateError('El documento no contiene páginas.');
      await widget.session.api
          .post('/documentos/$docId/finalizar', {'paginasDeclaradas': total});
      // La certificación pertenece al expediente profesional, no solo al checklist.
      if (widget.documentTypeCode == 'certificacion_medica') {
        await widget.session.api.put(
            '/solicitudes/${widget.requestId}/profesional-salud',
            {'documentoCertificacionId': docId});
      }
      if (!mounted) return;
      setState(() => phase = 'Capturado, pendiente de revisión');
      await showDialog<void>(
          context: context,
          builder: (ctx) => AlertDialog(
                title: const Text('27. Captura recibida'),
                content: Text('${widget.title}: $total páginas capturadas. '
                    'El OCR puede procesarse después; una persona deberá revisar los datos. '
                    'El documento aún no está validado.'),
                actions: [
                  TextButton(
                      onPressed: () => Navigator.pop(ctx),
                      child: const Text('Continuar'))
                ],
              ));
      if (mounted) Navigator.pop(context);
    } catch (e) {
      if (mounted)
        setState(
            () => error = '$e. Puedes reintentar sin cerrar esta pantalla.');
    } finally {
      if (mounted) setState(() => working = false);
    }
  }

  @override
  Widget build(BuildContext context) => ContigoScaffold(
      title: 'Captura de documento',
      child: ListView(padding: const EdgeInsets.all(18), children: [
        const Text('24–27. Capturar documento',
            style: TextStyle(
                fontSize: 22,
                fontWeight: FontWeight.w800,
                color: ContigoColors.vinoOscuro)),
        const SizedBox(height: 8),
        Text(widget.title),
        const SizedBox(height: 12),
        const ContigoPanel(
            color: ContigoColors.azul,
            child: Text(
                'Buena iluminación · Toda la hoja visible · Evita sombras. '
                'Revisa la fotografía antes de subirla.')),
        const SizedBox(height: 12),
        ElevatedButton.icon(
            onPressed: working ? null : () => _take(ImageSource.camera),
            icon: const Icon(Icons.photo_camera_outlined),
            label: const Text('Tomar foto')),
        const SizedBox(height: 8),
        OutlinedButton.icon(
            onPressed: working ? null : () => _take(ImageSource.gallery),
            icon: const Icon(Icons.photo_library_outlined),
            label: const Text('Elegir de galería')),
        OutlinedButton.icon(
            onPressed: working ? null : _chooseFile,
            icon: const Icon(Icons.upload_file_outlined),
            label: const Text('Seleccionar PDF o imagen')),
        const SizedBox(height: 15),
        Text('25. Páginas seleccionadas (${files.length})',
            style: const TextStyle(fontWeight: FontWeight.bold)),
        ...files.asMap().entries.map((e) => Card(
                child: ListTile(
              leading: e.value.mime.startsWith('image/')
                  ? Image.memory(e.value.bytes,
                      width: 44, height: 44, fit: BoxFit.cover)
                  : const Icon(Icons.picture_as_pdf),
              title: Text('Página ${e.key + 1}'),
              subtitle: Text(e.value.name, maxLines: 1),
              trailing: IconButton(
                  icon: const Icon(Icons.delete_outline),
                  onPressed: working || e.key < uploaded
                      ? null
                      : () => setState(() => files.removeAt(e.key))),
            ))),
        if (uploaded > 0)
          Text(
              '$uploaded páginas ya subidas. No se eliminarán automáticamente.'),
        if (phase != null)
          ContigoPanel(
              color: ContigoColors.amarillo, child: Text('26. $phase')),
        if (working) const LinearProgressIndicator(),
        if (error != null) ErrorNotice(error!),
        const SizedBox(height: 12),
        ElevatedButton.icon(
            onPressed: working || files.isEmpty ? null : _upload,
            icon: const Icon(Icons.cloud_upload_outlined),
            label: const Text('Subir páginas y finalizar captura')),
      ]));
}

/// Pantallas 28–29: resumen del expediente y envío a revisión humana.
class SubmissionPage extends StatefulWidget {
  final Session session;
  final String requestId, caseCode;
  const SubmissionPage(
      {super.key,
      required this.session,
      required this.requestId,
      required this.caseCode});
  @override
  State<SubmissionPage> createState() => _SubmissionPageState();
}

class _SubmissionPageState extends State<SubmissionPage> {
  Map<String, dynamic>? data;
  String? error;
  bool sending = false, sent = false;
  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final response =
          await widget.session.api.get('/solicitudes/${widget.requestId}');
      if (mounted)
        setState(() {
          data = Map<String, dynamic>.from(response as Map);
          error = null;
        });
    } catch (e) {
      if (mounted) setState(() => error = e.toString());
    }
  }

  Future<void> _send() async {
    setState(() {
      sending = true;
      error = null;
    });
    try {
      await widget.session.api.request(
          'POST', '/solicitudes/${widget.requestId}/enviar',
          headers: {'Idempotency-Key': _uuid.v4()});
      if (mounted) setState(() => sent = true);
    } catch (e) {
      if (mounted) setState(() => error = e.toString());
    } finally {
      if (mounted) setState(() => sending = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final sections = (data?['secciones'] as List? ?? []).whereType<Map>();
    final docs = (data?['documentos'] as List? ?? []).whereType<Map>();
    final missing = (data?['faltantes'] as List? ?? []);
    return ContigoScaffold(
        title: sent ? 'Entrega confirmada' : 'Resumen del expediente',
        child: ListView(padding: const EdgeInsets.all(18), children: [
          Text(
              sent
                  ? '29. ¡Recibimos tus documentos!'
                  : '28. Resumen del expediente',
              style: const TextStyle(
                  fontSize: 22,
                  color: ContigoColors.vinoOscuro,
                  fontWeight: FontWeight.w800)),
          const SizedBox(height: 12),
          ContigoPanel(
              color: sent ? ContigoColors.azul : ContigoColors.rosa,
              child: Text(sent
                  ? 'Nuestro equipo revisará la información y te notificará sobre el avance. '
                      'No significa que Shriners haya aceptado la solicitud.'
                  : 'Caso: ${data?['codigo'] ?? widget.caseCode}. '
                      'Puedes enviar a revisión incluso si faltan documentos. '
                      'El expediente NO se considera completo hasta que se valide.')),
          if (!sent) ...[
            const SizedBox(height: 12),
            if (data == null) const LinearProgressIndicator(),
            if (data != null) ...[
              Text('Paciente: ${data?['paciente']?['nombreCompleto'] ?? ''}',
                  style: const TextStyle(fontWeight: FontWeight.bold)),
              const SizedBox(height: 10),
              const Text('Secciones',
                  style: TextStyle(fontWeight: FontWeight.bold)),
              ...sections.map((s) => ListTile(
                  dense: true,
                  title: Text(s['titulo']?.toString() ?? ''),
                  trailing: Text(s['estado']?.toString() ?? ''))),
              const Text('Documentos',
                  style: TextStyle(fontWeight: FontWeight.bold)),
              ...docs.map((d) => ListTile(
                  dense: true,
                  title: Text(
                      d['nombre']?.toString() ?? d['codigo']?.toString() ?? ''),
                  trailing: Text(d['estado']?.toString() ?? ''))),
              const SizedBox(height: 9),
              Text('Faltantes: ${missing.length}',
                  style: const TextStyle(fontWeight: FontWeight.bold)),
              ...missing.whereType<Map>().map((m) => Text(
                  '• ${m['codigo']} — ${m['motivo']}',
                  style: const TextStyle(fontSize: 13))),
              const SizedBox(height: 14),
              OutlinedButton(
                  onPressed: () => Navigator.pop(context),
                  child: const Text('Editar / adjuntar documentos')),
              const SizedBox(height: 10),
              ElevatedButton(
                  onPressed: sending ||
                          !['CAPTURA', 'INFO_ADICIONAL', 'PAQUETE_EXTERIOR']
                              .contains(data?['estado'])
                      ? null
                      : _send,
                  child: const Text('Enviar a revisión')),
            ],
          ] else ...[
            const SizedBox(height: 18),
            Center(
                child: Text('Caso ${widget.caseCode}',
                    style: const TextStyle(
                        fontSize: 22, fontWeight: FontWeight.bold))),
            const SizedBox(height: 16),
            ElevatedButton(
                onPressed: () =>
                    Navigator.popUntil(context, (route) => route.isFirst),
                child: const Text('Volver al inicio')),
          ],
          if (sending) const LinearProgressIndicator(),
          if (error != null) ErrorNotice(error!),
        ]));
  }
}
