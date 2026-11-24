import 'package:flutter/material.dart';

abstract final class ContigoColors {
  static const vino = Color(0xFF941638);
  static const vinoOscuro = Color(0xFF75102C);
  static const crema = Color(0xFFFFF9F5);
  static const rosa = Color(0xFFFBE8ED);
  static const azul = Color(0xFFE9F2FC);
  static const amarillo = Color(0xFFFFF2DE);
  static const lila = Color(0xFFF1EBFC);
  static const verde = Color(0xFF21845B);
}

ThemeData createContigoTheme() {
  final esquema = ColorScheme.fromSeed(
    seedColor: ContigoColors.vino,
    primary: ContigoColors.vino,
    surface: Colors.white,
  );
  return ThemeData(
    useMaterial3: true,
    colorScheme: esquema,
    scaffoldBackgroundColor: ContigoColors.crema,
    appBarTheme: const AppBarTheme(
      backgroundColor: ContigoColors.vino,
      foregroundColor: Colors.white,
      centerTitle: true,
      elevation: 0,
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: Colors.white,
      contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 13),
      border: OutlineInputBorder(borderRadius: BorderRadius.circular(14)),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(14),
        borderSide: const BorderSide(color: Color(0xFFE3D9DB)),
      ),
    ),
    elevatedButtonTheme: ElevatedButtonThemeData(
      style: ElevatedButton.styleFrom(
        backgroundColor: ContigoColors.vino,
        foregroundColor: Colors.white,
        minimumSize: const Size.fromHeight(50),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
        textStyle: const TextStyle(fontWeight: FontWeight.w700),
      ),
    ),
    cardTheme: CardThemeData(
      color: Colors.white,
      elevation: 1,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
    ),
  );
}
