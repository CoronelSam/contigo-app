import 'package:flutter/material.dart';
import '../theme/contigo_theme.dart';

class ContigoScaffold extends StatelessWidget {
  final String title;
  final Widget child;
  final List<Widget>? actions;
  final Widget? bottomNavigationBar;
  const ContigoScaffold({super.key, required this.title, required this.child,
    this.actions, this.bottomNavigationBar});

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(
      title: Column(mainAxisSize: MainAxisSize.min, children: [
        Text(title, style: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
        if (title != 'CONTIGO') const Text('CONTIGO · Shriners Honduras',
          style: TextStyle(fontSize: 10, fontWeight: FontWeight.w400)),
      ]),
      actions: actions,
      flexibleSpace: const DecoratedBox(decoration: BoxDecoration(
        gradient: LinearGradient(colors: [ContigoColors.vinoOscuro, ContigoColors.vino]),
      )),
    ),
    body: SafeArea(child: child),
    bottomNavigationBar: bottomNavigationBar,
  );
}

class ContigoPanel extends StatelessWidget {
  final Widget child;
  final Color color;
  const ContigoPanel({super.key, required this.child, this.color = Colors.white});
  @override
  Widget build(BuildContext context) => Container(
    width: double.infinity,
    padding: const EdgeInsets.all(16),
    decoration: BoxDecoration(color: color, borderRadius: BorderRadius.circular(16)),
    child: child,
  );
}

class ErrorNotice extends StatelessWidget {
  final String text;
  const ErrorNotice(this.text, {super.key});
  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.symmetric(vertical: 8),
    child: ContigoPanel(color: ContigoColors.rosa,
      child: Text(text, style: const TextStyle(color: ContigoColors.vinoOscuro))),
  );
}

void showMessage(BuildContext context, String text) {
  ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(text)));
}

InputDecoration fieldDecoration(String label, {IconData? icon}) => InputDecoration(
  labelText: label, prefixIcon: icon == null ? null : Icon(icon, color: ContigoColors.vino),
);
