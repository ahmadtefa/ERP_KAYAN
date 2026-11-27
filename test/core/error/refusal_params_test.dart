import 'package:erp_kayan/core/error/app_error_text.dart';
import 'package:erp_kayan/core/error/failure.dart';
import 'package:erp_kayan/core/error/module_refusals.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('fillRefusalParams fills named places and never leaves a raw name', () {
    expect(
      fillRefusalParams('Line {line}: {unit}', {'line': '3', 'unit': 'Box'}),
      'Line 3: Box',
    );
    expect(fillRefusalParams('Line {line}.', const {}), 'Line -.');
    expect(fillRefusalParams('No places here.', {'x': 'y'}), 'No places here.');
  });

  test('a permission refusal that carries a code is explained from its template', () {
    final code = moduleRefusals.keys.firstWhere((k) => k.endsWith('_PERMISSION'));
    final failure = PermissionFailure('raw server text', null, code);
    final ar = const AppErrorMessageResolver(isArabic: true).resolve(failure);
    final en = const AppErrorMessageResolver(isArabic: false).resolve(failure);
    expect(ar.businessMessage, moduleRefusals[code]![0]);
    expect(en.businessMessage, moduleRefusals[code]![1]);
    expect(en.businessMessage, isNot(contains('raw server text')));
  });
}
