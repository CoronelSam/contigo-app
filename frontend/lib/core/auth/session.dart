import 'package:flutter/foundation.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import '../api/api_client.dart';

class Session extends ChangeNotifier {
  final ApiClient api = ApiClient();
  final _storage = const FlutterSecureStorage();
  Map<String, dynamic>? user;
  bool initialized = false;
  Session() { api.refresh = refreshSession; }
  bool get authenticated => user != null;
  String get role => user?['rol']?.toString() ?? '';

  Future<void> initialize() async {
    try { await refreshSession(); } catch (_) { /* Sesión no disponible */ }
    initialized = true;
    notifyListeners();
  }

  Future<void> _apply(dynamic response) async {
    final json = response as Map<String, dynamic>;
    api.accessToken = json['accessToken']?.toString();
    await _storage.write(key: 'refresh_token', value: json['refreshToken']?.toString());
    user = Map<String, dynamic>.from(json['usuario'] as Map);
    notifyListeners();
  }

  Future<void> signIn(String email, String password) async {
    final result = await api.post('/auth/login', {
      'correo': email.trim(), 'contrasena': password,
      'dispositivo': 'contigo-flutter',
    });
    await _apply(result);
  }

  Future<void> signUp(Map<String, dynamic> values) async {
    final result = await api.post('/auth/register', values);
    await _apply(result);
  }

  Future<bool> refreshSession() async {
    final token = await _storage.read(key: 'refresh_token');
    if (token == null) return false;
    try {
      api.accessToken = null;
      // Evitar reintentar el refresh con el propio refresh.
      final result = await api.request('POST', '/auth/refresh',
        data: {'refreshToken': token}, retry: false);
      await _apply(result);
      return true;
    } catch (_) {
      await _storage.delete(key: 'refresh_token');
      api.accessToken = null;
      user = null;
      notifyListeners();
      return false;
    }
  }

  Future<void> signOut() async {
    final refreshToken = await _storage.read(key: 'refresh_token');
    try { await api.post('/auth/logout', {
      if (refreshToken != null) 'refreshToken': refreshToken,
    }); } catch (_) { /* Se elimina igualmente la sesión local */ }
    await _storage.delete(key: 'refresh_token');
    api.accessToken = null;
    user = null;
    notifyListeners();
  }
}
