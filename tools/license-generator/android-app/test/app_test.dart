/// The operator window itself: four tabs, and the state a first run is in.
library;

import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:kayan_key_generator/main.dart';
import 'package:kayan_key_generator/src/register.dart';
import 'package:path/path.dart' as p;

Map<String, dynamic> _golden() => Map<String, dynamic>.from(
      jsonDecode(File(p.join('test', 'goldens', 'vectors.json')).readAsStringSync()) as Map,
    );

void main() {
  late Directory home;

  setUp(() {
    home = Directory.systemTemp.createTempSync('kayan-ui-');
  });

  tearDown(() {
    try {
      home.deleteSync(recursive: true);
    } catch (_) {
      // A temp folder left behind is not a failure.
    }
  });

  testWidgets('a first run says there is no key and offers the key tab', (tester) async {
    final state = OperatorState(KeyFolder(home.path));
    await state.refresh();
    await tester.pumpWidget(KayanKeyGeneratorApp(state: state));
    await tester.pumpAndSettle();

    expect(find.text('مولّد مفاتيح كيان'), findsOneWidget);
    expect(find.textContaining('لا يوجد مفتاح توقيع'), findsOneWidget);
    expect(find.text('إصدار'), findsOneWidget);
    expect(find.text('السجل'), findsOneWidget);
    expect(find.text('فحص'), findsOneWidget);
    expect(find.text('المفتاح'), findsOneWidget);
  });

  testWidgets('with a key and a licence, the issue tab offers both', (tester) async {
    final golden = _golden();
    File(p.join(home.path, 'private-key.pem'))
        .writeAsStringSync(golden['keyPair']['privateKeyPem'] as String);
    File(p.join(home.path, 'public-key.pem'))
        .writeAsStringSync(golden['keyPair']['publicKeyPem'] as String);

    final folder = KeyFolder(home.path);
    final state = OperatorState(folder);
    await state.generator.createLicence(ref: 'شركة النور', seats: 5, term: '1y');
    await state.refresh();

    await tester.pumpWidget(KayanKeyGeneratorApp(state: state));
    await tester.pumpAndSettle();

    expect(find.textContaining('989A-6539'), findsOneWidget); // the fingerprint
    expect(find.textContaining('شركة النور'), findsOneWidget); // the licence in the dropdown
    expect(find.text('إصدار'), findsWidgets);
  });

  testWidgets('the key tab shows the folder it uses', (tester) async {
    final state = OperatorState(KeyFolder(home.path));
    await state.refresh();
    await tester.pumpWidget(KayanKeyGeneratorApp(state: state));
    await tester.pumpAndSettle();

    await tester.tap(find.text('المفتاح'));
    await tester.pumpAndSettle();
    expect(find.textContaining('استيراد'), findsWidgets);
    expect(find.textContaining(home.path), findsOneWidget);
    expect(find.byType(Scaffold), findsWidgets);
  });
}
