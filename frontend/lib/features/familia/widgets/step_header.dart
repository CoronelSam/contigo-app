import 'package:flutter/material.dart';
import '../../../core/theme/contigo_theme.dart';

/// Encabezado reutilizable para las pantallas 07 a 12.
class FamilyStepHeader extends StatelessWidget {
  final String title;
  final String subtitle;
  final int screen;
  final IconData icon;

  const FamilyStepHeader({
    super.key,
    required this.title,
    required this.subtitle,
    required this.screen,
    required this.icon,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(22),
        border: Border.all(color: const Color(0xFFF0E2E4)),
      ),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(children: [
          Container(
            padding: const EdgeInsets.all(11),
            decoration: BoxDecoration(
              color: ContigoColors.rosa,
              borderRadius: BorderRadius.circular(14),
            ),
            child: Icon(icon, color: ContigoColors.vino, size: 26),
          ),
          const Spacer(),
          Text('PANTALLA ${screen.toString().padLeft(2, '0')}',
              style: const TextStyle(color: ContigoColors.vino,
                  fontSize: 11, fontWeight: FontWeight.w700)),
        ]),
        const SizedBox(height: 12),
        Text(title, style: const TextStyle(fontSize: 23,
            color: ContigoColors.vinoOscuro, fontWeight: FontWeight.w800)),
        const SizedBox(height: 5),
        Text(subtitle, style: const TextStyle(fontSize: 13, height: 1.4,
            color: Color(0xFF56535C))),
      ]),
    );
  }
}
