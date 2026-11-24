import 'dart:convert';
import 'package:http/http.dart' as http;

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
  Future<dynamic> put(String path, Map<String, dynamic> data) => request('PUT', path, data: data);
  Future<dynamic> patch(String path, Map<String, dynamic> data) => request('PATCH', path, data: data);

  Future<dynamic> request(String method, String path, {Map<String, dynamic>? data,
      bool retry = true}) async {
    final url = Uri.parse('$root$path');
    final headers = <String, String>{'Accept': 'application/json',
      'Content-Type': 'application/json'};
    if (accessToken != null) headers['Authorization'] = 'Bearer $accessToken';
    final req = http.Request(method, url)..headers.addAll(headers);
    if (data != null) req.body = jsonEncode(data);
    http.Response response;
    try {
      final streamed = await _client.send(req).timeout(const Duration(seconds: 20));
      response = await http.Response.fromStream(streamed);
    } catch (_) {
      throw const ApiException('No se pudo conectar con el servidor. Revisa tu conexión y la URL de la API.', 0);
    }
    if (response.statusCode == 401 && retry && refresh != null) {
      if (await refresh!()) return request(method, path, data: data, retry: false);
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

  void dispose() => _client.close();
}
