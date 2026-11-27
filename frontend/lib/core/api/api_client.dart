import 'dart:convert';
import 'dart:typed_data';
import 'package:http/http.dart' as http;
import 'package:http_parser/http_parser.dart';

class ApiException implements Exception {
  final String message;
  final String? code;
  final int status;
  const ApiException(this.message, this.status, [this.code]);
  @override
  String toString() => message;
}

class ApiClient {
  static const root = String.fromEnvironment('API_BASE_URL',
    defaultValue: 'http://10.0.2.2:3000/api/v1');
  final http.Client _client = http.Client();
  String? accessToken;
  Future<bool> Function()? refresh;

  Future<dynamic> get(String path) => request('GET', path);
  Future<dynamic> post(String path, Map<String, dynamic> data) => request('POST', path, data: data);
  Future<dynamic> put(String path, Map<String, dynamic> data, {Map<String, String>? headers}) => request('PUT', path, data: data, headers: headers);
  Future<dynamic> delete(String path) => request('DELETE', path);
  Future<dynamic> patch(String path, Map<String, dynamic> data) => request('PATCH', path, data: data);

  Future<dynamic> request(String method, String path, {Map<String, dynamic>? data,
      bool retry = true, Map<String, String>? headers}) async {
    final url = Uri.parse('$root$path');
    final requestHeaders = <String, String>{'Accept': 'application/json',
      'Content-Type': 'application/json'};
    if (accessToken != null) requestHeaders['Authorization'] = 'Bearer $accessToken';
    if (headers != null) requestHeaders.addAll(headers);
    final req = http.Request(method, url)..headers.addAll(requestHeaders);
    if (data != null) req.body = jsonEncode(data);
    http.Response response;
    try {
      final streamed = await _client.send(req).timeout(const Duration(seconds: 20));
      response = await http.Response.fromStream(streamed);
    } catch (_) {
      throw const ApiException('No se pudo conectar con el servidor. Revisa tu conexión y la URL de la API.', 0);
    }
    if (response.statusCode == 401 && retry && refresh != null) {
      if (await refresh!()) return request(method, path, data: data, retry: false, headers: headers);
    }
    dynamic body;
    try {
      body = response.body.isEmpty ? null : jsonDecode(response.body);
    } catch (_) { body = null; }
    if (response.statusCode < 200 || response.statusCode >= 300) {
      final obj = body is Map<String, dynamic> ? body : <String, dynamic>{};
      throw ApiException(obj['mensaje']?.toString() ?? 'Error del servidor (${response.statusCode})',
        response.statusCode, obj['codigo']?.toString());
    }
    return body;
  }

  /// Carga una página real como multipart; el backend exige el campo "archivo".
  Future<dynamic> uploadPage(String path, Uint8List bytes, String filename,
      String mime, String idempotencyKey, {bool retry = true}) async {
    final url = Uri.parse('$root$path');
    final req = http.MultipartRequest('POST', url);
    req.headers['Accept'] = 'application/json';
    req.headers['Idempotency-Key'] = idempotencyKey;
    if (accessToken != null) req.headers['Authorization'] = 'Bearer $accessToken';
    final split = mime.split('/');
    req.files.add(http.MultipartFile.fromBytes('archivo', bytes,
        filename: filename,
        contentType: MediaType(split[0], split[1])));
    http.Response response;
    try {
      final streamed = await _client.send(req).timeout(const Duration(seconds: 60));
      response = await http.Response.fromStream(streamed);
    } catch (_) {
      throw const ApiException('No se pudo subir la página. Revisa tu conexión.', 0);
    }
    if (response.statusCode == 401 && retry && refresh != null && await refresh!()) {
      return uploadPage(path, bytes, filename, mime, idempotencyKey, retry: false);
    }
    dynamic body;
    try { body = jsonDecode(response.body); } catch (_) { body = null; }
    if (response.statusCode < 200 || response.statusCode >= 300) {
      final obj = body is Map ? body : <String, dynamic>{};
      throw ApiException(obj['mensaje']?.toString() ?? 'Error al subir (${response.statusCode})',
          response.statusCode, obj['codigo']?.toString());
    }
    return body;
  }

  void dispose() => _client.close();
}
