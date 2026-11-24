import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  testWidgets('Verifica que Flutter muestre una pantalla', (tester) async {
    await tester.pumpWidget(
      const MaterialApp(
        home: Scaffold(
          body: Center(
            child: Text('CONTIGO'),
          ),
        ),
      ),
    );

    expect(find.text('CONTIGO'), findsOneWidget);
  });
}
