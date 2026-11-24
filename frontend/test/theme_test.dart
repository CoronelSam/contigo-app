import 'package:flutter_test/flutter_test.dart';
import 'package:contigo_frontend/core/theme/contigo_theme.dart';

void main() {
  test('El color principal aprobado de CONTIGO es vino', () {
    expect(createContigoTheme().colorScheme.primary, ContigoColors.vino);
  });
}
